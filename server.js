// server.js — gpt-server-060kc (Render)용 [ESM + RAG 연동/내구성 강화본]
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const FALLBACK_LINES = [
  "그 사항은 회사 내부 자료에서 검색되지 않습니다.",
  "회사 내부 자료는 보완하겠습니다.",
  "오늘은 우선 담당자에게 문의주시기 바랍니다.",
  "📞 070-8231-8295로 바로 전화하기 / 평일 09:00–18:00"
];
const FALLBACK_MSG = FALLBACK_LINES.join("\n");

console.log("🚀 060KC gpt-server boot :: with /company-chat (RAG) & /chat");

const app = express();

// ===== 필수 환경 =====
const PORT = Number(process.env.PORT);
if (!PORT) {
  console.error("❌ PORT env missing");
  process.exit(1);
}

// RAG 서버 엔드포인트 (필수: 환경변수 권장)
const RAG_ENDPOINT =
  process.env.RAG_ENDPOINT || "https://zero60kc-rag.onrender.com/ask";

// (선택) 보조판정용 임계값 — RAG 서버의 threshold와 맞추면 좋음
const RAG_THRESHOLD = Number(process.env.RAG_THRESHOLD || 0.35);

// ===== 공통 미들웨어 =====
app.use(
  cors({
    origin: [
      "https://www.060kc.com",
      "https://060kc.com",
      "http://localhost:8080",
      "http://127.0.0.1:8080"
    ],
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(express.json({ limit: "2mb" }));

// 헬스체크
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 사람이음 템플릿
function handoffTemplate() {
  return `안녕하세요! 저희 060 케이씨 AI 상담원입니다.
정확한 안내를 위해 담당자 연결을 바로 도와드리겠습니다. 지금 연결해 드릴까요?
[문의: 070-8231-8295, 평일 09:00–18:00]`;
}

// “자료에 없음” 완전일치 판별(공백/마침표 제거 후 비교)
function isExactNoData(text = "") {
  const compact = String(text).replace(/[\s.]/g, "");
  const candidates = [
    "자료에없습니다고객센터로문의해주세요",
    "자료에없습니다고객센터로문의해주세요",
    "자료에없음"
  ];
  return candidates.includes(compact);
}

// ----- RAG 호출 유틸 -----
async function fetchRag(question) {
  try {
    const r = await fetch(RAG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // rewrite 파라미터는 RAG 서버에서 무시해도 무방
      body: JSON.stringify({ question, rewrite: true })
    });

    const data = await r.json().catch(() => ({}));
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const bestScore =
      typeof data.bestScore === "number" ? data.bestScore : (hits[0]?.score ?? 0);

    // 보조 판정: RAG 서버의 found가 true이거나, 점수가 임계값 이상
    const found = data.found === true || (hits.length > 0 && bestScore >= RAG_THRESHOLD);

    // 상위 히트 텍스트 합쳐서 컨텍스트 구성
    const top = hits.slice(0, 5);
    const context = top
      .map(h => (h.text || `${h.question ?? ""} ${h.answer ?? ""}`).trim())
      .filter(Boolean)
      .join("\n\n");

    return {
      found,
      bestScore,
      answer: (data.answer || "").trim(),
      context
    };
  } catch (e) {
    console.error("[RAG fetch error]", e?.message || e);
    return { found: false, bestScore: 0, answer: "", context: "" };
  }
}

// ----- 디버그: gpt-server → RAG 직통 핑 -----
app.get("/debug/rag-ping", async (_req, res) => {
  try {
    const r = await fetch(RAG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "설치비가 있나요?" })
    });
    const text = await r.text();
    res.status(r.status).type("text/plain").send(text);
  } catch (e) {
    res.status(500).type("text/plain").send(String(e?.message || e));
  }
});

// ----- 회사 전용 라우트 (/company-chat) -----
// 1) 질문 파싱(여러 키 허용) → 2) RAG 검색 → 3) 직접답 or 컨텍스트 요약 → 4) 실패 시 사람이음
app.post("/company-chat", async (req, res) => {
  try {
    // 프런트가 어떤 키로 보내도 읽히도록 방어
    const question = (
      req.body?.question ??
      req.body?.q ??
      req.body?.message ??
      req.body?.text ??
      req.body?.prompt ??
      ""
    ).toString().trim();

    if (!question) {
      console.warn("[company-chat] empty question body:", req.body);
      return res.json({ reply: FALLBACK_MSG, needs_handoff: true });
    }

    // 1) RAG 호출
    const rag = await fetchRag(question);
    console.log("[RAG]", { found: rag.found, bestScore: rag.bestScore, ctxLen: rag.context?.length || 0 });

    // 2) RAG가 직접 정답을 주면 그대로 반환 (단, “자료에 없음” 완전일치 제외)
    if (rag.answer && !isExactNoData(rag.answer) && rag.found) {
      return res.json({ reply: rag.answer, needs_handoff: false });
    }


    // 2-1) 내부 자료 미발견 → 즉시 폴백
    const noData =
      !rag?.found ||
      isExactNoData(rag?.answer) ||
      (typeof rag?.bestScore === "number" && rag.bestScore < RAG_THRESHOLD);
    if (noData) {
      return res.json({ reply: FALLBACK_MSG, needs_handoff: true });
    }



    // 3) 컨텍스트가 있으면 OpenAI로 요약 시도 (found 여부와 무관)
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
        temperature: 0.0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      });

      const reply = (r.choices?.[0]?.message?.content || "").trim();
      console.log("[LLM reply]", reply);

      if (reply && !isExactNoData(reply)) {
        return res.json({ reply, needs_handoff: false });
      }
    }

    // 4) 모두 실패 시 사람이음
    return res.json({ reply: FALLBACK_MSG, needs_handoff: true });
  } catch (e) {
    console.error("[/company-chat] error:", e?.message || e);
    return res.status(500).json({ reply: FALLBACK_MSG, needs_handoff: true });
  }
});

// (옵션) 범용 채팅 유지
app.post("/chat", async (req, res) => {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userMessage = (req.body?.message || "").toString();
    const r = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: userMessage }
      ]
    });
    res.json({ reply: r.choices?.[0]?.message?.content ?? "" });
  } catch (e) {
    console.error("[/chat] error:", e?.message || e);
    res.status(500).json({ error: "GPT 서버 오류 발생" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ company-chat ONLINE on 0.0.0.0:${PORT}`);
});
