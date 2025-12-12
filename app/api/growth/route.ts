import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai"; // 追加

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const prompt = `
以下は子どもの会話ログです。
文章の癖・言語発達・語彙の使い方を見て、
「成長ポイント」を3つだけやさしく書いてください。

条件:
- 箇条書き
- 「できたこと」「使えていた」「挑戦できた」など肯定ワード必須
- 指導目線ではなく成長観察目線
- 厳しさや減点表現は禁止

# 会話ログ
${JSON.stringify(messages)}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0].message.content ?? "";

    // 箇条書き → 配列へ
    const growthPoints = text
      .split("\n")
      .map((line) => line.replace(/^[・\-●\*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3);

    return NextResponse.json({ growthPoints });
  } catch (e) {
    console.error("growth API error", e);
    return NextResponse.json({ error: "fail" }, { status: 500 });
  }
}
