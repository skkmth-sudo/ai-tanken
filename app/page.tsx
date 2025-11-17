"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { weeks, type Grade, type WeekId } from "@/lib/persona";

type Msg = {
  id: string;
  ts: string;
  role: "user" | "assistant";
  content: string;
};

const LS_HISTORY = "ai-tanken:history";
const LS_PROFILE = "ai-tanken:profile";
const LS_WEEK = "ai-tanken:week";

const grades: Grade[] = ["小1", "小2", "小3", "小4", "小5", "小6"];

function newId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ensureMsgShape(m: any): Msg {
  return {
    id: m?.id ?? newId(),
    ts: m?.ts ?? new Date().toISOString(),
    role: m?.role === "user" ? "user" : "assistant",
    content: String(m?.content ?? ""),
  };
}

function hhmm(iso: string) {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export default function Page() {
  const [mounted, setMounted] = useState(false);

  const [week, setWeek] = useState<WeekId>("week1");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [grade, setGrade] = useState<Grade>("小3");
  const [nickname, setNickname] = useState("");

  const [showProfile, setShowProfile] = useState(false);

  const isSending = useRef(false);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // 初回マウント時だけ localStorage 読み込み
  useEffect(() => {
    try {
      const savedWeek = (localStorage.getItem(LS_WEEK) as WeekId) ?? "week1";
      const initialWeek = savedWeek in weeks ? savedWeek : "week1";
      setWeek(initialWeek);

      const raw = localStorage.getItem(LS_HISTORY);
      if (raw) {
        try {
          const arr = JSON.parse(raw) as any[];
          setMessages(arr.map(ensureMsgShape));
        } catch {
          const opening = weeks[initialWeek].openingMessage;
          setMessages([
            {
              id: newId(),
              ts: new Date().toISOString(),
              role: "assistant",
              content: opening,
            },
          ]);
        }
      } else {
        const opening = weeks[initialWeek].openingMessage;
        setMessages([
          {
            id: newId(),
            ts: new Date().toISOString(),
            role: "assistant",
            content: opening,
          },
        ]);
      }

      const p = JSON.parse(localStorage.getItem(LS_PROFILE) ?? "{}");
      if (p?.grade) setGrade(p.grade as Grade);
      if (p?.nickname) setNickname(p.nickname as string);
    } finally {
      setMounted(true);
    }
  }, []);

  // 永続化
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(LS_HISTORY, JSON.stringify(messages));
  }, [messages, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const profile = {
      grade,
      nickname: nickname || undefined,
    };
    localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
  }, [grade, nickname, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(LS_WEEK, week);
  }, [week, mounted]);

  const profileForApi = useMemo(
    () => ({
      grade,
      nickname: nickname || undefined,
    }),
    [grade, nickname]
  );

  async function send() {
    if (!input.trim() || isSending.current) return;
    isSending.current = true;

    const me: Msg = {
      id: newId(),
      ts: new Date().toISOString(),
      role: "user",
      content: input.trim(),
    };
    setMessages((prev) => [...prev, me]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, me]
            .slice(-16)
            .map(({ role, content }) => ({ role, content })),
          week,
          profile: profileForApi,
        }),
      });
      const data = await res.json();
      const reply: Msg = {
        id: newId(),
        ts: new Date().toISOString(),
        role: "assistant",
        content: data.reply ?? "（返答がなかったよ）",
      };
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          ts: new Date().toISOString(),
          role: "assistant",
          content: "エラーが起きたみたい。もう一度ためしてみてね。",
        },
      ]);
    } finally {
      isSending.current = false;
      queueMicrotask(() =>
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      );
    }
  }

  // week 切り替え：導入メッセージを新しく足す（履歴は残す）
  function handleWeekChange(newWeek: WeekId) {
    setWeek(newWeek);
    const opening = weeks[newWeek].openingMessage;
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        ts: new Date().toISOString(),
        role: "assistant",
        content: opening,
      },
    ]);
  }

  // 会話をすべて消して、現在の week の最初のメッセージだけに戻す
  function resetAll() {
    const w = week;
    const opening = weeks[w].openingMessage;
    const init: Msg[] = [
      {
        id: newId(),
        ts: new Date().toISOString(),
        role: "assistant",
        content: opening,
      },
    ];
    setMessages(init);
    if (mounted) localStorage.setItem(LS_HISTORY, JSON.stringify(init));
  }

  function handleResetClick() {
    if (
      !window.confirm(
        "これまでのおはなしを ぜんぶ けして、さいしょから はじめるよ。いいかな？"
      )
    ) {
      return;
    }
    resetAll();
  }

  const lastAssistant =
    [...messages].reverse().find((m) => m.role === "assistant") ??
    ({
      id: "intro",
      ts: new Date().toISOString(),
      role: "assistant",
      content: weeks[week].openingMessage,
    } as Msg);

  if (!mounted) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
        <div style={{ width: 160, height: 24, background: "#eee", borderRadius: 4 }} />
      </div>
    );
  }

  // ---------- スタイル ----------

  const pageStyle: CSSProperties = {
    minHeight: "100vh",
    background: "#f3f4f6",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  };
  const shellStyle: CSSProperties = {
    maxWidth: 960,
    margin: "0 auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  };
  const headerRow: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };
  const leftHeader: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const titleStyle: CSSProperties = { fontSize: 24, fontWeight: 700 };
  const weekBadge: CSSProperties = {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    background: "#dbeafe",
    border: "1px solid #bfdbfe",
     marginLeft: 12,          // ← これでタイトルの右に余白を作る
  whiteSpace: "nowrap",    // ← 折り返し防止（高さが増えないように）
  };
  const profileToggle: CSSProperties = {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    cursor: "pointer",
  };

  const profileGrid: CSSProperties = {
    display: showProfile ? "grid" : "none",
    gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    fontSize: 12,
  };
  const labelRow: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
  };
  const labelText: CSSProperties = { flexShrink: 0, width: 64 };
  const inputStyle: CSSProperties = {
    flex: 1,
    borderRadius: 4,
    border: "1px solid #d1d5db",
    padding: "4px 8px",
    fontSize: 12,
  };
  const selectStyle = inputStyle;

  const mainGrid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "7fr 3fr",
    gap: 0,
    alignItems: "stretch",
  };

  const leftPanel: CSSProperties = {
    padding: 24,
    position: "relative",
    minHeight: "65vh",
    backgroundImage: 'url("/classpicture.png")',
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    borderRadius: 16,
  };

  const bigBubbleWrapper: CSSProperties = {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "flex-start",
  };
  const bigBubble: CSSProperties = {
    width: "100%",
    maxWidth: 520,
    minHeight: 180,
    borderRadius: 32,
    border: "4px solid #4b5563",
    boxShadow: "6px 6px 0 rgba(0, 0, 0, 0.15)",
    padding: 20,
    fontSize: 15,
    lineHeight: 1.7,
    background: "#f9fafb",
  };

  // アイ先生（指定のサイズ・位置で固定）
  const teacherImageStyle: CSSProperties = {
    position: "absolute",
    left: 270,
    top: "65%",
    transform: "translateY(-50%)",
    width: 270,
    height: 800,
    objectFit: "contain",
    pointerEvents: "none",
  };

  const rightPanel: CSSProperties = {
    borderLeft: "2px solid #d1d5db",
    padding: 16,
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    minHeight: "60vh",
    fontSize: 12,
  };
  const historyHeader: CSSProperties = {
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 8,
  };
  const historyList: CSSProperties = {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };
  const historyBubbleBase: CSSProperties = {
    maxWidth: "85%",
    padding: "7px 10px",
    borderRadius: 18,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
  };
  const historyHeaderRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 10,
    color: "#6b7280",
    marginBottom: 2,
  };

  const footerRow: CSSProperties = {
    marginTop: 8,
    padding: "10px 14px",
    borderRadius: 16,
    background: "#ffffff",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const footerLabel: CSSProperties = {
    fontSize: 12,
    color: "#4b5563",
    whiteSpace: "nowrap",
  };
  const inputFooter: CSSProperties = {
    flex: 1,
    borderRadius: 999,
    border: "2px solid #3b82f6",
    padding: "8px 14px",
    fontSize: 13,
    background: "#ffffff",
  };
  const sendButton: CSSProperties = {
    borderRadius: 999,
    border: "none",
    padding: "8px 16px",
    fontSize: 13,
    background: "#3b82f6",
    color: "#ffffff",
    cursor: "pointer",
  };

  const weekOptions = Object.entries(weeks).map(([id, cfg]) => ({
    id: id as WeekId,
    label: `Week${id.replace("week", "")}: ${
      cfg.title.split("→")[0]?.trim() ?? cfg.title
    }`,
  }));

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        {/* ヘッダー */}
        <div style={headerRow}>
          <div style={leftHeader}>
            <div style={titleStyle}>あい先生</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>

            {/* ← 週バッジを右側へ移動 */}
            <span style={weekBadge}>週: {week}</span>
            <button
              type="button"
              style={profileToggle}
              onClick={() => setShowProfile((v) => !v)}
            >
              プロフィール {showProfile ? "▲" : "▼"}
            </button>
            <button
              type="button"
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid #f97373",
                background: "#fee2e2",
                color: "#b91c1c",
                cursor: "pointer",
              }}
              onClick={handleResetClick}
            >
              はじめから
            </button>
          </div>
        </div>

        {/* プロフィール（トグル表示） */}
        <div style={profileGrid}>
          <label style={labelRow}>
            <span style={labelText}>学年</span>
            <select
              style={selectStyle}
              value={grade}
              onChange={(e) => setGrade(e.target.value as Grade)}
            >
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

         <label style={{ ...labelRow, gridColumn: "3 / span 1" }}>
            <span style={{ ...labelText, width: 80 }}>ニックネーム</span>
            <input
              style={inputStyle}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="たろう など"
            />
          </label>

         <label style={{ ...labelRow, gridColumn: "6 / span 1" }}>

            <span style={labelText}>週</span>
            <select
              style={selectStyle}
              value={week}
              onChange={(e) => handleWeekChange(e.target.value as WeekId)}
            >
              {weekOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 左右 2 ペイン */}
        <div style={mainGrid}>
          {/* 左：背景画像つきエリア */}
          <section style={leftPanel}>
            <div style={bigBubbleWrapper}>
              <div style={bigBubble}>{lastAssistant.content}</div>
            </div>
            <Image
              src="/ai-sensei.png"
              alt="あい先生"
              width={360}
              height={540}
              style={teacherImageStyle}
            />
          </section>

          {/* 右：LINE風トーク履歴 */}
        <aside style={rightPanel}>
            <div style={historyHeader}>おはなしのきろく</div>
            <div style={historyList}>
              {messages.map((m) => {
                const isUser = m.role === "user";
                const bubbleStyle: CSSProperties = {
                  ...historyBubbleBase,
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  background: isUser ? "#DCF8C6" : "#E3F2FF",
                };
                return (
                  <div key={m.id} id={m.id} style={bubbleStyle}>
                    <div style={historyHeaderRow}>
                      <span>{isUser ? "あなた" : "あい先生"}</span>
                      <span>{hhmm(m.ts)}</span>
                    </div>
                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          </aside>
        </div>

        {/* 入力欄 */}
        <div style={footerRow}>
          <span style={footerLabel}>あなたのこたえ</span>
          <input
            style={inputFooter}
            placeholder="メッセージを入力してください"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button
            type="button"
            style={{
              ...sendButton,
              opacity: input.trim() ? 1 : 0.5,
              pointerEvents: input.trim() ? "auto" : "none",
            }}
            onClick={send}
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}
