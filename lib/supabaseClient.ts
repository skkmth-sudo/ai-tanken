import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ❌ ここで throw しない（ビルドが死ぬ）
// ⭕ 実行時にだけエラーにする
export const supabase = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      "Supabase env is missing. Check NEXT_PUBLIC_SUPABASE_URL / ANON KEY."
    );

    // ダミークライアント（未ログイン画面では使われない）
    return createClient("https://dummy.supabase.co", "dummy-key");
  }

  return createClient(supabaseUrl, supabaseAnonKey);
})();
