"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronRight, Copy, ExternalLink, Eye, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils";
import { WalletButton } from "../wallet-button";

export function SpotrLogo({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        {[18, 36, 54, 72, 108, 126, 144, 162, 198, 216, 234, 252, 288, 306, 324, 342].map(
          (angle) => {
            // Round to fixed precision: Node and V8 implement Math.cos/sin
            // differently in their last bits, which drifts SSR vs client.
            const rad = (angle * Math.PI) / 180;
            const x1 = (24 + Math.cos(rad) * 15).toFixed(4);
            const y1 = (24 + Math.sin(rad) * 15).toFixed(4);
            const x2 = (24 + Math.cos(rad) * 20).toFixed(4);
            const y2 = (24 + Math.sin(rad) * 20).toFixed(4);
            return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2" />;
          }
        )}
        <ellipse cx="24" cy="24" rx="13" ry="8.5" strokeWidth="2.8" />
      </g>
      <circle cx="24" cy="24" r="5" fill="currentColor" />
    </svg>
  );
}

const APP_NAV_LINKS = [
  { href: "/", label: "Play" },
  { href: "/profile", label: "Profile" },
  { href: "/admin", label: "Admin" },
  { href: "/airdrop", label: "Faucet" },
];

export function AppHeader({
  title,
  eyebrow,
}: {
  title: string;
  eyebrow: string;
}) {
  const pathname = usePathname();

  return (
    <header className="rounded-[1.5rem] border border-white/12 bg-black/22 px-3 py-3 shadow-[var(--shadow-soft)] sm:px-5 sm:py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
            <SpotrLogo size={18} />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
              {eyebrow}
            </p>
            <h1 className="font-display text-[1.35rem] font-extrabold tracking-[-0.04em] text-foreground sm:text-[1.8rem] lg:text-[2.4rem]">
              {title}
            </h1>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex w-full flex-wrap gap-2 lg:w-auto">
            {APP_NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Button
                  key={link.href}
                  asChild
                  variant={active ? "default" : "secondary"}
                  size="sm"
                >
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              );
            })}
          </div>
          <div className="w-full lg:w-auto [&>div]:w-full lg:[&>div]:w-auto [&>div>button]:w-full lg:[&>div>button]:w-auto">
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}

export function AppPage({
  header,
  children,
}: {
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="stage-canvas relative min-h-[100dvh] overflow-hidden">
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1366px]">
        <div className="hidden flex-1 bg-[#09172c] md:block" aria-hidden="true" />
        <main className="stage-shell stage-shell-onboard relative flex min-h-[100dvh] w-full flex-1 flex-col gap-6 px-3 py-4 sm:px-6 sm:py-6 md:max-w-[1100px]">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(245,200,0,0.08),transparent_28%)]"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-6">
            {header}
            {children}
          </div>
        </main>
        <div className="hidden flex-1 bg-[#09172c] md:block" aria-hidden="true" />
      </div>
    </div>
  );
}

export function NoticeBanner({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.2rem] border px-4 py-3 text-sm font-medium",
        tone === "success" && "border-primary/28 bg-primary/10 text-foreground",
        tone === "info" && "border-white/10 bg-white/6 text-foreground",
        tone === "error" && "border-destructive/28 bg-destructive/10 text-destructive"
      )}
    >
      {children}
    </div>
  );
}

export function SurfaceCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[1.25rem] border border-white/12 bg-black/22 p-5 shadow-[var(--shadow-soft)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
          {eyebrow}
        </p>
        <div className="space-y-1">
          <h2 className="font-display text-[1.2rem] font-extrabold tracking-[-0.03em] text-foreground sm:text-[1.5rem] lg:text-[1.85rem]">
            {title}
          </h2>
          {description ? <p className="max-w-2xl text-sm leading-relaxed text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  accent = false,
  helper,
}: {
  label: string;
  value: string;
  accent?: boolean;
  helper?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.2rem] border p-3 sm:p-4",
        accent
          ? "border-primary/30 bg-primary/10"
          : "border-white/12 bg-black/16"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
        {label}
      </p>
      <p className="mt-3 font-display text-[1.35rem] font-extrabold tracking-[-0.04em] text-foreground sm:text-[1.6rem]">
        {value}
      </p>
      {helper ? <p className="mt-1 text-xs text-muted">{helper}</p> : null}
    </div>
  );
}

export function KeyValueRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 sm:gap-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
        {label}
      </p>
      <div className={cn("min-w-0 break-all text-right text-sm text-foreground sm:break-normal", mono && "font-mono tabular-nums")}>
        {value}
      </div>
    </div>
  );
}

export function EmptyStateCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-white/6 p-3 text-primary">
        <Eye className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted">{body}</p>
      </div>
      {action}
    </SurfaceCard>
  );
}

export function ErrorStateCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard className="border-destructive/28 bg-destructive/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-base font-semibold text-destructive">{title}</p>
          <p className="text-sm leading-relaxed text-muted">{body}</p>
        </div>
        {action}
      </div>
    </SurfaceCard>
  );
}

export function AddressRow({
  value,
  explorerHref,
}: {
  value: string;
  explorerHref?: string;
}) {
  async function handleCopy() {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 sm:flex-nowrap sm:gap-3">
      <span className="min-w-0 flex-1 break-all font-mono text-xs tabular-nums text-foreground sm:break-normal sm:text-sm">{value}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={handleCopy} aria-label="Copy address">
          <Copy className="h-4 w-4" />
        </Button>
        {explorerHref ? (
          <Button asChild variant="ghost" size="icon">
            <a href={explorerHref} target="_blank" rel="noreferrer" aria-label="Open explorer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function StageScaffold({
  surface = "navy",
  children,
}: {
  surface?: "navy" | "blue" | "player" | "onboard";
  children: ReactNode;
}) {
  return (
    <div className="stage-canvas min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1366px]">
        <div className="hidden flex-1 bg-[#09172c] md:block" />
        <main
          className={cn(
            "stage-shell mx-auto flex min-h-screen w-full max-w-[446px] flex-col overflow-hidden",
            surface === "blue" && "stage-shell-blue",
            surface === "navy" && "stage-shell-navy",
            surface === "player" && "stage-shell-player",
            surface === "onboard" && "stage-shell-onboard"
          )}
        >
          {children}
        </main>
        <div className="hidden flex-1 bg-[#09172c] md:block" />
      </div>
    </div>
  );
}

export function StageBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flex flex-1 flex-col px-6 pb-6 pt-8", className)}>{children}</div>;
}

export function StageTopRail({
  roundLabel,
  balanceLabel,
  progress,
}: {
  roundLabel: string;
  balanceLabel?: string;
  progress?: number;
}) {
  return (
    <div className="border-b border-white/8 bg-black/16 px-5 py-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-primary">
          <SpotrLogo size={24} />
        </div>
        <p className="text-sm font-semibold text-foreground">{roundLabel}</p>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
          <span className="font-mono text-sm tabular-nums text-foreground">
            {balanceLabel ?? "--"}
          </span>
        </div>
      </div>
      {progress != null ? <Progress className="mt-4 h-1 bg-white/7" value={progress} /> : null}
    </div>
  );
}

export function ScreenIntro({
  logo = true,
  title,
  body,
  align = "left",
}: {
  logo?: boolean;
  title: string;
  body: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("space-y-4", align === "center" && "text-center")}>
      {logo ? (
        <div className={cn("text-primary", align === "center" && "flex justify-center")}>
          <SpotrLogo size={32} />
        </div>
      ) : null}
      <div className="space-y-3">
        <h2 className="screen-title text-white">{title}</h2>
        <p className={cn("screen-copy max-w-sm", align === "center" && "mx-auto")}>{body}</p>
      </div>
    </div>
  );
}

export function StepList({
  items,
}: {
  items: { icon: ReactNode; title: string; body: string }[];
}) {
  return (
    <div className="mt-8 rounded-[1.35rem] bg-black/8 px-5 py-4">
      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.title} className="space-y-4">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[0.9rem] border border-primary/25 bg-white/8 text-primary">
                {item.icon}
              </div>
              <div className="space-y-1">
                <p className="text-[1.05rem] font-semibold text-white">{item.title}</p>
                <p className="screen-copy max-w-xs text-white/66">{item.body}</p>
              </div>
            </div>
            {index < items.length - 1 ? <Separator className="bg-white/10" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressRing({
  value,
  total,
  complete = false,
}: {
  value: number;
  total: number;
  complete?: boolean;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const dashoffset = circumference * (1 - pct);

  return (
    <div className="relative h-36 w-36">
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke={complete ? "#25d16b" : "#f5c800"}
          strokeLinecap="round"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {complete ? (
          <Check className="h-12 w-12 text-success" />
        ) : (
          <>
            <p className="font-display text-5xl font-extrabold tracking-[-0.05em] text-white">
              {value}
            </p>
            <p className="font-mono text-sm tabular-nums text-muted">/ {total}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function ParticipantList({
  items,
}: {
  items: { label: string; sublabel: string; tone?: "green" | "blue" | "olive" | "cyan" }[];
}) {
  const tones = {
    green: "bg-[#4aa94c]",
    blue: "bg-[#4a98db]",
    olive: "bg-[#8e9641]",
    cyan: "bg-[#48c1bf]",
  } as const;

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="flex items-center gap-3 rounded-[1rem] border border-white/10 bg-white/4 px-4 py-3"
        >
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white",
              tones[item.tone ?? "green"]
            )}
          >
            {index + 1}
          </div>
          <p className="flex-1 font-mono text-sm font-semibold tabular-nums text-white">
            {item.label}
          </p>
          <p className="text-xs font-semibold text-success">{item.sublabel}</p>
        </div>
      ))}
    </div>
  );
}

export function MomentumBar({
  leftPct,
  rightPct,
  leftAccent = "blue",
  caption,
  height = "h-8",
}: {
  leftPct: number;
  rightPct: number;
  leftAccent?: "blue" | "gold";
  caption?: string;
  height?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-[0.7rem] border border-black/10 bg-[#efefef]">
        <div className={cn("flex text-sm font-bold text-white", height)}>
          <div
            className={cn(
              "flex items-center px-3",
              leftAccent === "blue" ? "bg-[var(--category-blue)]" : "bg-primary text-primary-foreground"
            )}
            style={{ width: `${leftPct}%` }}
          >
            {leftPct}%
          </div>
          <div
            className={cn(
              "flex items-center justify-end px-3",
              leftAccent === "blue" ? "bg-primary text-primary-foreground" : "bg-[var(--category-blue)]"
            )}
            style={{ width: `${rightPct}%` }}
          >
            {rightPct}%
          </div>
        </div>
      </div>
      {caption ? (
        <p className="text-center text-[13px] text-[#6b6b6b]">{caption}</p>
      ) : null}
    </div>
  );
}

export function StatementCard({
  category,
  side,
  copy,
  leftPct,
  rightPct,
  leftAccent = "blue",
}: {
  category: string;
  side: string;
  copy: string;
  leftPct: number;
  rightPct: number;
  leftAccent?: "blue" | "gold";
}) {
  return (
    <div className="rounded-[1.7rem] border border-black/15 bg-white px-5 pb-5 pt-4 text-[#171717] shadow-[0_18px_46px_rgba(0,0,0,0.42)]">
      <div className="flex items-center gap-2">
        <Badge className="bg-[var(--category-blue)] text-white" variant="default">
          {category}
        </Badge>
        <Badge className="bg-black/6 text-black/60" variant="default">
          {side}
        </Badge>
      </div>

      <div className="flex min-h-[26rem] items-center justify-center px-6 py-10">
        <p className="max-w-[15rem] text-center font-display text-[2.15rem] font-extrabold leading-[1.05] tracking-[-0.04em] text-balance">
          {copy}
        </p>
      </div>

      <Separator className="mb-4 bg-black/8" />

      <MomentumBar leftPct={leftPct} rightPct={rightPct} leftAccent={leftAccent} />
    </div>
  );
}

export function BottomAction({
  primary,
  note,
}: {
  primary: ReactNode;
  note?: string;
}) {
  return (
    <div className="mt-auto space-y-3 pt-6">
      {primary}
      {note ? <p className="text-center text-xs leading-relaxed text-muted">{note}</p> : null}
    </div>
  );
}

export function ActionLoading({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 rounded-full border border-primary/25 bg-primary/10 p-5 text-primary">
        <LoaderCircle className="h-9 w-9 animate-spin" />
      </div>
      <div className="space-y-2">
        <p className="text-[1.8rem] font-semibold tracking-[-0.03em] text-white">{title}</p>
        <p className="max-w-xs text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function InlineLinkArrow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="inline-flex items-center gap-1 text-sm font-semibold text-primary" href={href}>
      {children}
      <ChevronRight className="h-4 w-4" />
    </Link>
  );
}
