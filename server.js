const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();
const OpenAI = require("openai");

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: userMessage },
      ],
    });

    console.log("🧠 GPT 응답 전체:", JSON.stringify(completion, null, 2));
    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error("Error with OpenAI API:", err.message);
    res.status(500).json({ error: "GPT 서버 오류 발생" });
  }
});

app.listen(port, () => {
  console.log(`✅ GPT 서버가 http://localhost:${port} 에서 실행 중입니다!`);
});
