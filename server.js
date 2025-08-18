// server.js — gpt-server-060kc (Render)용 [ESM 버전]
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

console.log("🚀 060KC gpt-server boot :: with /company-chat route");

const app = express();

// PORT (Render 필수)
const PORT = Number(process.env.PORT);
if (!PORT) { console.error("❌ PORT env missing"); process.exit(1); }

// CORS: 실제 사용하는 도메인만
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

// 컨텍스트 전용 생성 라우트
app.post("/company-chat", async (req, res) => {
  try {
    const question = (req.body?.question || "").trim();
    const context  = (req.body?.context  || "").trim();
    if (!question || !context) {
      return res.json({ reply: handoffTemplate(), needs_handoff: true });
    }

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
${context}
`.trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt }
      ]
    });

    const reply = r.choices?.[0]?.message?.content?.trim() || "";
    if (!reply || /자료에 없습니다/i.test(reply)) {
      return res.json({ reply: handoffTemplate(), needs_handoff: true });
    }
    return res.json({ reply, needs_handoff: false });
  } catch (e) {
    console.error("[/company-chat] error:", e?.message || e);
    return res.status(500).json({ reply: handoffTemplate(), needs_handoff: true });
  }
});

// (옵션) 범용 채팅
app.post("/chat", async (req, res) => {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userMessage = req.body?.message || "";
    const r = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user",   content: userMessage }
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
