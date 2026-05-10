import { SpotrSessionDetailShell } from "../../components/spotr-shell";
import { publicSpotrConfig } from "../../lib/spotr-config/public";
import { getSpotrDashboardPayload } from "../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const initialData = await getSpotrDashboardPayload(null, sessionId);
  return (
    <SpotrSessionDetailShell
      config={publicSpotrConfig}
      initialData={initialData}
      sessionId={sessionId}
    />
  );
}
