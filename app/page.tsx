import { SpotrShell } from "./components/spotr-shell";
import { publicSpotrConfig } from "./lib/spotr-config/public";
import { getSpotrDashboardPayload } from "./lib/server/spotr-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialData = await getSpotrDashboardPayload();

  return <SpotrShell config={publicSpotrConfig} initialData={initialData} />;
}
