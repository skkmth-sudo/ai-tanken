// FILE: app/terms/page.tsx
export const metadata = {
  title: "利用規約 | AIことば教室「あい先生」",
};

const UPDATED_AT = "2026-01-05";

export default function TermsPage() {
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>利用規約</h1>
        <p style={styles.meta}>最終更新日：{UPDATED_AT}</p>

        <section style={styles.section}>
          <p style={styles.p}>
            本規約は、子ども向けAI言葉教室「あい先生」（以下「本サービス」）の利用条件を定めるものです。
            保護者は、本規約に同意のうえ本サービスを利用するものとします。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>1. 定義</h2>
          <ul style={styles.ul}>
            <li style={styles.li}>「利用者」：本サービスを利用する保護者をいいます。</li>
            <li style={styles.li}>「お子さま」：利用者が本サービスで管理する対象のお子さまをいいます。</li>
            <li style={styles.li}>「コンテンツ」：会話ログ、レポート、画面表示等、本サービス上の情報をいいます。</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>2. 本サービスの内容</h2>
          <p style={styles.p}>
            本サービスは、AIとの会話を通じて言葉の力を育てるための支援を目的とします。
            なお、AIの応答は自動生成であり、常に正確・適切であることを保証しません。
          </p>
          <p style={styles.note}>
            ※医療・法律等の専門的助言を提供するものではありません。必要に応じて専門家へご相談ください。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>3. アカウント</h2>
          <ul style={styles.ul}>
            <li style={styles.li}>利用者は自己の責任でログイン情報を管理するものとします。</li>
            <li style={styles.li}>不正利用が疑われる場合、利用者は速やかに運営へ連絡するものとします。</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>4. 禁止事項</h2>
          <ul style={styles.ul}>
            <li style={styles.li}>法令または公序良俗に反する行為</li>
            <li style={styles.li}>第三者の権利侵害（著作権、プライバシー等）</li>
            <li style={styles.li}>本サービスの運営を妨害する行為</li>
            <li style={styles.li}>不正アクセス、アカウントの共有・貸与（運営が許可した場合を除く）</li>
            <li style={styles.li}>お子さまの安全を害するおそれのある行為</li>
            <li style={styles.li}>入力欄に機微情報（住所・電話番号等）を過度に含める行為</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>5. 料金・支払</h2>
          <p style={styles.p}>
            有料プランを提供する場合、料金、支払方法、解約条件等は別途表示する内容に従うものとします。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>6. 知的財産権</h2>
          <p style={styles.p}>
            本サービスに関する著作権・商標権等の知的財産権は、運営または正当な権利者に帰属します。
            利用者は、私的利用の範囲を超えて無断で複製・転載等をしてはなりません。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>7. 免責・責任制限</h2>
          <p style={styles.p}>
            運営は、本サービスの完全性、正確性、特定目的への適合性等を保証しません。
            本サービスの利用により利用者に損害が生じた場合でも、運営の故意または重過失がある場合を除き、責任を負いません。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>8. 停止・中断</h2>
          <p style={styles.p}>
            システム保守、障害、外部サービスの停止等により、予告なく本サービスを停止または中断する場合があります。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>9. 退会・データ</h2>
          <p style={styles.p}>
            利用者が退会または利用停止となった場合、会話ログ等のデータが削除される場合があります。
            詳細はプライバシーポリシーに従います。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>10. 準拠法・管轄</h2>
          <p style={styles.p}>
            本規約は日本法に準拠し、本サービスに関連して紛争が生じた場合、運営所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.h2}>11. お問い合わせ</h2>
          <p style={styles.p}>
            メール：{" "}
            <a href="mailto:tao.tao.taopi26@gmail.com" style={styles.link}>
              tao.tao.taopi26@gmail.com
            </a>
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
