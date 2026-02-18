// FILE: app/ChatPageClient.tsx

// ここに「ファイル全文」を貼り付けて編集します。
//（部分コピペ禁止：必ず全文を置き換え）


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

// ==============================
// WeekFlow（Weekごとの stage/slots）
// - Week52まで拡張できるように「週ごとの定義を差し替える」ための土台
// - 先生の返答生成は /api/chat 側で継続（ニックネーム呼び・変更検知を維持）
// ==============================

type Week1Stage = "ASK_LIKES" | "ASK_FAVORITE" | "ASK_REASON" | "GENERATE";

type Week1Slots = {
  likes: string[]; // 最大3
  favorite: string | null;
  favorite_reason: string | null;
};

type WeekFlowState =
  | {
      week: "week1";
      stage: Week1Stage;
      slots: Week1Slots;
    }
  | {
      // 未対応週は null 運用（フォールバックで従来の会話を壊さない）
      week: WeekId;
      stage: string;
      slots: any;
    };

function initWeekFlow(w: WeekId): WeekFlowState | null {
  if (w === "week1") {
    return {
      week: "week1",
      stage: "ASK_LIKES",
      slots: {
        likes: [],
        favorite: null,
        favorite_reason: null,
      },
    };
  }
  return null;
}

// ==============================
// Week1: ルール抽出（自然文 → slots）
// - 最小改造で「抽出・充足判定・生成前提」を技術として言える状態にする
// - 文章生成/ニックネーム運用は /api/chat に残す
// ==============================

function uniqPush(list: string[], v: string) {
  const t = (v || "").trim();
  if (!t) return list;
  if (list.includes(t)) return list;
  list.push(t);
  return list;
}

function cleanLikeToken(s: string) {
  let t = (s || "").trim();
  if (!t) return "";
  // よくある前置きを除去
  t = t.replace(/^(ぼく|僕|わたし|私|おれ|俺)は\s*/u, "");
  t = t.replace(/^(すきなのは|好きなのは)\s*/u, "");
  // 末尾の言い回しを除去
  t = t.replace(/(がすき|が好き|すき|好き)(です|だよ|だ)?$/u, "");
  t = t.replace(/[。!！?？]+$/u, "");
  t = t.trim();
  // 長すぎるのは切る
  if (t.length > 30) t = t.slice(0, 30);
  return t;
}

function extractLikesFromText(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];

  // 区切り候補で一旦分割
  const normalized = raw
    .replace(/[、，,]/g, "|")
    .replace(/[・]/g, "|")
    .replace(/[／/]/g, "|")
    .replace(/[＆&]/g, "|")
    // 「AとB」「AやB」も分解
    .replace(/\s*(と|や)\s*/g, "|")
    .replace(/[。]/g, "|");

  const parts = normalized
    .split("|")
    .map(cleanLikeToken)
    .map((s) => s.trim())
    .filter(Boolean);

  // 「好きなものはサッカーです」みたいに一塊の場合の救済
  if (parts.length === 0) {
    const m = raw.match(/(?:すき|好き)なもの(?:は|って)\s*([ぁ-んァ-ヶ一-龠A-Za-z0-9]{1,20})/u);
    if (m?.[1]) return [cleanLikeToken(m[1])].filter(Boolean);
  }

  // 重複除去しつつ最大3
  const out: string[] = [];
  for (const p of parts) {
    if (out.length >= 3) break;
    uniqPush(out, p);
  }
  return out;
}

function pickFavoriteFromText(text: string, likes: string[]): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  // likes のどれかが文中に含まれていればそれ
  for (const like of likes) {
    if (like && t.includes(like)) return like;
  }
  // 「1番/2番/3番」指定
  if (/1\s*番|１\s*番/u.test(t) && likes[0]) return likes[0];
  if (/2\s*番|２\s*番/u.test(t) && likes[1]) return likes[1];
  if (/3\s*番|３\s*番/u.test(t) && likes[2]) return likes[2];
  return null;
}

function extractReasonFromText(text: string): string | null {
  const raw = (text || "").trim();
  if (!raw) return null;

  // ✅ NG（理由として受け取らない）: 逃げ/不明/否定
  const ng = /(わからない|わかんない|しらない|知らない|むり|無理|できない|ない|とくにない|別に|べつに|まだ|うーん|えっと|…|・・・)/u;
  if (ng.test(raw)) return null;

  // ✅ 短すぎる理由は弾く（例：3文字以下は「理由」になりにくい）
  if (raw.replace(/\s+/g, "").length < 4) return null;

  // 理由は〜 / 〜から / 〜ので / 〜だから
  const m1 = raw.match(/(?:理由|りゆう)は\s*(.+)$/u);
  if (m1?.[1]) {
    const r = m1[1].trim();
    if (!r) return null;
    if (ng.test(r)) return null;
    if (r.replace(/\s+/g, "").length < 4) return null;
    return r.length > 80 ? r.slice(0, 80) : r;
  }

  // 「〜から/ので/だから」系（末尾に来るケース）
  const m2 = raw.match(/(.+?)(?:だから|なので|から)\s*$/u);
  if (m2?.[1]) {
    const r = m2[1].trim();
    if (!r) return null;
    if (ng.test(r)) return null;
    if (r.replace(/\s+/g, "").length < 4) return null;
    return r.length > 80 ? r.slice(0, 80) : r;
  }

  // 短文の場合は全文を理由として扱う（ただし上の条件を満たすこと）
  const r = raw.replace(/[。!！?？]+$/u, "").trim();
  if (!r) return null;
  if (ng.test(r)) return null;
  if (r.replace(/\s+/g, "").length < 4) return null;
  return r.length > 80 ? r.slice(0, 80) : r;
}

function applyWeek1FlowOnUserInput(current: WeekFlowState | null, userText: string): WeekFlowState | null {
  if (!current || current.week !== "week1") return current;

  const stage = current.stage;
  const slots = { ...current.slots };

  if (stage === "ASK_LIKES") {
    const extracted = extractLikesFromText(userText);
    // 既存likesとマージ（段階的に集める）
    const merged: string[] = [...(slots.likes || [])];
    for (const x of extracted) {
      if (merged.length >= 3) break;
      uniqPush(merged, x);
    }
    slots.likes = merged.slice(0, 3);

    // 3つ揃ったら次へ
    const nextStage: Week1Stage = slots.likes.length >= 3 ? "ASK_FAVORITE" : "ASK_LIKES";
    return { week: "week1", stage: nextStage, slots };
  }

  if (stage === "ASK_FAVORITE") {
    const fav = pickFavoriteFromText(userText, slots.likes || []);
    if (fav) {
      slots.favorite = fav;
      return { week: "week1", stage: "ASK_REASON", slots };
    }
    return { week: "week1", stage: "ASK_FAVORITE", slots };
  }

  if (stage === "ASK_REASON") {
    const r = extractReasonFromText(userText);
    if (r) {
      slots.favorite_reason = r;
      return { week: "week1", stage: "GENERATE", slots };
    }
    return { week: "week1", stage: "ASK_REASON", slots };
  }

  // GENERATE の後は維持
  return current;
}

function localOpeningForWeek(w: WeekId, flow: WeekFlowState | null): string {
  if (w === "week1" && flow && flow.week === "week1") {
    if (flow.stage === "ASK_LIKES") return "好きなものを3つ教えて！たとえば『好きな教科』『好きな遊び』『好きな色』みたいに、なんでもOKだよ。『〇〇と〇〇と〇〇が好き』って言ってみてね。";
    if (flow.stage === "ASK_FAVORITE") return "教えてくれた中で、一番好きなのはどれ？";
    if (flow.stage === "ASK_REASON") return "一番好きなもののどこが好き？理由は1つだけでOKだよ。";
    if (flow.stage === "GENERATE") return "ありがとう。じゃあ、自己紹介文を3文くらいで作るね。";
  }
  return weeks[w].openingMessage;
}

// ==============================
// WeekFlow 永続化（childId × week）
// - ページ更新や離脱/再入場でも「途中の段階」を保持
// ==============================

const LS_WEEKFLOW = "ai-tanken:weekflow";

function weekFlowKey(childId: string, week: WeekId) {
  return `${LS_WEEKFLOW}:${(childId || "_no_child").trim()}:${week}`;
}

function isSameWeekFlow(a: WeekFlowState | null, b: WeekFlowState | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.week !== b.week) return false;

  if (a.week === "week1" && b.week === "week1") {
    if (a.stage !== b.stage) return false;
    const la = Array.isArray(a.slots?.likes) ? a.slots.likes : [];
    const lb = Array.isArray(b.slots?.likes) ? b.slots.likes : [];
    if (la.length !== lb.length) return false;
    for (let i = 0; i < la.length; i++) {
      if (la[i] !== lb[i]) return false;
    }
    if ((a.slots.favorite ?? null) !== (b.slots.favorite ?? null)) return false;
    if ((a.slots.favorite_reason ?? null) !== (b.slots.favorite_reason ?? null)) return false;
    return true;
  }

  // それ以外（将来拡張）の場合は軽く比較
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function normalizeLocalWeekFlow(v: any, week: WeekId): WeekFlowState | null {
  // まずは Week1 だけ永続化対象（未対応週は null でフォールバック）
  if (week !== "week1") return null;

  const init = initWeekFlow(week);
  if (!init) return null;

  if (!v || typeof v !== "object") return init;

  const stageRaw = typeof v.stage === "string" ? v.stage.trim() : "";
  const stage: Week1Stage =
    stageRaw === "ASK_LIKES" ||
    stageRaw === "ASK_FAVORITE" ||
    stageRaw === "ASK_REASON" ||
    stageRaw === "GENERATE"
      ? stageRaw
      : "ASK_LIKES";

  const slotsRaw = v.slots && typeof v.slots === "object" ? v.slots : {};

  const likesRaw = Array.isArray(slotsRaw.likes) ? slotsRaw.likes : [];
  const likes = likesRaw
    .filter((x: any) => typeof x === "string")
    .map((x: string) => x.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((x: string) => (x.length > 30 ? x.slice(0, 30) : x));

  let favorite = typeof slotsRaw.favorite === "string" ? slotsRaw.favorite.trim() : "";
  favorite = favorite.length > 30 ? favorite.slice(0, 30) : favorite;
  const fav = favorite && likes.includes(favorite) ? favorite : null;

  let reason = typeof slotsRaw.favorite_reason === "string" ? slotsRaw.favorite_reason.trim() : "";
  reason = reason.length > 80 ? reason.slice(0, 80) : reason;
  const favorite_reason = reason ? reason : null;

  return {
    week: "week1",
    stage,
    slots: {
      likes,
      favorite: fav,
      favorite_reason,
    },
  };
}

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

// ★ URL/LS から受け取る childId を安全に整形（混入URLで迷子にならない）
function normalizeChildId(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  // ありがちな混入（"haru/guardian/login" など）を弾く
  if (t.includes("/") || t.includes(" ") || t.includes("?")) return "";
  return t;
}

export default function ChatPageClient() {

  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  const [week, setWeek] = useState<WeekId>("week1");
  // ★ Weekごとの進行(stage)とスロット(slots)を保持（Week52まで拡張する土台）
  // 未対応週は null（従来の挙動にフォールバック）
  const [weekFlow, setWeekFlow] = useState<WeekFlowState | null>(() => initWeekFlow("week1"));
  // ★ weekFlow の復元が完了するまで保存で上書きしないためのフラグ
  const [weekFlowHydrated, setWeekFlowHydrated] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [grade, setGrade] = useState<Grade>("小3");
  const [nickname, setNickname] = useState("");
  // ★ 自動取得は「最初のニックネーム質問に答えた時だけ」
  const [nicknameLocked, setNicknameLocked] = useState(false);

  // ★ DBのプロフィールを一度は確認してから（デフォ値で）上書き保存しないためのフラグ
  const [dbProfileChecked, setDbProfileChecked] = useState(false);

  const [showProfile, setShowProfile] = useState(false);

  // ★ 最新の nickname/lock を参照するための ref（非同期処理でのズレ防止）
  const nicknameRef = useRef("");
  const nicknameLockedRef = useRef(false);

  // ★ 最新の childId を参照するための ref（debounce 発火後の async が残っても別の子に書かない）
  const childIdRef = useRef("");


  // ★ childId は「URL→localStorage→空」の順で決める（入力欄は出さない）
  const [childId, setChildId] = useState<string>("");

  // ★ 迷子防止のリダイレクトを二重実行しない
  const didRedirectRef = useRef(false);

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
      setWeekFlow(initWeekFlow(initialWeek));

      // childId: URL ?childId=... が最優先（※searchParams は別Effectで反映）
            const fromLs = normalizeChildId(localStorage.getItem(LS_CHILD_ID) ?? "");
      setChildId(fromLs);
    } finally {
      setMounted(true);
    }
  }, []);

  // ★ childId が決まったら「その子のプロフィール」を読み込む（まず localStorage → 次に Supabase で上書き）
  useEffect(() => {
    if (!mounted) return;
    // child 切替時は、DBチェックをやり直す
    setDbProfileChecked(false);

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
        if (!token) {
          if (!cancelled) setDbProfileChecked(true);
          return;
        }

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

        // ✅ Guardian（DB）を基本の正とし、値が違えば上書き（空なら空で反映＝クリアもできる）
        const incoming = (dbNickname ?? "").trim();
        const current = (nicknameRef.current ?? "").trim();
        if (incoming !== current) {
          setNickname(dbNickname ?? "");
          // ✅ DBのニックネームは「初期値」として反映するだけ。
          // 会話中の「ニックネームを教えてね」への回答で更新できるよう、ここでは lock しない。
          setNicknameLocked((prev) => prev);
        }
      } catch (e) {
        console.warn("[profile] children fetch failed:", e);
      } finally {
        if (!cancelled) setDbProfileChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [childId, mounted]);
  // ★ URL から childId を受け取る（Guardian→トークの正規導線）
  useEffect(() => {
    if (!mounted) return;

    const fromUrl = normalizeChildId(searchParams?.get("childId") ?? "");
    if (!fromUrl) return;

    // 既に同じ childId なら何もしない
    if (fromUrl === childId) return;

    setChildId(fromUrl);
    localStorage.setItem(LS_CHILD_ID, fromUrl);
  }, [searchParams, mounted, childId]);

  // ★ chat画面：childId が無い/不正なら guardian へ戻す（迷子防止）
  useEffect(() => {
    if (!mounted) return;
    if (didRedirectRef.current) return;

    const raw = searchParams?.get("childId") ?? "";
    const normalized = normalizeChildId(raw);

    // URLに childId が“変な形で”混ざってるなら、まず guardian に誘導
    if (raw && !normalized) {
      didRedirectRef.current = true;
      alert("リンクが正しくないみたい。保護者ページから子どもを選んで入り直してね。");
      router.replace("/guardian");
      return;
    }

    // URLから正しい childId が来ているのに、まだ state に反映されていない間は待つ
    if (normalized && !childId) return;

    // childId が最終的に空なら guardian に誘導
    if (!childId) {
      didRedirectRef.current = true;
      router.replace("/guardian");
    }
  }, [mounted, childId, router, searchParams]);

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
    const opening = localOpeningForWeek(week, initWeekFlow(week));
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

  // ★ WeekFlow（stage/slots）を childId×week で復元（ページ更新でも続きから）
  useEffect(() => {
    if (!mounted) return;

    setWeekFlowHydrated(false);

    const key = weekFlowKey(childId, week);
    const raw = localStorage.getItem(key);

    let target: WeekFlowState | null = initWeekFlow(week);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        target = normalizeLocalWeekFlow(parsed, week);
      } catch {
        // ignore
      }
    }

    setWeekFlow((cur) => (isSameWeekFlow(cur, target) ? cur : target));
    setWeekFlowHydrated(true);
  }, [childId, week, mounted]);

  // ★ WeekFlow を保存（復元前に上書きしないため hydrated 後に保存）
  useEffect(() => {
    if (!mounted) return;
    if (!weekFlowHydrated) return;

    const key = weekFlowKey(childId, week);

    // 未対応週は null のまま（キーは掃除）
    if (!weekFlow) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(weekFlow));
    } catch {
      // ignore
    }
  }, [weekFlow, weekFlowHydrated, childId, week, mounted]);

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
  // ※ dbProfileChecked 前にデフォ値で上書きしない
  const saveProfileTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!mounted || !childId) return;
    if (!dbProfileChecked) return;

    // ログインしていないなら Supabase 保存はスキップ（ローカルのみ）
    // ※ getAccessToken は内部で session を見るので軽い
    if (saveProfileTimer.current) window.clearTimeout(saveProfileTimer.current);

    // ★ debounce 発火時点の childId を保持し、async 実行中に child が切り替わったら中断する
    const scheduledChildId = childId;

    saveProfileTimer.current = window.setTimeout(async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const patch: any = {};

        // 学年は children.grade に保存
        if (grade) patch.grade = grade;

        // ニックネームは children.nickname に保存（children.name は本名の表示用として残す）
        const nm = (nickname || "").trim();
        // ✅ 空なら null を入れてクリアできるようにする（ただし dbProfileChecked 後なので安全）
        patch.nickname = nm || null;
        // 何も変更がなければスキップ
        if (Object.keys(patch).length === 0) return;

                // ✅ 発火後に child が切り替わっていたら中断（理論上の伝染をゼロ化）
        if ((childIdRef.current || "").trim() !== (scheduledChildId || "").trim()) {
          console.warn("[profile] stale update canceled (child changed)", {
            scheduledChildId,
            currentChildId: childIdRef.current,
          });
          return;
        }

        const { error } = await supabase.from("children").update(patch).eq("id", scheduledChildId);
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
  }, [grade, nickname, mounted, childId, dbProfileChecked]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(LS_WEEK, week);
  }, [week, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (childId) localStorage.setItem(LS_CHILD_ID, childId);
  }, [childId, mounted]);

  // ★ childIdRef を常に最新へ（debounce 発火後に child が切り替わったら更新を中断するため）
  useEffect(() => {
    childIdRef.current = childId;
  }, [childId]);

  const profileForApi = useMemo(
    () => ({
      grade,
      nickname: nickname || undefined,
    }),
    [grade, nickname]
  ); // profileForApi

  // ★ 重さ対策：右ペインの表示は最新N件だけ（保存は全件のまま）
  const HISTORY_UI_LIMIT = 80;
  const uiMessages = useMemo(() => messages.slice(-HISTORY_UI_LIMIT), [messages]);

  async function send() {
    if (!input.trim() || isSending.current) return;
    isSending.current = true;

    // ★ 自動ニックネーム取得は「ニックネームを教えてね」の直後だけ
    const lastA = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
    // ✅ 既にプロフィールにニックネームが入っていても、
    // 「ニックネームを教えてね」への回答なら上書きできるようにする
    if (lastA && isNicknamePrompt(lastA.content)) {
      const extracted = extractNicknameFromNicknameAnswer(input);
      if (extracted) {
        setNickname(extracted);
        setNicknameLocked(true);
      }
    }

    // この送信でAIに渡すニックネームは、今回抽出できたらそれを最優先（setStateは非同期なので）
    const nicknameForThisSend = ((): string | undefined => {
      if (lastA && isNicknamePrompt(lastA.content)) {
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

    // ★ WeekFlow を「ユーザー入力」で更新（決定論：抽出・充足判定・stage遷移）
    // 先生の返答は /api/chat が生成（ニックネーム呼び・変更検知を維持）
    const nextWeekFlow = week === "week1" ? applyWeek1FlowOnUserInput(weekFlow, me.content) : weekFlow;
    if (nextWeekFlow !== weekFlow) setWeekFlow(nextWeekFlow);

  

    // ★ ここで最新の messages から next を作る（stale state 対策）
    const nextForUi = [...messagesRef.current, me];
    setMessages(nextForUi);
    setInput("");

    try {
      const token = await getAccessToken();
      if (!token) {
        // /api/chat はログイン必須（Bearer token）になったので、未ログインなら案内して戻す
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            ts: new Date().toISOString(),
            role: "assistant",
            content:
              "会話を続けるにはログインが必要だよ。保護者ページでログインしてから、もう一度ためしてね。",
          },
        ]);
        isSending.current = false;
        router.push("/guardian/login");
        return;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          childId,
          week,
          // ★ WeekFlow（stage/slots）を同梱（/api/chat 側が未対応でも無視されるので安全）
          weekFlow: nextWeekFlow ?? undefined,
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
    // ★ 週が変わったら WeekFlow も初期化（ステージの持ち越し防止）
    setWeekFlow(initWeekFlow(newWeek));
    const opening = localOpeningForWeek(newWeek, initWeekFlow(newWeek));
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
    // ★ リセット時は WeekFlow も初期化
    setWeekFlow(initWeekFlow(w));
    const opening = localOpeningForWeek(w, initWeekFlow(w));
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
          messages: messagesRef.current.map(({ role, content, ts }) => ({ role, content, ts })), 

         
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
              {uiMessages.map((m) => {
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

