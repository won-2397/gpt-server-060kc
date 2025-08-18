// server.js — gpt-server-060kc (Render)용 [ESM + RAG 연동]
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

console.log("🚀 060KC gpt-server boot :: with /company-chat (RAG) & /chat");

const app = express();

// PORT (Render 필수)
const PORT = Number(process.env.PORT);
if (!PORT) { console.error("❌ PORT env missing"); process.exit(1); }

// RAG 서버 엔드포인트 (필수: 환경변수에서 주입 권장)
const RAG_ENDPOINT = process.env.RAG_ENDPOINT || "https://zero60kc-rag.onrender.com/ask";
// (참고) 임계값은 RAG 서버가 자체적으로 판정. 여기선 건드리지 않음.

app.use(cors({
  origin: [
    "https://www.060kc.com",
    "https://060kc.com",
    "http://localhost:8080",
    "http://127.0.0.1:8080"
  ],
  methods: ["POST","GET","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));
app.use(express.json({ limit: "2mb" }));

// 헬스체크
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 사람이음 템플릿
function handoffTemplate() {
  return `안녕하세요! 저희 060 케이씨 AI 상담원입니다.
정확한 안내를 위해 담당자 연결을 바로 도와드리겠습니다. 지금 연결해 드릴까요?
[문의: 070-8231-8295, 평일 09:00–18:00]`;
}

// ----- RAG 호출 유틸 -----
async function fetchRag(question) {
  try {
    const r = await fetch(RAG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    // 기대 스키마: { answer, hits, bestScore, found }
    const data = await r.json();
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const bestScore = typeof data.bestScore === "number" ? data.bestScore : (hits[0]?.score ?? 0);
    const found = data.found === true;
    const answer = (data.answer || "").trim();
    const context = hits.slice(0, 5).map(h => (h.text || `${h.question} ${h.answer}` || "")).join("\n\n");
    return { found, bestScore, answer, context };
  } catch (e) {
    console.error("[RAG fetch error]", e?.message || e);
    return { found: false, bestScore: 0, answer: "", context: "" };
  }
}

// ----- 회사 전용 라우트 (/company-chat) -----
app.post("/company-chat", async (req, res) => {
  try {
    const question = (req.body?.question || "").trim();
    if (!question) return res.json({ reply: handoffTemplate(), needs_handoff: true });

    // 1) RAG 검색
    const rag = await fetchRag(question);

    // 2) RAG가 직접 정답을 주면 그대로 반환
    if (rag.found && rag.answer && rag.answer.replace(/\s/g, "") !== "자료에없음") {
      return res.json({ reply: rag.answer, needs_handoff: false });
    }

    // 3) 컨텍스트 기반 OpenAI 요약 (컨텍스트가 있으면)
    if (rag.context) {
      const systemPrompt = `
당신은 060 케이씨(060KC) 회사 문서 전용 상담원입니다.
아래 CONTEXT(회사 자료)에 포함된 내용만 사용하여 한국어로 간결하고 정확하게 답합니다.
CONTEXT에 없는 내용은 절대 추정하지 말고 다음 문구로만 답합니다:
"자료에 없습니다. 고객센터로 문의해 주세요."
문체: 정중하고 간결. 과장/추측/일반지식 사용 금지.
`.trim();

      const userPrompt = `
[QUESTION]
${question}

[CONTEXT]
${rag.context}
`.trim();

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const r = await openai.chat.completions.create({
        model: process.env.CHAT_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      });

      const reply = r.choices?.[0]?.message?.content?.trim() || "";
      if (reply && !/자료에 없습니다/i.test(reply)) {
        return res.json({ reply, needs_handoff: false });
      }
    }

    // 4) 모두 실패 시 사람이음
    return res.json({ reply: handoffTemplate(), needs_handoff: true });
  } catch (e) {
    console.error("[/company-chat] error:", e?.message || e);
    return res.status(500).
