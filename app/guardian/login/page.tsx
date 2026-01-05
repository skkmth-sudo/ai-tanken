// FILE: app/guardian/login/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { supabase } from "@/lib/supabaseClient";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const cleanEmail = email.trim();

    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      setStatus("error");
      setErrorMessage("ログインできませんでした。メールとパスワードをご確認ください。");
      return;
    }

    router.push("/guardian");
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-title-ja">AIことば教室「あい先生」</div>
        <div className="login-sub">保護者ログイン</div>

        <p className="login-caption">
          お子さまのことばの成長を見守るための
          <br />
          保護者専用ページです。
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>メールアドレス</label>
          <input
            type="email"
            placeholder="example@mail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <label>パスワード</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          {status === "error" && <div className="login-error">{errorMessage}</div>}

          <button type="submit" disabled={status === "loading"} className="login-btn">
            {status === "loading" ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        <div className="login-note">※ ログイン情報に心当たりがない場合は、教室までお問い合わせください。</div>

        <div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
          <Link href="/privacy" style={{ textDecoration: "underline", marginRight: 12 }}>
            プライバシーポリシー
          </Link>
          <Link href="/terms" style={{ textDecoration: "underline" }}>
            利用規約
          </Link>
        </div>
      </div>
    </div>
  );
}
