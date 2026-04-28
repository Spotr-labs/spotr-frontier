import type { ReactNode } from "react";
import { AdminGate } from "../components/admin/admin-gate";
import { AdminShellLayout } from "../components/admin/admin-shell-layout";
import { publicSpotrConfig } from "../lib/spotr-config/public";
import { serverSpotrConfig } from "../lib/spotr-config/server";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const adminWallets = serverSpotrConfig.adminWallets;
  return (
    <AdminGate adminWallets={adminWallets}>
      <AdminShellLayout config={publicSpotrConfig}>{children}</AdminShellLayout>
    </AdminGate>
  );
}
