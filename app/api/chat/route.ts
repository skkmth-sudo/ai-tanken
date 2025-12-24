import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getWeekConfig, WeekId } from "@/lib/persona";

// 重要：ビルド時に落ちないように dynamic / nodejs を明示
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SimpleMsg = {
  role: "user" | "assistant";
  content: string;
};

type Body = {
  childId: string;              // ✅ 追加（親の子かチェックするため必須）
  messages: SimpleMsg[];
  week: WeekId;
  profile?: {
    grade?: string;
    nickname?: string;
    interests?: string[];
  };
};

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { messages, week, profile } = body;
    const childId = (body.childId ?? "").trim();

    if (!childId) {
      return NextResponse.json(
        { ok: false, reply: "子ども情報が見つからないよ（childId がありません）。保護者マイページから入り直してね。" },
        { status: 400 }
      );
    }

    // ✅ Supabase（RLS前提）: anon + Bearer token で実行
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json(
        { ok: false, reply: "サーバーの設定が足りないみたい（SUPABASE設定）。大人の人に確認してもらってね。" },
        { status: 500 }
      );
    }

    const token = (getBearerToken(req) || "").trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, reply: "ログインが必要だよ（認証トークンがありません）。/guardian/login からログインしてね。" },
        { status: 401 }
      );
    }

    const supabase = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    // 1) authユーザー取得（token の本人）
    let uid = "";
    {
      const authAny = (supabase as any).auth;
      let userData: any = null;
      let userErr: any = null;

      try {
        const r = await authAny.getUser(token);
        userData = r?.data;
        userErr = r?.error;
      } catch (e) {
        userErr = e;
      }

      if (userErr || !userData?.user?.id) {
        try {
          const r2 = await authAny.getUser();
          userData = r2?.data;
          userErr = r2?.error;
        } catch (e) {
          userErr = e;
        }
      }

      uid = userData?.user?.id ?? "";
      if (userErr || !uid) {
        const msg = userErr?.message ?? String(userErr ?? "invalid token");
        return NextResponse.json(
          { ok: false, reply: `ログイン情報の確認に失敗したよ: ${msg}` },
          { status: 401 }
        );
      }
    }

    // 2) parent特定
    const { data: parentRow, error: parentErr } = await supabase
      .from("parent")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (parentErr) {
      return NextResponse.json({ ok: false, reply: parentErr.message }, { status: 500 });
    }
    const parentId = (parentRow as any)?.id ?? null;
    if (!parentId) {
      return NextResponse.json(
        { ok: false, reply: "保護者情報が見つからないよ。/guardian/login から入り直してね。" },
        { status: 403 }
      );
    }

    // 3) childId がその parent に紐づくか（最重要）
    const { data: childRow, error: childErr } = await supabase
      .from("children")
      .select("id")
      .eq("id", childId)
      .eq("parent_id", parentId)
      .maybeSingle();

    if (childErr) {
      return NextResponse.json({ ok: false, reply: childErr.message }, { status: 500 });
    }
    if (!(childRow as any)?.id) {
      return NextResponse.json(
        { ok: false, reply: "この子ども情報では会話できないよ（権限がありません）。" },
        { status: 403 }
      );
    }

    // ✅ OpenAI APIキーがないときは “ここで” 返す（＝new OpenAI しない）
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
    const nickname = (profile?.nickname ?? "").trim();

    if (profile?.grade) profileLines.push(`- 学年: ${profile.grade}`);
    if (nickname) profileLines.push(`- ニックネーム: ${nickname}`);
    if (profile?.interests?.length) {
      profileLines.push(`- 興味のあること: ${profile.interests.join("、")}`);
    }

    // ★ ニックネーム呼びかけ頻度：毎回は避けて「定期的に」
    const nicknameRule = nickname
      ? `

【呼びかけ方】
- ニックネーム「${nickname}」は毎回は使わない。自然なタイミングで“定期的に”（目安：2〜4回に1回、または話題転換・褒める・まとめ・確認・注意喚起のとき）呼ぶ。
- 呼びかけが不自然なときは省略してよい。`
      : "";

    const systemText =
      cfg.systemPrompt +
      (profileLines.length
        ? `

【こどもの情報】
${profileLines.join("\n")}`
        : "") +
      nicknameRule;

    const openaiMessages = [
      { role: "system" as const, content: systemText },
      { role: "assistant" as const, content: cfg.openingMessage },
      ...(messages ?? []).map((m) => ({
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

    let reply =
      resp.choices[0]?.message?.content?.trim() ??
      "エラーが起きたみたい。もう一度ためしてみてね。";

    // ✅ “定期的に名前で呼ぶ”を確実にする保険
    if (nickname) {
      const userTurns = (messages ?? []).filter((m) => m.role === "user").length;
      const shouldCall = userTurns > 0 && userTurns % 3 === 0;
      const alreadyCalled = reply.includes(nickname);
      const tooShort = reply.length < 8;

      if (shouldCall && !alreadyCalled && !tooShort) {
        reply = `${nickname}、${reply}`;
      }
    }

    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { ok: false, reply: "エラーが起きたみたい。もう一度ためしてみてね。" },
      { status: 500 }
    );
  }
}
