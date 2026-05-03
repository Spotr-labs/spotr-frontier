import Link from "next/link";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";
import {
  getSpotrDashboardPayload,
  sessionExists,
} from "../../../lib/server/spotr-store";
import { RecapClient } from "./recap-client";

export const dynamic = "force-dynamic";

export default async function RecapPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  if (!(await sessionExists(sessionId))) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
          Recap
        </p>
        <h1 className="text-xl font-bold text-foreground">Session not found.</h1>
        <p className="text-sm text-muted">
          This session no longer exists. It may have been reset or removed.
        </p>
        <Link
          href="/play"
          className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-[0.1em] text-black transition hover:bg-primary/90"
        >
          ← Back to sessions
        </Link>
      </main>
    );
  }

  const data = await getSpotrDashboardPayload(null, sessionId);
  return <RecapClient config={publicSpotrConfig} sessionId={sessionId} initialData={data} />;
}
