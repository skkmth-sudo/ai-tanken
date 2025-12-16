// app/api/save-session/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type MsgIn = {
  role: "user" | "assistant";
  content?: string;
  text?: string;
};

type Body = {
  childId: string;
  week?: string;
  messages: MsgIn[];
  // Authorization ヘッダが環境要因で落ちるケースの保険
  accessToken?: string;
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

    const childId = (body.childId ?? "").trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const week = (body.week ?? "").trim();

    if (!childId) {
      return NextResponse.json({ ok: false, error: "childId がありません" }, { status: 400 });
    }
    if (messages.length === 0) {
      return NextResponse.json({ ok: false, error: "messages が空です" }, { status: 400 });
    }

    // ★ RLSを効かせるため、service_role ではなく anon + Bearer token で実行する
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json(
        { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です" },
        { status: 500 }
      );
    }
    const token = (getBearerToken(req) || (body as any)?.accessToken || "").trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "認証トークンがありません（Bearer token 必須）" },
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

    // guardian 側が期待している形：[{ role, text }]
    const mapped = messages
      .slice(-120)
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        text: String((m.text ?? m.content ?? "") as string),
      }))
      .filter((m) => m.text.trim().length > 0);

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
