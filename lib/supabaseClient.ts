// lib/supabaseClient.ts
import "client-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ❌ ここで throw しない（Vercel/Next のビルドが死ぬ）
// ⭕ 実行時にだけ警告し、未設定時はダミークライアントを返す
export const supabase = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      "Supabase env is missing. Check NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );

    // ダミークライアント（ログイン/DBアクセスが走る画面で使われると失敗する）
    return createClient("https://dummy.supabase.co", "dummy-key");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Guardian ログインのセッションを維持したいので基本ON
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();

// ★ トークン取得（save-session に Authorization: Bearer を付けたいときに使う）
// - 取れない場合は "" を返す
export async function getAccessToken(): Promise<string> {
  // ★ Supabase未設定なら絶対に取れないので即return（ダミークライアント誤動作防止）
  if (!supabaseUrl || !supabaseAnonKey) return "";

  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  } catch {
    return "";
  }
}
