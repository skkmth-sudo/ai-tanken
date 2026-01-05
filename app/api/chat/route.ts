// FILE: app/api/chat/route.ts
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
  childId: string;
  messages: SimpleMsg[];
  week: WeekId;
  profile?: {
    grade?: string;
    nickname?: string;
    interests?: string[];
  };
};

// ------------------------------
// Validation / normalization
// ------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEK_RE = /^week([1-9]|10)$/i;

const MAX_MESSAGES_IN_REQUEST = 200; // まずは過剰サイズを弾く（チャットはこれで十分）
const MAX_CONTENT_LEN = 2000;
const MAX_INTERESTS = 8;
const MAX_INTEREST_LEN = 40;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function normalizeWeek(v: unknown): WeekId | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return null;
  if (!WEEK_RE.test(t)) return null;
  return t.toLowerCase() as WeekId;
}

function clip(s: string, max = MAX_CONTENT_LEN) {
  const t = (s ?? "").toString().trim();
  return t.length > max ? t.slice(0, max) : t;
}

function normalizeMessages(v: unknown): SimpleMsg[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length === 0) return [];
  if (v.length > MAX_MESSAGES_IN_REQUEST) return null;

  const out: SimpleMsg[] = [];
  for (const raw of v) {
    const role = (raw as any)?.role;
    const content = (raw as any)?.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const c = clip(content);
    if (!c) continue;
    out.push({ role, content: c });
  }
  return out;
}

function normalizeProfile(v: unknown): Body["profile"] {
  const p = v && typeof v === "object" ? (v as any) : {};
  const grade = typeof p.grade === "string" ? clip(p.grade, 30) : undefined;
  const nickname =
    typeof p.nickname === "string" ? clip(p.nickname, 20) : undefined;

  const interestsRaw = Array.isArray(p.interests) ? p.interests : [];
  const interests = interestsRaw
    .filter((x: any) => typeof x === "string")
    .map((x: string) => clip(x, MAX_INTEREST_LEN))
    .filter(Boolean)
    .slice(0, MAX_INTERESTS);

  const cleaned: Body["profile"] = {};
  if (grade) cleaned.grade = grade;
  if (nickname) cleaned.nickname = nickname;
  if (interests.length) cleaned.interests = interests;
  return cleaned;
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

function jsonErr(status: number, reply: string) {
  return NextResponse.json({ ok: false, reply }, { status });
}

export async function POST(req: Request) {
  try {
    const bodyUnknown = (await req.json()) as unknown;

    const childId =
      typeof (bodyUnknown as any)?.childId === "string"
        ? (bodyUnknown as any).childId.trim()
        : "";

    const week = normalizeWeek((bodyUnknown as any)?.week);
    const messages = normalizeMessages((bodyUnknown as any)?.messages);
    const profile = normalizeProfile((bodyUnknown as any)?.profile);

    // ---- Request validation ----
    if (!isUuid(childId)) {
      return jsonErr(
        400,
        "子ども情報が見つからないよ（childId が不正です）。保護者マイページから入り直してね。"
      );
    }
    if (!week) {
      return jsonErr(
        400,
        "週の情報が不正みたい（week が不正です）。保護者マイページから入り直してね。"
      );
    }
    if (messages === null) {
      return jsonErr(
        400,
        "メッセージが多すぎるか形式が不正です。もう一度ためしてみてね。"
      );
    }

    // ✅ Supabase（RLS前提）: anon + Bearer token で実行
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return jsonErr(
        500,
        "サーバーの設定が足りないみたい（SUPABASE設定）。大人の人に確認してもらってね。"
      );
    }

    const token = (getBearerToken(req) || "").trim();
    if (!token) {
      return jsonErr(
        401,
        "ログインが必要だよ（認証トークンがありません）。/guardian/login からログインしてね。"
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

      // まず getUser(token)
      try {
        const r = await authAny.getUser(token);
        userData = r?.data;
        userErr = r?.error;
      } catch (e) {
        userErr = e;
      }

      // ダメなら getUser()（global Authorization を使う）
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
        return jsonErr(401, `ログイン情報の確認に失敗したよ: ${msg}`);
      }
    }

    // 2) parent特定
    const { data: parentRow, error: parentErr } = await supabase
      .from("parent")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (parentErr) {
      console.error("[api/chat] parent select error:", parentErr.message);
      return jsonErr(
        500,
        "サーバー側で問題が起きたみたい。もう一度ためしてみてね。"
      );
    }
    const parentId = (parentRow as any)?.id ?? null;
    if (!parentId) {
      return jsonErr(
        403,
        "保護者情報が見つからないよ。/guardian/login から入り直してね。"
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
      console.error("[api/chat] child check error:", childErr.message);
      return jsonErr(
        500,
        "サーバー側で問題が起きたみたい。もう一度ためしてみてね。"
      );
    }
    if (!(childRow as any)?.id) {
      return jsonErr(
        403,
        "この子ども情報では会話できないよ（権限がありません）。"
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

    // OpenAIに送る履歴は最新側だけに圧縮（重さ対策 + 予期せぬ長文を避ける）
    const trimmedHistory = (messages ?? []).slice(-60);

    const openaiMessages = [
      { role: "system" as const, content: systemText },
      { role: "assistant" as const, content: cfg.openingMessage },
      ...trimmedHistory.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: clip(m.content),
      })),
    ];

    let reply = "";
    try {
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: openaiMessages,
        temperature: 0.7,
        max_tokens: 400,
      });

      reply =
        resp.choices[0]?.message?.content?.trim() ??
        "エラーが起きたみたい。もう一度ためしてみてね。";
    } catch (e: any) {
      console.error("[api/chat] openai error:", e?.message ?? e);
      return jsonErr(
        500,
        "今はお返事が作れないみたい。少し時間をおいて、もう一度ためしてみてね。"
      );
    }

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
  } catch (err: any) {
    console.error("[api/chat] unexpected:", err?.message ?? err);
    return NextResponse.json(
      { ok: false, reply: "エラーが起きたみたい。もう一度ためしてみてね。" },
      { status: 500 }
    );
  }
}
