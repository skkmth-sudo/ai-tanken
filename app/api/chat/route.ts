import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getWeekConfig, WeekId } from "@/lib/persona";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type SimpleMsg = {
  role: "user" | "assistant";
  content: string;
};

type Body = {
  messages: SimpleMsg[];
  week: WeekId;
  profile?: {
    grade?: string;
    nickname?: string;
    interests?: string[];
  };
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { messages, week, profile } = body;

    // APIキーがないときは子ども向けのメッセージだけ返す
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        ok: false,
        reply:
          "ごめんね。じゅんびのカギ（OPENAI_API_KEY）がまだ入っていないみたい。大人の人に『.env.local に OPENAI_API_KEY を入れてね』と伝えてもらえるかな？",
      });
    }

    const cfg = getWeekConfig(week);

    const profileLines: string[] = [];
    if (profile?.grade) profileLines.push(`- 学年: ${profile.grade}`);
    if (profile?.nickname) profileLines.push(`- ニックネーム: ${profile.nickname}`);
    if (profile?.interests?.length) {
      profileLines.push(`- 興味のあること: ${profile.interests.join("、")}`);
    }

    const systemText =
      cfg.systemPrompt +
      (profileLines.length
        ? `\n\n【こどもの情報】\n${profileLines.join("\n")}`
        : "");

    const openaiMessages = [
      { role: "system" as const, content: systemText },
      // 念のため、最初の導入文もコンテキストに入れておく
      { role: "assistant" as const, content: cfg.openingMessage },
      ...messages.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
    ];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: openaiMessages,
      temperature: 0.7,
      max_tokens: 400,
    });

    const reply =
      resp.choices[0]?.message?.content?.trim() ??
      "エラーが起きたみたい。もう一度ためしてみてね。";

    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    console.error(err);
    return NextResponse.json({
      ok: false,
      reply: "エラーが起きたみたい。もう一度ためしてみてね。",
    });
  }
}
