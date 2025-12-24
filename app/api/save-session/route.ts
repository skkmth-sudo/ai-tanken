// app/api/save-session/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type MsgIn = {
  role: "user" | "assistant";
  content?: string;
  text?: string;
  ts?: string; // クライアント側の発言時刻
};

type Body = {
  childId: string;
  week?: string;
  messages: MsgIn[];
};

// ------------------------------
// Validation / normalization
// ------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEK_RE = /^week([1-9]|10)$/i;

const MAX_MESSAGES_IN_REQUEST = 2000; // まずは過剰サイズを弾く
const MAX_MESSAGES_TO_STORE = 120; // DBに保存する最大（現状の実装と合わせる）
const MAX_CONTENT_LEN = 2000;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function normalizeWeek(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return "";
  return WEEK_RE.test(t) ? t.toLowerCase() : "";
}

function pickContent(m: MsgIn): string {
  const raw = m.content ?? m.text ?? "";
  const s = typeof raw === "string" ? raw : String(raw);
  return s.trim();
}

function normalizeTs(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return new Date().toISOString();
  // Date.parse が通る程度でOK（厳密ISOまで求めない）
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

function badRequest(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Body>;

    const childIdRaw = typeof body?.childId === "string" ? body.childId.trim() : "";
    const weekRaw = body?.week;
    const messagesRaw = Array.isArray(body?.messages) ? body.messages : [];

    if (!isUuid(childIdRaw)) {
      return badRequest("childId が不正です");
    }
    if (messagesRaw.length === 0) {
      return badRequest("messages が空です");
    }
    if (messagesRaw.length > MAX_MESSAGES_IN_REQUEST) {
      return badRequest("messages が多すぎます");
    }

    const week = normalizeWeek(weekRaw);
    // week が指定されているのに不正なら 400
    if (typeof weekRaw === "string" && weekRaw.trim() && !week) {
      return badRequest("week が不正です");
    }

    const childId = childIdRaw;
    const messages = messagesRaw;

    // ★ RLSを効かせるため、service_role ではなく anon + Bearer token で実行する
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json(
        { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です" },
        { status: 500 }
      );
    }
    const token = (getBearerToken(req) || "").trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "認証トークンがありません（Authorization: Bearer <token> が必須です）" },
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // 1) authユーザー取得（この token の本人）
    // - supabase-js のバージョン差で getUser(token) / getUser() の挙動が揺れることがあるため両対応
    console.log("[save-session] tokenLen=", token.length);

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
        return NextResponse.json(
          { ok: false, error: `認証に失敗しました: ${msg}` },
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
      return NextResponse.json({ ok: false, error: parentErr.message }, { status: 500 });
    }

    const parentId = (parentRow as any)?.id ?? null;
    if (!parentId) {
      return NextResponse.json(
        { ok: false, error: "parent レコードが見つかりません" },
        { status: 403 }
      );
    }

    // 3) childId がその parent に紐づくか
    const { data: childRow, error: childErr } = await supabase
      .from("children")
      .select("id")
      .eq("id", childId)
      .eq("parent_id", parentId)
      .maybeSingle();

    if (childErr) {
      return NextResponse.json({ ok: false, error: childErr.message }, { status: 500 });
    }
    if (!(childRow as any)?.id) {
      return NextResponse.json(
        { ok: false, error: "この childId はこのユーザーに紐づいていません" },
        { status: 403 }
      );
    }

    // ✅ 保存形式を { role, content, ts } に統一（互換のため text も残す）
    const mapped = messages
      .slice(-MAX_MESSAGES_TO_STORE)
      .map((m) => {
        const role = m?.role === "user" ? "user" : m?.role === "assistant" ? "assistant" : "";
        if (!role) return null;

        const content = pickContent(m);
        if (!content) return null;

        // 長すぎるメッセージは切り詰め（落とすより事故が少ない）
        const clipped = content.length > MAX_CONTENT_LEN ? content.slice(0, MAX_CONTENT_LEN) : content;

        return {
          role,
          content: clipped,
          text: clipped, // 互換
          ts: normalizeTs(m?.ts),
        };
      })
      .filter(Boolean) as { role: "user" | "assistant"; content: string; text: string; ts: string }[];

    if (mapped.length === 0) {
      return NextResponse.json({ ok: false, error: "有効な messages がありません" }, { status: 400 });
    }

    const payload: any = {
      parent_id: parentId,
      child_id: childId,
      messages: mapped,
    };
    if (week) payload.week = week;

    const { error: insertErr } = await supabase.from("chat_sessions").insert([payload]);

    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
