import { SpotrProfileShell } from "../components/spotr-shell";
import { publicSpotrConfig } from "../lib/spotr-config/public";
import { getSpotrDashboardPayload } from "../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const initialData = await getSpotrDashboardPayload();

  return <SpotrProfileShell config={publicSpotrConfig} initialData={initialData} />;
}
