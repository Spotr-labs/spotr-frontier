import { SpotrAdminShell } from "../components/spotr-shell";
import { publicSpotrConfig } from "../lib/spotr-config/public";
import { getSpotrDashboardPayload } from "../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const initialData = await getSpotrDashboardPayload();

  return <SpotrAdminShell config={publicSpotrConfig} initialData={initialData} />;
}
