// FILE: app/terms/page.tsx
import Link from "next/link";

export const metadata = {
  title: "利用規約 | あい先生",
};

export default function TermsPage() {
  const contact = "tao.tao.taopi26@gmail.com";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
        子ども向けＡＩ言葉教室「あい先生」利用規約
      </h1>

      <p style={{ color: "#555", lineHeight: 1.8, marginBottom: 20 }}>
        本規約は、子ども向けＡＩ言葉教室「あい先生」（以下「本サービス」）の利用条件を定めるものです。
        保護者は、本規約に同意したうえで本サービスを利用するものとします。
      </p>

      <Section title="第1条（適用）">
        <p>本規約は、本サービスの提供条件および本サービス利用に関する運営者と利用者との間の権利義務関係を定めます。</p>
      </Section>

      <Section title="第2条（利用者）">
        <p>本サービスは、保護者が管理するアカウントのもとでお子さまが利用することを想定しています。保護者は、お子さまの利用について責任を負います。</p>
      </Section>

      <Section title="第3条（本サービスの内容）">
        <p>本サービスは、AIによる会話機能を用いて言葉の学びを支援します。機能・仕様は予告なく変更される場合があります。</p>
      </Section>

      <Section title="第4条（禁止事項）">
        <ul>
          <li>法令または公序良俗に反する行為</li>
          <li>なりすまし、不正アクセス、脆弱性の探索等</li>
          <li>本サービスの運営を妨害する行為（過度な負荷、スパム等）</li>
          <li>第三者の権利侵害（著作権、プライバシー等）</li>
          <li>個人情報を過度に入力する行為（住所・電話番号等の入力の強要や共有）</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </ul>
      </Section>

      <Section title="第5条（AI回答の性質・免責）">
        <ul>
          <li>AIの回答は、正確性・完全性・有用性を保証するものではありません。</li>
          <li>本サービスの利用により生じた損害について、運営者は故意または重大な過失がある場合を除き責任を負いません。</li>
          <li>学習効果や成果を保証するものではありません。</li>
        </ul>
      </Section>

      <Section title="第6条（データの取り扱い）">
        <p>会話内容・プロフィール等の取り扱いは、別途定めるプライバシーポリシーに従います。</p>
      </Section>

      <Section title="第7条（知的財産権）">
        <p>本サービスに関するプログラム、デザイン、文章等の権利は運営者または正当な権利者に帰属します。</p>
      </Section>

      <Section title="第8条（利用停止・アカウント制限）">
        <p>運営者は、利用者が本規約に違反した場合等に、事前通知なく利用停止等の措置を行うことがあります。</p>
      </Section>

      <Section title="第9条（規約の変更）">
        <p>運営者は、必要に応じて本規約を変更できます。重要な変更は本サービス上で告知します。</p>
      </Section>

      <Section title="第10条（準拠法・管轄）">
        <p>本規約は日本法に準拠し、本サービスに関して紛争が生じた場合、運営者所在地を管轄する裁判所を第一審の専属的合意管轄とします。</p>
      </Section>

      <p style={{ marginTop: 28, color: "#666" }}>
        （制定日：2025年12月24日）<br />
        （運営者名：＿＿＿＿＿＿）<br />
        （連絡先：<a href={`mailto:${contact}`} style={{ textDecoration: "underline" }}>{contact}</a>）
      </p>

      <div style={{ marginTop: 28 }}>
        <Link href="/privacy" style={{ textDecoration: "underline" }}>
          プライバシーポリシーはこちら
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{title}</h2>
      <div style={{ lineHeight: 1.9, color: "#333" }}>{children}</div>
    </section>
  );
}
