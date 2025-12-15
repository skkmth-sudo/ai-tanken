// app/api/save-session/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type MsgIn = {
  role: "user" | "assistant";
  // クライアント側の送信揺れ（content/text）に対応
  content?: string;
  text?: string;
};

type Body = {
  childId: string;
  week?: string;
  messages: MsgIn[];
};

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return "";
  const m = h.match(/^Bearer\\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const childId = (body.childId ?? "").trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const week = (body.week ?? "").trim();

    if (!childId) {
      return NextResponse.json(
        { ok: false, error: "childId がありません" },
        { status: 400 }
      );
    }

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(url, serviceKey);

    // --- 本番の不正防止：親のログイン情報を確認 ---
    // Guardian→トーク→保存 の導線が出来てきたので、ここで改ざんを弾く。
    // 仕組み：Authorization: Bearer <access_token> が来たら、そのユーザーに紐づく childId か検証。
    // ※ まだトーク画面からトークンを送っていない場合、開発中は通す（本番では弾く）。
    const token = getBearerToken(req);
    const isProd = process.env.NODE_ENV === "production";

    if (!token) {
      if (isProd) {
        return NextResponse.json(
          { ok: false, error: "認証トークンがありません（Bearer token 必須）" },
          { status: 401 }
        );
      }
      // 開発中は一旦スルー（※本番前に必ずトークン送信へ移行）
    } else {
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
      const uid = userData?.user?.id ?? "";
      if (userErr || !uid) {
        return NextResponse.json(
          { ok: false, error: "認証に失敗しました" },
          { status: 401 }
        );
      }

      // 1) parent テーブルに user_id（= auth.users.id）を持っている想定
      let parentId: string | null = null;
      const { data: parentRow } = await supabaseAdmin
        .from("parent")
        .select("id")
        .eq("user_id", uid)
        .maybeSingle();
      parentId = (parentRow as any)?.id ?? null;

      // 2) childId がその parent に紐づくかチェック
      //    children.parent_id が parent.id の場合と、直接 uid を持つ場合の両方にフォールバック。
      let allowed = false;
      if (parentId) {
        const { data: childRow } = await supabaseAdmin
          .from("children")
          .select("id")
          .eq("id", childId)
          .eq("parent_id", parentId)
          .maybeSingle();
        allowed = !!(childRow as any)?.id;
      }
      if (!allowed) {
        const { data: childRow2 } = await supabaseAdmin
          .from("children")
          .select("id")
          .eq("id", childId)
          .eq("parent_id", uid)
          .maybeSingle();
        allowed = !!(childRow2 as any)?.id;
      }

      if (!allowed) {
        return NextResponse.json(
          { ok: false, error: "この childId はこのユーザーに紐づいていません" },
          { status: 403 }
        );
      }
    }

    // guardian 側が期待している形：[{ role, text }]
    const mapped = messages
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        text: String((m.text ?? m.content ?? "") as string),
      }))
      .filter((m) => m.text.trim().length > 0);

    const insertPayload: any = {
      child_id: childId,
      messages: mapped,
    };
    if (week) insertPayload.week = week;

    const { error } = await supabaseAdmin.from("chat_sessions").insert([insertPayload]);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
