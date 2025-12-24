import { Suspense } from "react";
import ChatPageClient from "./ChatPageClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading...</div>}>
      <ChatPageClient />
    </Suspense>
  );
}
