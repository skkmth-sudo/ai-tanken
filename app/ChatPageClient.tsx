

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { weeks, type Grade, type WeekId } from "@/lib/persona";
import { getAccessToken, supabase } from "@/lib/supabaseClient";

type Msg = {
  id: string;
  ts: string;
  role: "user" | "assistant";
  content: string;
};

const LS_HISTORY = "ai-tanken:history";

function historyKey(childId: string) {
  // childIdごとに履歴を分離（これで「その子のチャット」になる）
  return `${LS_HISTORY}:${(childId || "_no_child").trim()}`;
}
const LS_PROFILE = "ai-tanken:profile";

// ★ childId ごとにプロフィールを分離するキー
function profileKey(childId: string) {
  return `${LS_PROFILE}:${(childId || "_no_child").trim()}`;
}
const LS_WEEK = "ai-tanken:week";
// ★ childId は「保存はする」が「手入力はさせない」
const LS_CHILD_ID = "ai-tanken:childId";

const grades: Grade[] = ["小1", "小2", "小3", "小4", "小5", "小6"];

function newId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pickText(v: any): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);

  // 配列は連結
  if (Array.isArray(v)) return v.map(pickText).join("");

  if (typeof v === "object") {
    // よくあるキー
    const direct = v.content ?? v.text ?? v.message ?? v.msg ?? v.value;
    if (direct !== undefined) return pickText(direct);

    // OpenAI/各種フォーマットっぽい形も吸収
    if (Array.isArray(v.parts)) return v.parts.map(pickText).join("");
    if (Array.isArray(v.contents)) return v.contents.map(pickText).join("");
    if (Array.isArray(v.messages)) return v.messages.map(pickText).join("");

    // 最後の手段：オブジェクトの文字列化（[object Object]は避ける）
    try {
      const s = JSON.stringify(v);
      return s && s !== "{}" ? s : "";
    } catch {
      return "";
    }
  }

  return String(v);
}

function ensureMsgShape(m: any): Msg {
  // 既存データ互換：content / text など、形が違っても「文章」を拾う
  const raw = pickText(m?.content ?? m?.text ?? m?.message ?? m?.msg ?? (typeof m === "string" ? m : m));

  return {
    id: m?.id ?? newId(),
    ts: m?.ts ?? m?.created_at ?? new Date().toISOString(),
    role: m?.role === "user" ? "user" : "assistant",
    content: String(raw ?? ""),
  };
}

function hhmm(iso: string) {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}
// ★ 「ニックネームを教えてね」への回答からだけ拾う（通常会話では拾わない）
function extractNicknameFromNicknameAnswer(text: string): string | null {
  let t = (text || "").trim();
  if (!t) return null;

  // 前置きの口癖を軽く除去
  t = t.replace(/^(いま|今|えっと|あの|うーん|その|ええと)[、,\s]+/g, "");

  // 例:「ぼくは たろう」「わたしは花子」「ぼくはたろうです」
  const m1 = t.match(/(?:ぼく|僕|わたし|私)は\s*([ぁ-んァ-ヶ一-龠A-Za-z]{1,12})(?:です|だよ|だ)?/u);
  if (m1?.[1]) return m1[1];

  // 例:「なまえは たろう」「名前は花子です」
  const m2 = t.match(/(?:名前|なまえ)は\s*([ぁ-んァ-ヶ一-龠A-Za-z]{1,12})(?:です|だよ|だ)?/u);
  if (m2?.[1]) return m2[1];

  // 例:「たろうです」「はなこだよ」
  const m3 = t.match(/^([ぁ-んァ-ヶ一-龠A-Za-z]{1,12})\s*(?:です|だよ|だ)$/u);
  if (m3?.[1]) return m3[1];

  // ★ 最後の手段：1語だけの回答（例:「たなか」）
  const m4 = t.match(/^([ぁ-んァ-ヶ一-龠A-Za-z]{2,8})$/u);
  if (m4?.[1]) {
    const NG = new Set(["はい", "うん", "えっと", "あの", "こんにちは", "ありがとう"]);
    if (!NG.has(m4[1])) return m4[1];
  }

  return null;
}

function isNicknamePrompt(text: string): boolean {
  const t = (text || "").trim();
  return /ニックネーム/.test(t) && /(教えて|おしえて|呼んでもいい|呼び方)/.test(t);
}


export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  const [week, setWeek] = useState<WeekId>("week1");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [grade, setGrade] = useState<Grade>("小3");
  const [nickname, setNickname] = useState("");
  // ★ 自動取得は「最初のニックネーム質問に答えた時だけ」
  const [nicknameLocked, setNicknameLocked] = useState(false);

  const [showProfile, setShowProfile] = useState(false);

  // ★ 最新の nickname/lock を参照するための ref（非同期処理でのズレ防止）
  const nicknameRef = useRef("");
  const nicknameLockedRef = useRef(false);


  // ★ childId は「URL→localStorage→空」の順で決める（入力欄は出さない）
  const [childId, setChildId] = useState<string>("");

  const isSending = useRef(false);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // ★ messages の最新値を参照するための ref（send/endConversation の取りこぼし防止）
  const messagesRef = useRef<Msg[]>([]);

  // 初回マウント時：week など（プロフィールは childId 決定後に読む）
  useEffect(() => {
    try {
      // week
      const savedWeek = (localStorage.getItem(LS_WEEK) as WeekId) ?? "week1";
      const initialWeek = savedWeek in weeks ? savedWeek : "week1";
      setWeek(initialWeek);

      // childId: URL ?childId=... が最優先（※searchParams は別Effectで反映）
      const fromLs = localStorage.getItem(LS_CHILD_ID) ?? "";
      setChildId((fromLs || "").trim());
    } finally {
      setMounted(true);
    }
  }, []);

  // ★ childId が決まったら「その子のプロフィール」を読み込む（まず localStorage → 次に Supabase で上書き）
  useEffect(() => {
    if (!mounted) return;
    const raw = localStorage.getItem(profileKey(childId)) ?? "{}";
    try {
      const p = JSON.parse(raw);
      if (p?.grade) setGrade(p.grade as Grade);
      if (p?.nickname) setNickname(p.nickname as string);
      if (typeof p?.nicknameLocked === "boolean") setNicknameLocked(p.nicknameLocked);
    } catch {
      // ignore
    }
  }, [childId, mounted]);

  // ★ Supabase（children）からプロフィールを補完：別端末でも同じニックネーム/学年になる
  useEffect(() => {
    if (!mounted || !childId) return;
    let cancelled = false;

    (async () => {
      try {
        // ログインしていない場合はスキップ（ローカルのみ）
        const token = await getAccessToken();
        if (!token) return;

        const { data, error } = await supabase
          .from("children")
          .select("nickname, grade")
          .eq("id", childId)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          console.warn("[profile] children fetch error:", error.message);
          return;
        }

        const dbGrade = (data as any)?.grade as Grade | null | undefined;
        const dbNickname = (data as any)?.nickname as string | null | undefined;

        if (dbGrade && grades.includes(dbGrade)) {
          setGrade(dbGrade);
        }

        // すでに入力済みのニックネームがある場合は上書きしない（意図せず変わるのを防ぐ）
        if (dbNickname && !nicknameRef.current?.trim()) {
          setNickname(dbNickname);
          setNicknameLocked(true);
        }
      } catch (e) {
        console.warn("[profile] children fetch failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [childId, mounted]);

  // ★ URL の childId が変わったら、その子に切り替える（Guardian→トークで必須）
  useEffect(() => {
    if (!mounted) return;
    const fromUrl = (searchParams?.get("childId") ?? "").trim();
    if (!fromUrl) return;
    setChildId(fromUrl);
    localStorage.setItem(LS_CHILD_ID, fromUrl);
  }, [searchParams, mounted]);

  // ★ childId が決まったら「その子の履歴」を読み込む
  useEffect(() => {
    if (!mounted) return;

    const key = historyKey(childId);
    const raw = localStorage.getItem(key);

    if (raw) {
      try {
        const arr = JSON.parse(raw) as any[];
        setMessages(arr.map(ensureMsgShape));
        return;
      } catch {
        // fallthrough
      }
    }

    // 履歴が無い/壊れている場合は、その週の導入メッセージから開始
    const opening = weeks[week].openingMessage;
    const init: Msg[] = [
      {
        id: newId(),
        ts: new Date().toISOString(),
        role: "assistant",
        content: opening,
      },
    ];
    setMessages(init);
    localStorage.setItem(key, JSON.stringify(init));
  }, [childId, mounted]);

  // ★ ローカル履歴が「初期状態」なら、Supabaseの最新セッションから復元（白紙っぽさ対策）
  useEffect(() => {
    if (!mounted || !childId) return;

    let cancelled = false;

    (async () => {
      try {
        // 1) まずローカルが十分あるなら何もしない
        const key = historyKey(childId);
        const raw = localStorage.getItem(key);
        if (raw) {
          const arr = JSON.parse(raw) as any[];
          if (Array.isArray(arr) && arr.length >= 2) return; // 2件以上なら「続きがある」
        }

        // 2) ログインしてなければ復元できないので終了
        const token = await getAccessToken();
        if (!token) return;

        // 3) Supabaseから最新の会話を取得
        const { data, error } = await supabase
          .from("chat_sessions")
          .select("messages")
          .eq("child_id", childId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          console.warn("[resume] chat_sessions fetch error:", error.message);
          return;
        }

        const msgsRaw = (data as any)?.messages as any[] | undefined;
        if (!Array.isArray(msgsRaw) || msgsRaw.length === 0) return;

        const restored = msgsRaw.map(ensureMsgShape);
        setMessages(restored);
        localStorage.setItem(key, JSON.stringify(restored));
      } catch (e) {
        console.warn("[resume] restore failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mounted, childId]);

  // 永続化（その子ごと）
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(historyKey(childId), JSON.stringify(messages));
  }, [messages, mounted, childId]);

  // messagesRef を常に最新へ
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  useEffect(() => {
    nicknameLockedRef.current = nicknameLocked;
  }, [nicknameLocked]);

  useEffect(() => {
    if (!mounted) return;
    const profile = {
      grade,
      nickname: nickname || undefined,
      nicknameLocked,
    };
    // ★ childId ごとに保存
    localStorage.setItem(profileKey(childId), JSON.stringify(profile));
  }, [grade, nickname, nicknameLocked, mounted, childId]);

  // ★ プロフィール変更を Supabase にも保存（入力のたびに叩かず、少し待ってまとめて保存）
  const saveProfileTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!mounted || !childId) return;

    // ログインしていないなら Supabase 保存はスキップ（ローカルのみ）
    // ※ getAccessToken は内部で session を見るので軽い
    if (saveProfileTimer.current) window.clearTimeout(saveProfileTimer.current);

    saveProfileTimer.current = window.setTimeout(async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const patch: any = {};

        // 学年は children.grade に保存
        if (grade) patch.grade = grade;

        // ニックネームは children.nickname に保存（children.name は本名の表示用として残す）
        const nm = (nickname || "").trim();
        if (nm) patch.nickname = nm;
        // 何も変更がなければスキップ
        if (Object.keys(patch).length === 0) return;

        const { error } = await supabase.from("children").update(patch).eq("id", childId);
        if (error) {
          console.warn("[profile] children update error:", error.message);
        }
      } catch (e) {
        console.warn("[profile] children update failed:", e);
      }
    }, 700);

    return () => {
      if (saveProfileTimer.current) window.clearTimeout(saveProfileTimer.current);
    };
  }, [grade, nickname, mounted, childId]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(LS_WEEK, week);
  }, [week, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (childId) localStorage.setItem(LS_CHILD_ID, childId);
  }, [childId, mounted]);

  const profileForApi = useMemo(
    () => ({
      grade,
      nickname: nickname || undefined,
    }),
    [grade, nickname]
  ); // profileForApi

  async function send() {
    if (!input.trim() || isSending.current) return;
    isSending.current = true;

    // ★ 自動ニックネーム取得は「ニックネームを教えてね」の直後だけ
    const lastA = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
    if (!nicknameLocked && !nickname && lastA && isNicknamePrompt(lastA.content)) {
      const extracted = extractNicknameFromNicknameAnswer(input);
      if (extracted) {
        setNickname(extracted);
        setNicknameLocked(true);
      }
    }

    // この送信でAIに渡すニックネームは、今回抽出できたらそれを最優先（setStateは非同期なので）
    const nicknameForThisSend = ((): string | undefined => {
      if (!nicknameLocked && !nickname && lastA && isNicknamePrompt(lastA.content)) {
        const extracted = extractNicknameFromNicknameAnswer(input);
        if (extracted) return extracted;
      }
      return nickname || undefined;
    })();

    const me: Msg = {
      id: newId(),
      ts: new Date().toISOString(),
      role: "user",
      content: input.trim(),
    };

  

    // ★ ここで最新の messages から next を作る（stale state 対策）
    const nextForUi = [...messagesRef.current, me];
    setMessages(nextForUi);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId,
          week,
          // /api/chat には "今の入力" を含めて送る
          messages: nextForUi.slice(-16).map(({ role, content }) => ({
            role,
            content,
          })),
          profile: {
            grade,
            nickname: nicknameForThisSend,
          },
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
    if (mounted) localStorage.setItem(historyKey(childId), JSON.stringify(init));
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

  // ★ 会話終了：save-session を叩く（childId がない場合は保存しない）
  async function endConversation() {
    if (!window.confirm("会話を終了して、きろくを保存するよ。いいかな？")) return;

    // childId が空なら、保存はスキップ（Guardian経由で開始してね）
    if (!childId) {
      alert(
       "このトークは子どもが未選択のため保存できません。\n\n" +

          "保護者マイページ（/guardian）で子どもを選んで『あい先生と話す』から開始してください。"
      );
      return;
    }

    // まずローカル履歴は確実に保存（リロードしても消えない）
    try {
      localStorage.setItem(
        historyKey(childId),
        JSON.stringify(messagesRef.current)
      );
    } catch {
      // ignore
    }

    try {
      const token = await getAccessToken();
      console.log("access_token length:", token.length);

      const res = await fetch("/api/save-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          childId,
          week,
          accessToken: token,
          messages: messagesRef.current.map(({ role, content }) => ({ role, content })),

         
        }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) {
        if (res.status === 401) {
          alert(
            "保存にはログインが必要です。\n\n" +
              "保護者ページでログインしてから、もう一度お試しください。"
          );
          return;
        }
        // ここでは throw せず、ユーザー向けに安全に表示
        alert(
          "保存に失敗しました。\n\n" +
            (data?.error ?? `save-session failed (status=${res.status})`)
        );
        return;
      }

      alert("保存しました！保護者マイページに戻ります。");
      router.push("/guardian");
    } catch (e) {
      alert(
        "保存に失敗しました。\n\n" +
          "詳細: " + (e instanceof Error ? e.message : String(e))
      );
      console.error("save-session failed", e);
    }
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
    marginLeft: 12,
    whiteSpace: "nowrap",
  };
  const profileToggle: CSSProperties = {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    cursor: "pointer",
  };

  // ★ 会話終了ボタン：目立つ色＆位置（ヘッダー右端）
  const endButton: CSSProperties = {
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid #fb923c",
    background: "#fff7ed",
    color: "#9a3412",
    cursor: "pointer",
    fontWeight: 700,
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
    height: "65vh",
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
    fontSize: 20,
    lineHeight: 1.7,
    background: "#f9fafb",
    color: "#111827",
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
    height: "65vh",
    overflow: "hidden",
    fontSize: 14,
  };
  const historyHeader: CSSProperties = {
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  };

  // ★ 右ペインにも小さめの会話終了（見つけやすさUP）
  const endMiniBtn: CSSProperties = {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #fb923c",
    background: "#fff7ed",
    color: "#9a3412",
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
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

  // ★ フッターにも会話終了（最終的に必ず見つかる）
  const endFooterButton: CSSProperties = {
    borderRadius: 999,
    border: "1px solid #fb923c",
    padding: "8px 14px",
    fontSize: 13,
    background: "#fff7ed",
    color: "#9a3412",
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
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

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

            {/* ★ 目立つ会話終了（ヘッダー右端） */}
            <button type="button" style={endButton} onClick={endConversation}>
              会話終了
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
              onChange={(e) => {
                const v = e.target.value;
                setNickname(v);
                // 手入力が最優先：入力がある間はロック、空に戻したら再自動取得OK
                setNicknameLocked(Boolean(v.trim()));
              }}
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

          {/* ★ childId の入力欄は削除（本番は自動で渡す） */}
          {/* （確認用に childId を表示したい場合は、下のコメントを外して “表示だけ” にできます）
          <div style={{ gridColumn: "1 / -1", color: "#6b7280", fontSize: 11 }}>
            childId: {childId ? childId : "（未設定）"}
          </div>
          */}
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
            <div style={historyHeader}>
              <span>おはなしのきろく</span>
              <button type="button" style={endMiniBtn} onClick={endConversation}>
                会話終了
              </button>
            </div>

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
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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

          <button type="button" style={endFooterButton} onClick={endConversation}>
            会話終了
          </button>
        </div>
      </div>
    </div>
  );
}

