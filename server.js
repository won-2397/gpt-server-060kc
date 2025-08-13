// server.js (Render 호환)
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");

const app = express();

// ⭐ Render가 주는 PORT만 사용 (기본값 X)
const PORT = Number(process.env.PORT);
if (!PORT) {
  console.error("❌ PORT env missing. Render Web Service는 PORT로만 리슨해야 합니다.");
  process.exit(1);
}

// CORS: 실제 쓰는 도메인만
app.use(cors({
  origin: [
    "https://www.060kc.com",
    "https://060kc.com",
    "http://localhost:8080",
  ],
  methods: ["POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 헬스체크(디버그용)
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/chat", async (req, res) => {
  const userMessage = req.body?.message || "";
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || "gpt-4o-mini", // gpt-3.5-turbo 대신 권장
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: userMessage },
      ],
    });
    const reply = completion.choices[0]?.message?.content ?? "";
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI error:", err?.message || err);
    res.status(500).json({ error: "GPT 서버 오류 발생" });
  }
});

// ⭐ 외부 바인딩
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 listening on 0.0.0.0:${PORT}`);
});
