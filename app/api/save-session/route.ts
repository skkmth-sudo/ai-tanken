// app/api/save-session/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  childId: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const childId = (body.childId ?? "").trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];

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

    // guardian 側が期待している形：[{ role, text }]
    const mapped = messages
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        text: String(m.content ?? ""),
      }))
      .filter((m) => m.text.trim().length > 0);

    const { error } = await supabaseAdmin.from("chat_sessions").insert([
      {
        child_id: childId,
        messages: mapped,
      },
    ]);

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
