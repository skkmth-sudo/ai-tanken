// lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase URL または ANON KEY が設定されていません。.env.local を確認してください。'
  );
}

// ひとまずブラウザ用のシングルトンとして使う
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
