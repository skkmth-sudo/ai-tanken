// FILE: app/privacy/page.tsx
export const metadata = {
  title: "プライバシーポリシー | AIことば教室「あい先生」",
};

const UPDATED_AT = "2026-01-05";

export default function PrivacyPage() {
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>プライバシーポリシー</h1>
        <p style={styles.meta}>最終更新日：{UPDATED_AT}</p>

        <section style={styles.section}>
          <p style={styles.p}>
            子ども向けAI言葉教室「あい先生」（以下「本サービス」）は、本サービスの提供にあたり、利用者（保護者およびお子さま）の個人情報等を以下のとおり取り扱います。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>1. 取得する情報</h2>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <b>アカウント情報：</b>保護者のメールアドレス等（ログインに必要な情報）
            </li>
            <li style={styles.li}>
              <b>お子さまプロフィール：</b>氏名（または表示名）、ニックネーム、学年、各種メモ等（保護者が入力した情報）
            </li>
            <li style={styles.li}>
              <b>会話・学習ログ：</b>本サービス内で送受信されたメッセージ、学習の記録（例：成長メモ等）
            </li>
            <li style={styles.li}>
              <b>端末・利用状況情報：</b>アクセス日時、閲覧・操作の記録、エラー情報等（必要な範囲）
            </li>
          </ul>
          <p style={styles.note}>
            ※本サービスは、入力内容に個人情報（住所・電話番号など）を含めないよう推奨します。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>2. 利用目的</h2>
          <ul style={styles.ul}>
            <li style={styles.li}>本サービスの提供・本人確認・認証のため</li>
            <li style={styles.li}>会話ログの保存、成長メモ・レポート等の作成・表示のため</li>
            <li style={styles.li}>不正利用防止、セキュリティ確保のため</li>
            <li style={styles.li}>お問い合わせ対応のため</li>
            <li style={styles.li}>品質改善、障害対応、機能改善のため</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>3. 第三者提供</h2>
          <p style={styles.p}>
            法令に基づく場合、または人の生命・身体・財産の保護のために必要がある場合等を除き、本人の同意なく第三者に個人情報を提供しません。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>4. 委託・外部サービスの利用</h2>
          <p style={styles.p}>
            本サービスは、運用のために以下の外部サービスを利用する場合があります。これらのサービス提供者は、それぞれのプライバシーポリシーに従って情報を取り扱います。
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <b>Supabase</b>（認証・データベース等）
            </li>
            <li style={styles.li}>
              <b>Vercel</b>（ホスティング等）
            </li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>5. 安全管理</h2>
          <p style={styles.p}>
            個人情報の漏えい、滅失、毀損の防止その他の安全管理のため、アクセス制御等の必要かつ適切な措置を講じます。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>6. 保管期間</h2>
          <p style={styles.p}>
            会話ログやプロフィール情報は、本サービス提供に必要な期間保持します。退会や削除のご要望がある場合は、合理的な範囲で対応します。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>7. 未成年の情報</h2>
          <p style={styles.p}>
            本サービスは保護者による利用を前提とします。お子さまに関する情報は、保護者が入力・管理するものとし、保護者の責任において適切に取り扱ってください。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>8. 開示・訂正・削除等</h2>
          <p style={styles.p}>
            保有個人情報の開示、訂正、利用停止、削除等をご希望の場合は、下記窓口までご連絡ください。ご本人確認のうえ、合理的な範囲で対応します。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>9. お問い合わせ窓口</h2>
          <p style={styles.p}>
            メール：{" "}
            <a href="mailto:tao.tao.taopi26@gmail.com" style={styles.link}>
              tao.tao.taopi26@gmail.com
            </a>
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>10. 改定</h2>
          <p style={styles.p}>
            本ポリシーは必要に応じて改定することがあります。改定後は本ページにて掲示します。
          </p>
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8f1e4", color: "#5b4732", padding: "32px 16px" },
  container: { maxWidth: 860, margin: "0 auto", background: "rgba(255,255,255,0.7)", borderRadius: 16, padding: "28px 22px", border: "1px solid rgba(234,215,189,0.8)" },
  h1: { fontSize: 26, margin: 0, marginBottom: 6, letterSpacing: "0.02em" },
  meta: { margin: 0, marginBottom: 18, opacity: 0.8, fontSize: 13 },
  section: { marginTop: 18 },
  h2: { fontSize: 18, margin: "0 0 8px" },
  p: { margin: 0, lineHeight: 1.9, fontSize: 14 },
  ul: { margin: "8px 0 0", paddingLeft: "1.2em", lineHeight: 1.9, fontSize: 14 },
  li: { marginBottom: 6 },
  note: { marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.8 },
  link: { color: "#6b4a2b", textDecoration: "underline" },
};
