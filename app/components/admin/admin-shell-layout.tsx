"use client";

import { useState, type ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import type { SpotrPublicConfig } from "../../lib/spotr-types";
import { cn } from "../../lib/utils";

type AdminShellLayoutProps = {
  children: ReactNode;
  config: SpotrPublicConfig;
};

export function AdminShellLayout({ children }: AdminShellLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-[#070c19] text-foreground">
      <div className="flex min-h-[100dvh]">
        <div className="hidden lg:flex">
          <AdminSidebar />
        </div>

        <div
          className={cn(
            "fixed inset-0 z-40 transition-opacity lg:hidden",
            drawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className={cn(
              "absolute inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform",
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <AdminSidebar closeDrawer={() => setDrawerOpen(false)} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar onOpenDrawer={() => setDrawerOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8 lg:py-7">
            <div className="mx-auto w-full max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
