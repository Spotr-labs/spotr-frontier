import { SpotrSessionsListShell } from "../components/spotr-shell";
import { publicSpotrConfig } from "../lib/spotr-config/public";
import { getSpotrDashboardPayload } from "../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const initialData = await getSpotrDashboardPayload();
  return <SpotrSessionsListShell config={publicSpotrConfig} initialData={initialData} />;
}
