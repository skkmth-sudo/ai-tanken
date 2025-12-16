"use client";

import React, { useState, useEffect } from "react";
import "./guardian.css";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type ChatMessage = {
  role: "user" | "assistant";
  // DBには content で保存されていることもあるので、表示側は text を最終形として扱う
  text: string;
};

type ChatSession = {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
};

type Child = {
  id: string;
  name: string;
  grade: string;
  avatarLabel: string;
  favorites: string[];
  strength: string;
  thisWeek: {
    theme: string;
    conversationCount: number;
    highlight: string;
  };
  freeTrialDaysLeft: number;
  growthPoints: string[];
  nextReportLabel: string;
  recentSessions: ChatSession[];
};

type ParentData = {
  name: string;
  greetingTime: string;
  children: Child[];
};

// 🔸 フォールバック（ログインしてない or DB空のとき用）
const fallbackParent: ParentData = {
  name: "さとう",
  greetingTime: "こんにちは",
  children: [
    {
      id: "haru",
      name: "はるかちゃん",
      grade: "小学3年生",
      avatarLabel: "haru",
      favorites: ["ねこ", "りんご", "おえかき"],
      strength: "ことばで気持ちを伝えること",
      thisWeek: {
        theme: "好きなものの理由をことばにしてみよう",
        conversationCount: 3,
        highlight: "「だから〜」が上手に使えていました。",
      },
      freeTrialDaysLeft: 7,
      growthPoints: [
        "理由を2文以上で説明できる場面が増えてきました。",
        "「〜だから」「〜なので」を自然に使えていました。",
        "自分から「たとえばね」と、例を出すことができました。",
      ],
      nextReportLabel: "次回：2025年3月ごろ",
      recentSessions: [
        {
          id: "session-haru-1",
          startedAt: "2025-02-10 18:30",
          messages: [
            {
              role: "assistant",
              text: "はるかちゃん、こんにちは。今日もお話ししてくれてありがとう。",
            },
            {
              role: "user",
              text: "きょうね、ねことあそんだよ。",
            },
            {
              role: "assistant",
              text: "そうなんだ、ねことどんなふうにあそんだの？",
            },
            {
              role: "user",
              text: "ボールなげて、おいかけてた。かわいいから、ずっと見てた！",
            },
            {
              role: "assistant",
              text: "「かわいいから、ずっと見てた」って言えるの、とってもいいね。",
            },
          ],
        },
      ],
    },
    {
      id: "yuto",
      name: "ゆうとくん",
      grade: "小学1年生",
      avatarLabel: "yuto",
      favorites: ["レゴ", "電車", "カレー"],
      strength: "あたらしいことに挑戦すること",
      thisWeek: {
        theme: "はじめての自己紹介にチャレンジ",
        conversationCount: 2,
        highlight: "自分から『ぼくの好きなものはね』と話し始められました。",
      },
      freeTrialDaysLeft: 7,
      growthPoints: [
        "短い文章での自己紹介ができるようになってきました。",
        "相手の質問を聞いてから答える流れが身についてきました。",
      ],
      nextReportLabel: "次回：2025年4月ごろ",
      recentSessions: [
        {
          id: "session-yuto-1",
          startedAt: "2025-02-09 19:10",
          messages: [
            {
              role: "assistant",
              text: "はじめまして、ゆうとくん。きょうはいっしょに、じこしょうかいをれんしゅうしよう。",
            },
            {
              role: "user",
              text: "ぼくは、ゆうとです。",
            },
            {
              role: "assistant",
              text: "いいね！そのあとに、すきなものも言ってみる？",
            },
            {
              role: "user",
              text: "すきなものは、レゴとでんしゃ！",
            },
          ],
        },
      ],
    },
  ],
};

export default function GuardianPage() {
  const router = useRouter();

  // Supabase から読んだ保護者名（なければ null）
  const [parentNameFromDb, setParentNameFromDb] = useState<string | null>(null);
  // Supabase から読んだ子ども一覧（なければ [] → fallback を使う）
  const [childrenFromDb, setChildrenFromDb] = useState<Child[]>([]);
  // 選択中の子どものID
  const [selectedChildId, setSelectedChildId] = useState(
    fallbackParent.children[0]?.id ?? ""
  );
  // 会話ログモーダル
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);

  // 🔍 ログインチェック＋ parent / children / chat_sessions 読み込み
  useEffect(() => {
    const fetchParentAndChildren = async () => {
      // ① ログイン中ユーザー取得
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      console.log("Logged in user:", user);

      if (userError) {
        console.error("getUser error:", userError.message);
        return;
      }

      if (!user) {
        // 未ログインならログイン画面へ
        router.push("/guardian/login");
        return;
      }

      // ② parent 取得（user_id 紐づけ）
      const { data: parentRows, error: parentError } = await supabase
        .from("parent")
        .select("id, name")
        .eq("user_id", user.id)
        .limit(1);

      console.log("parentRows:", parentRows);

      if (parentError) {
        console.error("parent error:", parentError.message);
        return;
      }

      if (!parentRows || parentRows.length === 0) {
        console.log("No parent for this user. Use fallback.");
        return;
      }

      const parentRow = parentRows[0] as any;
      const parentId = parentRow.id as string | undefined;

      if (parentRow.name) {
        setParentNameFromDb(parentRow.name);
      }

      if (!parentId) return;

      // ③ children 取得
      const { data: childrenRows, error: childrenError } = await supabase
        .from("children")
        .select("*")
        .eq("parent_id", parentId);

      console.log("childrenRows:", childrenRows);

      if (childrenError) {
        console.error("children error:", childrenError.message);
        return;
      }

      if (!childrenRows || childrenRows.length === 0) {
        return;
      }
      const children = childrenRows as any[];

      // ④ 各 child.id ごとに chat_sessions を取得
      const sessionsMap: Record<string, ChatSession[]> = {};

      for (const c of children) {
        const { data: sessions, error: sessionsError } = await supabase
          .from("chat_sessions")
          .select("*")
          .eq("child_id", c.id)
          .order("created_at", { ascending: false })
          .limit(3);

        console.log("chat_sessions for child", c.id, sessions);

        if (sessionsError) {
          console.error(
            "chat_sessions error for child",
            c.id,
            sessionsError.message
          );
          continue;
        }

        sessionsMap[c.id] = (sessions ?? []).map((s: any) => ({
          id: s.id as string,
          startedAt: (s.created_at as string) ?? "",
          messages: Array.isArray(s.messages)
            ? (s.messages as any[]).map((m: any) => ({
                role: m?.role === "user" ? "user" : "assistant",
                // 互換: save-session は content で保存するので、text が無い場合は content を拾う
                text: String(m?.text ?? m?.content ?? m?.message ?? ""),
              }))
            : [],
        }));
      }

      // 🔽 ここを修正（growth_points ＋ recentSessions も含める）
      const mapped: Child[] = children.map((c) => ({
        id: c.id as string,
        name: ((c.nickname as string) ?? (c.name as string)) ?? "ななしさん",
        grade: (c.grade as string) ?? "",
        avatarLabel: (c.avatar_label as string) ?? "",
        favorites: Array.isArray(c.favorites)
          ? (c.favorites as string[])
          : [],
        strength: (c.strength as string) ?? "",
        thisWeek: {
          theme: "今週のテーマは準備中です",
          conversationCount: sessionsMap[c.id]?.length ?? 0,
          highlight:
            sessionsMap[c.id] && sessionsMap[c.id].length > 0
              ? "最近の会話ログからピックアップしています。"
              : "",
        },
        freeTrialDaysLeft: 7,
        growthPoints: Array.isArray(c.growth_points)
          ? (c.growth_points as string[])
          : [],
        nextReportLabel: "次回：準備中",
        recentSessions: sessionsMap[c.id] ?? [],
      }));

      setChildrenFromDb(mapped);

      // Supabase から子どもが取れたら、最初の1人を選択
      if (mapped.length > 0) {
        setSelectedChildId(mapped[0].id);
      }
    };

    fetchParentAndChildren();
  }, [router]);

  // ✅ 「Supabaseがあれば上書き・なければそのまま」
  const parent: ParentData = {
    ...fallbackParent,
    ...(parentNameFromDb ? { name: parentNameFromDb } : {}),
    ...(childrenFromDb.length > 0 ? { children: childrenFromDb } : {}),
  };

  const hasMultipleChildren = parent.children.length > 1;

  const selectedChild =
    parent.children.find((c) => c.id === selectedChildId) ??
    parent.children[0];

  const child = selectedChild;

  // ログアウト動作
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/guardian/login");
  };

  const handleOpenLog = () => {
    console.log("open log clicked, recentSessions:", child.recentSessions);
    const latest = child.recentSessions[0] ?? null;
    setActiveSession(latest);
    setIsLogOpen(true);
  };

  // ✅ あい先生トーク画面へ遷移（childId を URL で渡す）
  const handleGoToTalk = () => {
    if (!child?.id) return;
    router.push(`/?childId=${encodeURIComponent(child.id)}`);
  };

  const handleCloseLog = () => {
    setIsLogOpen(false);
  };

  return (
    <div className="page">
      {/* 上部ヘッダー */}
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-main">AI SENSEI</div>
            <div className="brand-sub">保護者マイページ</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </header>

      {/* 🔥 カフェ背景＋中央あいさつ */}
      <section className="hero" style={{ position: "relative", opacity: 1 }}>
        {/* ★ ヒーロー中央カラム（あいさつ → CTA を縦並び） */}
        <div
          style={{
            position: "relative",
            zIndex: 5,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 14,
          }}
        >
        {/* 🔥 あいさつ（メイン見出し） */}
        <div className="hero-greeting">
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
            {parent.name}さん、{fallbackParent.greetingTime}。
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.92 }}>
            今日も、{child.name}のことばの力を育てていきましょう。
          </div>
        </div>

        {/* ★ メインCTA：あい先生と話す（ファーストビューの主役） */}
        <button
          type="button"
          onClick={handleGoToTalk}
          style={{
            pointerEvents: "auto",
            position: "relative",
            zIndex: 10,
            width: "min(560px, 92vw)",
            padding: "18px 28px", // ← さっき良かったサイズに戻す
            fontSize: 20,
            fontWeight: 800,
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.78)", // hero-greeting と同系の半透明ホワイト
            backdropFilter: "blur(6px)",
            color: "#6b4a2b",
            border: "1px solid rgba(107, 74, 43, 0.22)",
            boxShadow: "0 14px 34px rgba(0,0,0,0.22)",
            opacity: 1,
          }}
        >
          あい先生と話す
        </button>

        
        </div>

        <div className="hero-scroll" style={{ pointerEvents: "none" }}>
          <span>scroll</span>
          <div className="hero-scroll-line" />
        </div>
      </section>

      {/* ダッシュボード本体（スクロール後のゾーン） */}
      <main className="content">
        <section>
          {/* あいさつ文は hero に移したので、ここは子ども切り替えだけ */}
          {hasMultipleChildren && (
            <div className="child-selector">
              <label htmlFor="child-select">お子さまを選ぶ</label>
              <select
                id="child-select"
                value={selectedChildId}
                onChange={(e) => setSelectedChildId(e.target.value)}
              >
                {parent.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.grade}）
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        <section className="grid">
          {/* 左カラム */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* プロフィールカード */}
            <article className="card">
              <div className="card-header">
                <div className="card-title">profile</div>
                <div className="card-tag">お子さま情報</div>
              </div>
              <div className="card-body">
                <div className="profile-row">
                  <div className="avatar">{child.avatarLabel}</div>
                  <div>
                    <div className="profile-name">{child.name}</div>
                    <div className="profile-grade">{child.grade}</div>
                  </div>
                </div>
                <div className="profile-meta">
                  好きなもの：
                  {child.favorites.join("・")}
                  <br />
                  得意なこと：{child.strength}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className="link-underline">
                    プロフィールを確認・編集する
                  </span>
                </div>
              </div>
            </article>

            {/* 今週のようすカード */}
            <article className="card">
              <div className="card-header">
                <div className="card-title">this week</div>
                <div className="card-tag">今週のようす</div>
              </div>
              <div className="card-body">
                <div className="pill-heading">今週のテーマ</div>
                <div
                  style={{
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                >
                  「{child.thisWeek.theme}」
                </div>
                <div className="week-items">
                  <div>
                    <span className="label">会話回数：</span>
                    {child.thisWeek.conversationCount}回
                  </div>
                  <div>
                    <span className="label">今週の一言：</span>
                    {child.thisWeek.highlight}
                  </div>
                  <div>
                    <span className="label">無料期間：</span>
                    あと{child.freeTrialDaysLeft}日
                  </div>
                </div>
              </div>
            </article>
          </div>

          {/* 右カラム */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* ことば成長メモ */}
            <article className="card">
              <div className="card-header">
                <div className="card-title">growth</div>
                <div className="card-tag">ことば成長メモ</div>
              </div>
              <div className="card-body">
                <div className="pill-heading">
                  この1週間でできるようになったこと
                </div>
                <ul className="growth-list">
                  {child.growthPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--soft-brown)",
                    marginTop: 8,
                  }}
                >
                  ※ あい先生との会話の中から、印象的だった場面をピックアップしています。
                </p>
              </div>
            </article>

            {/* レポート＆ログ */}
            <article className="card">
              <div className="card-header">
                <div className="card-title">records</div>
                <div className="card-tag">レポートと記録</div>
              </div>
              <div className="card-body">
                <div className="report-actions">
                  {/* ✅ Guardian → トーク画面 */}
                  <button
                    type="button"
                    className="report-link report-link-button"
                    onClick={handleGoToTalk}
                    style={{ marginBottom: 10 }}
                  >
                    <span>あい先生と話す</span>
                    <small>このお子さまでトークを開始</small>
                  </button>
                  <button
                    type="button"
                    className="report-link report-link-button"
                    onClick={handleOpenLog}
                  >
                    <span>会話ログをひらく</span>
                    <small>最近3回分を表示（仮）</small>
                  </button>
                  <div className="report-link">
                    <span>ことば成長レポートを見る</span>
                    <small>{child.nextReportLabel}</small>
                  </div>
                </div>
                <p className="report-note">
                  ※ レポートは2か月に1度、PDF形式でお渡しします。
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>

      {/* 🗨 会話ログモーダル */}
      {isLogOpen && (
        <div className="chat-modal-backdrop" onClick={handleCloseLog}>
          <div
            className="chat-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chat-modal-header">
              <div className="chat-modal-title">{child.name} の会話ログ</div>
              <button
                type="button"
                className="chat-modal-close"
                onClick={handleCloseLog}
              >
                ×
              </button>
            </div>
            <div className="chat-modal-sub">
              {activeSession
                ? `${activeSession.startedAt} ごろの会話`
                : "まだ会話ログが登録されていません。"}
            </div>
            <div className="chat-modal-body">
              {activeSession ? (
                activeSession.messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={
                      m.role === "user"
                        ? "chat-bubble chat-bubble-user"
                        : "chat-bubble chat-bubble-assistant"
                    }
                  >
                    <div className="chat-bubble-role">
                      {m.role === "user" ? child.name : "あい先生"}
                    </div>
                    <div className="chat-bubble-text">{m.text}</div>
                  </div>
                ))
              ) : (
                <p className="chat-modal-empty">
                  Supabase に会話ログが追加されると、ここに表示されます。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
