// FILE: app/privacy/page.tsx
import Link from "next/link";

export const metadata = {
  title: "プライバシーポリシー | あい先生",
};

export default function PrivacyPage() {
  const contact = "tao.tao.taopi26@gmail.com";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
        子ども向けＡＩ言葉教室「あい先生」プライバシーポリシー
      </h1>

      <p style={{ color: "#555", lineHeight: 1.8, marginBottom: 20 }}>
        子ども向けＡＩ言葉教室「あい先生」（以下「本サービス」）は、利用者の個人情報等を以下の方針に基づき取り扱います。
      </p>

      <Section title="1. 取得する情報">
        <ul>
          <li>保護者のアカウント情報（認証に必要な情報）</li>
          <li>お子さまのプロフィール情報（ニックネーム、学年など、入力された範囲）</li>
          <li>会話内容（ユーザー発言・AI応答）および会話日時</li>
          <li>利用状況に関する情報（エラー情報、アクセス情報など、運用上必要な範囲）</li>
        </ul>
      </Section>

      <Section title="2. 利用目的">
        <ul>
          <li>本サービスの提供・運営（会話、履歴の保存・復元等）</li>
          <li>本人確認・不正利用防止・セキュリティ確保</li>
          <li>品質改善、機能改善、障害対応</li>
          <li>お問い合わせ対応</li>
        </ul>
      </Section>

      <Section title="3. 外部サービスへの送信（AIによる回答生成）">
        <p>
          本サービスは、AIによる回答生成のため、会話内容等を外部のAI提供事業者へ送信する場合があります。
          送信の範囲は回答生成に必要な情報に限ります。
        </p>
      </Section>

      <Section title="4. 保存先（委託・クラウド利用）">
        <p>
          本サービスは、会話履歴やプロフィール等のデータをクラウドサービス（例：データベース/認証基盤）に保存します。
          適切な安全管理措置のもとで取り扱います。
        </p>
      </Section>

      <Section title="5. 第三者提供">
        <p>
          法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。
          ただし、前条および第3条に記載の外部サービス利用（回答生成・保存等）に伴い、必要な範囲で情報が取り扱われることがあります。
        </p>
      </Section>

      <Section title="6. 安全管理措置">
        <p>
          不正アクセス、漏えい、改ざん、滅失等を防止するため、アクセス制御等の安全管理措置を講じます。
        </p>
      </Section>

      <Section title="7. 保有期間">
        <p>
          会話履歴・プロフィール等は、サービス提供に必要な期間保持します。退会または削除の申し出があった場合、
          合理的な範囲で削除に対応します（法令等により保存が必要な場合を除く）。
        </p>
      </Section>

      <Section title="8. 開示・訂正・削除等">
        <p>
          本人（保護者）から、保有する情報の開示・訂正・削除等の要請があった場合、本人確認のうえ、合理的な範囲で対応します。
        </p>
      </Section>

      <Section title="9. お問い合わせ窓口">
        <p>
          本ポリシーに関するお問い合わせは以下までご連絡ください。
          <br />
          <strong>連絡先：</strong>
          <a href={`mailto:${contact}`} style={{ textDecoration: "underline" }}>
            {contact}
          </a>
        </p>
      </Section>

      <Section title="10. 改定">
        <p>
          本ポリシーは必要に応じて改定します。重要な変更がある場合は、本サービス上で告知します。
        </p>
      </Section>

      <p style={{ marginTop: 28, color: "#666" }}>
        （制定日：2025年12月24日）<br />
        （運営者名：＿＿＿＿＿＿）
      </p>

      <div style={{ marginTop: 28 }}>
        <Link href="/terms" style={{ textDecoration: "underline" }}>
          利用規約はこちら
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
