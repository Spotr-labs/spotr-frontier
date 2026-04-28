"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Coins,
  FileSearch,
  Gauge,
  Gift,
  LayoutGrid,
  ListTree,
  Receipt,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { SpotrLogo } from "../spotr-ui/system";
import { cn } from "../../lib/utils";

type AdminNavLink = {
  href: string;
  label: string;
  icon: typeof Activity;
  match?: (pathname: string) => boolean;
};

const NAV_LINKS: AdminNavLink[] = [
  { href: "/admin/overview", label: "Overview", icon: Gauge },
  {
    href: "/admin/sessions",
    label: "Sessions",
    icon: LayoutGrid,
    match: (p) => p === "/admin/sessions" || p.startsWith("/admin/sessions/"),
  },
  { href: "/admin/operations", label: "Operations", icon: ShieldCheck },
  { href: "/admin/pairs", label: "Pairs", icon: ListTree },
  {
    href: "/admin/players",
    label: "Players",
    icon: Users,
    match: (p) => p === "/admin/players" || p.startsWith("/admin/players/"),
  },
  { href: "/admin/transactions", label: "Transactions", icon: Receipt },
  {
    href: "/admin/referrals",
    label: "Referrals",
    icon: Coins,
    match: (p) => p === "/admin/referrals" || p.startsWith("/admin/referrals/"),
  },
  { href: "/admin/rewards", label: "Rewards", icon: Gift },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/audit", label: "Audit", icon: FileSearch },
];

type AdminSidebarProps = {
  closeDrawer?: () => void;
};

export function AdminSidebar({ closeDrawer }: AdminSidebarProps) {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-full flex-col gap-1 border-r border-white/10 bg-[#070c19] px-3 py-4 lg:w-64">
      <div className="flex items-center justify-between gap-3 px-2 pb-3">
        <Link
          href="/admin/overview"
          className="flex items-center gap-2"
          onClick={closeDrawer}
        >
          <span className="rounded-full bg-primary/15 p-2 text-primary">
            <SpotrLogo size={16} />
          </span>
          <div className="leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
              SPOTR
            </p>
            <p className="font-display text-sm font-extrabold tracking-tight text-foreground">
              Admin
            </p>
          </div>
        </Link>
        {closeDrawer ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            onClick={closeDrawer}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_LINKS.map((link) => {
          const Icon = link.icon;
          const active = link.match
            ? link.match(pathname)
            : pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={closeDrawer}
              className={cn(
                "flex items-center gap-3 rounded-[0.9rem] px-3 py-2 text-sm transition",
                active
                  ? "bg-primary/15 text-foreground"
                  : "text-muted hover:bg-white/5 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium">{link.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-2 pt-4">
        <Link
          href="/play"
          onClick={closeDrawer}
          className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-muted hover:text-primary"
        >
          <Settings2 className="h-3 w-3" />
          Player view
        </Link>
      </div>
    </aside>
  );
}
