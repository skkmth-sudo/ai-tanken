// FILE: app/guardian/RequireAuth.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session ?? null;

      if (!alive) return;

      if (!session) {
        // 未ログインなら guardian/login に誘導
        router.replace("/guardian/login");
        return;
      }

      setReady(true);
    })();

    // サインアウトされた場合も即座に追い出す
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/guardian/login");
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  // セッション確認中は何も出さない（チラつき防止）
  if (!ready) return null;

  return <>{children}</>;
}
