import { publicSpotrConfig } from "../../../lib/spotr-config/public";
import { getSpotrDashboardPayload } from "../../../lib/server/spotr-store";
import { RecapClient } from "./recap-client";

export const dynamic = "force-dynamic";

export default async function RecapPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const data = await getSpotrDashboardPayload(null, sessionId);
  return <RecapClient config={publicSpotrConfig} sessionId={sessionId} initialData={data} />;
}
