import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getWeekConfig, WeekId } from "@/lib/persona";

// 重要：ビルド時に落ちないように dynamic / nodejs を明示
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // ✅ APIキーがないときは “ここで” 返す（＝new OpenAI しない）
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        ok: false,
        reply:
          "ごめんね。じゅんびのカギ（OPENAI_API_KEY）がまだ入っていないみたい。大人の人に『Vercel の Environment Variables に OPENAI_API_KEY を入れてね』と伝えてもらえるかな？",
      });
    }

    // ✅ ここで初めて作る（＝ビルド時に例外が出ない）
    const client = new OpenAI({ apiKey });

    const cfg = getWeekConfig(week);

    const profileLines: string[] = [];
    if (profile?.grade) profileLines.push(`- 学年: ${profile.grade}`);
    if (profile?.nickname) profileLines.push(`- ニックネーム: ${profile.nickname}`);
    if (profile?.interests?.length) {
      profileLines.push(`- 興味のあること: ${profile.interests.join("、")}`);
    }

    const systemText =
      cfg.systemPrompt +
      (profileLines.length ? `\n\n【こどもの情報】\n${profileLines.join("\n")}` : "");

    const openaiMessages = [
      { role: "system" as const, content: systemText },
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
