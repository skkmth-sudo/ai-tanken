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
  // ChatPageClient から送られてくる WeekFlow（stage/slots）
  // 未対応週は送られない/無視される前提で後方互換を保つ
  weekFlow?: {
    week: string;
    stage: string;
    slots: any;
  };
};

// ------------------------------
// Validation / normalization
// ------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEK_RE = /^week([1-9]|[1-4][0-9]|5[0-2])$/i; // week1〜week52

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

// ------------------------------
// WeekFlow（Weekごとの stage/slots）
// - 抽出や充足判定はクライアント側で行い、ここでは受け取って安全に正規化
// - 先生の文章生成は /api/chat に残す（ニックネーム呼び・変更検知を維持）
// ------------------------------

type Week1Stage = "ASK_LIKES" | "ASK_FAVORITE" | "ASK_REASON" | "GENERATE";

type Week1Flow = {
  week: "week1";
  stage: Week1Stage;
  slots: {
    likes: string[];
    favorite?: string;
    favorite_reason?: string;
  };
};

const MAX_LIKE_LEN = 30;
const MAX_REASON_LEN = 80;

function normalizeWeekFlow(v: unknown, week: WeekId): Week1Flow | null {
  // まずは Week1 だけ対応（他週は後方互換のため無視）
  if (week !== "week1") return null;
  if (!v || typeof v !== "object") return null;

  const obj = v as any;
  const stageRaw = typeof obj.stage === "string" ? obj.stage.trim() : "";
  const stage: Week1Stage =
    stageRaw === "ASK_LIKES" ||
    stageRaw === "ASK_FAVORITE" ||
    stageRaw === "ASK_REASON" ||
    stageRaw === "GENERATE"
      ? stageRaw
      : "ASK_LIKES";

  const slotsRaw = obj.slots && typeof obj.slots === "object" ? obj.slots : {};

  const likesRaw = Array.isArray(slotsRaw.likes) ? slotsRaw.likes : [];
  const likes = likesRaw
    .filter((x: any) => typeof x === "string")
    .map((x: string) => clip(x, MAX_LIKE_LEN))
    .filter(Boolean)
    .slice(0, 3);

  const favoriteRaw =
    typeof slotsRaw.favorite === "string"
      ? clip(slotsRaw.favorite, MAX_LIKE_LEN)
      : "";
  const favorite = favoriteRaw && likes.includes(favoriteRaw) ? favoriteRaw : undefined;

  const reasonRaw =
    typeof slotsRaw.favorite_reason === "string"
      ? clip(slotsRaw.favorite_reason, MAX_REASON_LEN)
      : "";
  const favorite_reason = reasonRaw ? reasonRaw : undefined;

  return {
    week: "week1",
    stage,
    slots: { likes, favorite, favorite_reason },
  };
}

function buildWeekFlowSystemText(flow: Week1Flow | null) {
  if (!flow) return "";

  // ★ここでは“内部状態の表示”はしない（会話が機械的になるため）。
  // 目的：stage に応じて、短く自然な会話で前に進める。
  return `

【Week1（自己紹介）ガイド】
- あなたは子ども向けの先生。やさしい日本語で、1回の返答は短め。
- stage に応じて次をする：
  - ASK_LIKES：好きなものを3つ聞く（例も出してOK）。
  - ASK_FAVORITE：likes の中から一番好きなものを1つ選ばせる。
  - ASK_REASON：理由を1つだけ聞く。もし子どもが「わからない／とくにない」などと言ったら、例を3〜5個出してあげて、どれが近いか選ばせたり、まねして言わせる。例：「たのしいから」「きもちがいいから」「うまくできたから」「かわいいから」「かっこいいから」。
  - GENERATE：完成文を代わりに書かない。子どもが自分で自己紹介を書くための「型」「チェック」「言い換え候補」を出して、書けたら送ってもらう（文の数は自由。短くてもOK）。
- ニックネームがある場合は、2〜4回に1回くらいの自然な頻度で呼ぶ。`;
}

function buildOpeningMessage(defaultOpening: string, flow: Week1Flow | null) {
  if (!flow) return defaultOpening;
  const likes = flow.slots.likes.join("、");
  const fav = flow.slots.favorite ?? "";
  const reason = flow.slots.favorite_reason ?? "";

  switch (flow.stage) {
    case "ASK_LIKES":
      return "好きなものを3つ教えて！たとえば『好きな教科』『好きな遊び』『好きな色』みたいに、なんでもOKだよ。『〇〇と〇〇と〇〇が好き』って言ってみてね。";
    case "ASK_FAVORITE":
      return likes
        ? `教えてくれた「${likes}」の中で、一番好きなのはどれ？`
        : "さっき教えてくれた好きなものの中で、一番好きなのはどれ？";
    case "ASK_REASON":
      return fav
        ? `「${fav}」のどこが好き？理由は1つだけでOKだよ。`
        : "一番好きなもののどこが好き？理由は1つだけでOKだよ。";
    case "GENERATE":
      return `ここまでのまとめだよ。好きなもの：${likes || "（まだメモ中）"}。いちばん好き：${fav || "（まだ）"}。理由：${reason || "（まだ）"}。

じゃあ、きみの言葉で自己紹介を書いてみよう！文の数は自由（短くてもOK）。書けたら送ってね。言いかえや、もう少しよくする手伝いをするよ。`;
  }
}
// ------------------------------
// 学年に合わせた漢字レベル（AI返答のみ）
// - profile.grade から小学校の学年（1〜6）を推定
// - system に表記ルールを追加して、返答を学年レベルに寄せる
// ------------------------------

function parseElementaryGrade(gradeStr: string | undefined): number | null {
  const s = (gradeStr ?? "").trim();
  if (!s) return null;

  // 全角数字→半角
  const normalized = s.replace(/[０-９]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0xfee0)
  );

  // 例: 小1, 小学1, 1年, １ねん, Grade 1
  const m = normalized.match(/(?:小|小学|しょうがく)?\s*([1-6])\s*(?:年|ねん|grade)?/i);
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : null;
}

function buildOrthographyRule(gradeStr: string | undefined) {
  const g = parseElementaryGrade(gradeStr);
  if (!g) return "";

  const base =
    "\n\n【表記ルール（学年に合わせる）】\n" +
    "- 返答は『小" + g + "』で習う範囲の漢字まで。\n" +
    "- 迷った漢字は、ひらがなにする。\n" +
    "- 文は短め。むずかしい言葉は、やさしい言い方に言いかえる。";

  if (g <= 2) return base + "\n- 低学年なので、基本はひらがな多めでOK。";
  if (g <= 4) return base + "\n- 中学年なので、読みやすさを優先してむずかしい漢字は使わない。";
  return base;
}

// ------------------------------
// Week1 生成検証（発明コアの安定化）
// - 以前：AIが完成文を生成→欠けがあれば自動修正
// - 現在：子ども本人が完成文を書く（AIは補助のみ）
//   → そのため“自動で完成文を作り直す”修正生成は無効化
// ------------------------------

const WEEK1_ASSIST_ONLY = true;

function countSentencesJa(text: string) {
  const t = (text || "").trim();
  if (!t) return 0;
  const marks = t.match(/[。！？!?]/g);
  // 句点が無いときは 1 文扱い
  return Math.max(1, marks ? marks.length : 0);
}

function week1NeedsRepair(reply: string, flow: Week1Flow) {
  if (WEEK1_ASSIST_ONLY) return false;
  const r = (reply || "").trim();
  const likes = flow.slots.likes || [];
  const fav = flow.slots.favorite || "";
  const reason = flow.slots.favorite_reason || "";

  // slot が揃っていないなら repair せず（前段階の想定）
  if (likes.length < 3 || !fav || !reason) return false;

  const hasAllLikes = likes.every((x) => x && r.includes(x));
  const hasFav = fav && r.includes(fav);
  const hasReason = reason && r.includes(reason);

  const n = countSentencesJa(r);
  const sentenceOk = n >= 2 && n <= 4; // 「3文くらい」許容

  return !(hasAllLikes && hasFav && hasReason && sentenceOk);
}

function buildWeek1RepairPrompt(flow: Week1Flow, badReply: string) {
  const likes = flow.slots.likes.join("、");
  const fav = flow.slots.favorite ?? "";
  const reason = flow.slots.favorite_reason ?? "";

  return `次の素材を必ず入れて、自己紹介文を“3文”で作り直してください。

【必須素材】
- 好きなもの（3つ）: ${likes}
- 一番好き: ${fav}
- 理由（1つ）: ${reason}

【制約】
- 出力は文章のみ（見出し/箇条書き/番号なし）
- ちょうど3文（。で3つ）
- かならず上の素材を全部ふくめる

【直前の返答（不完全かもしれない）】
${badReply}`;
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

    // WeekFlow（stage/slots）を正規化（未送信・未対応週は null）
    const weekFlow = normalizeWeekFlow((bodyUnknown as any)?.weekFlow, week);

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

    // ★ 学年に合わせた漢字レベル（AI返答のみ）
    const orthographyRule = buildOrthographyRule(profile?.grade);
    const weekFlowText = buildWeekFlowSystemText(weekFlow);

    const systemText =
      cfg.systemPrompt +
      (profileLines.length
        ? `

【こどもの情報】
${profileLines.join("\n")}
`
        : "") +
      nicknameRule +
      orthographyRule +
      weekFlowText;



    // OpenAIに送る履歴は最新側だけに圧縮（重さ対策 + 予期せぬ長文を避ける）
    const trimmedHistory = (messages ?? []).slice(-60);

    const opening =
      trimmedHistory.length === 0
        ? nickname
          ? buildOpeningMessage(cfg.openingMessage, weekFlow)
          : "はじめまして！まず、なんて呼んだらいい？（ニックネーム）を教えてね。その名前で呼ぶよ。"
        : "";

    const openaiMessages = [
      { role: "system" as const, content: systemText },
      ...(opening ? [{ role: "assistant" as const, content: opening }] : []),
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

    // ✅ Week1（GENERATE）の生成検証：欠けがあれば1回だけ修正生成
    if (weekFlow && weekFlow.week === "week1" && weekFlow.stage === "GENERATE") {
      try {
        if (week1NeedsRepair(reply, weekFlow)) {
          const repairUser = buildWeek1RepairPrompt(weekFlow, reply);
          const repairMessages = [
            { role: "system" as const, content: systemText },
            { role: "user" as const, content: repairUser },
          ];

          const repaired = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: repairMessages,
            temperature: 0.2,
            max_tokens: 220,
          });

          const repairedText = repaired.choices[0]?.message?.content?.trim();
          if (repairedText) reply = repairedText;
        }
      } catch (e: any) {
        // 検証/修正に失敗しても、元の reply を返す（落とさない）
        console.error("[api/chat] week1 repair failed:", e?.message ?? e);
      }
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
