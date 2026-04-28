"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { microUsdcToDisplay } from "../../lib/usdc";
import { ellipsify } from "../../lib/explorer";
import { SpotrLogo } from "./system";

export function BalancePill({
  balanceLamports,
}: {
  balanceLamports: bigint | number | null;
}) {
  return (
    <div className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-foreground backdrop-blur">
      <span className="text-primary">$</span>
      <span className="font-mono tabular-nums">
        {balanceLamports == null ? "0.00" : microUsdcToDisplay(Number(balanceLamports))}
      </span>
    </div>
  );
}

export function CategoryBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--category-blue)] px-3 py-[3px] text-[11px] font-bold uppercase tracking-[0.18em] text-white">
      {children}
    </span>
  );
}

export function SideBadge({ side }: { side: string }) {
  return (
    <span className="rounded-full bg-black/6 px-3 py-[3px] text-[11px] font-bold uppercase tracking-[0.18em] text-black/70">
      Side {side}
    </span>
  );
}

export function TokenBoughtBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-3 py-[3px] text-[11px] font-bold uppercase tracking-[0.18em] text-success">
      <Check className="h-3 w-3" strokeWidth={3} />
      Token bought
    </span>
  );
}

export function RoundLabel({ index, total }: { index: number; total: number }) {
  return (
    <span className="text-sm font-bold text-white">
      Round {index} of {total}
    </span>
  );
}

export function EyeBrand({
  size = 32,
  withWordmark = false,
}: {
  size?: number;
  withWordmark?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-primary">
        <SpotrLogo size={size} />
      </span>
      {withWordmark ? (
        <span className="text-base font-bold tracking-[0.08em] text-primary">
          SPOTR.TV
        </span>
      ) : null}
    </div>
  );
}

const AVATAR_TONES = {
  green: "bg-[#4aa94c]",
  blue: "bg-[#4a98db]",
  olive: "bg-[#8e9641]",
  cyan: "bg-[#48c1bf]",
} as const;

export type AvatarTone = keyof typeof AVATAR_TONES;

export function avatarToneFromSeed(seed: string): AvatarTone {
  const tones: AvatarTone[] = ["green", "blue", "olive", "cyan"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return tones[hash % tones.length];
}

export function WalletAvatar({
  seed,
  size = 28,
}: {
  seed: string;
  size?: number;
}) {
  const tone = avatarToneFromSeed(seed);
  const initial = seed.slice(0, 1).toUpperCase();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
        AVATAR_TONES[tone]
      )}
      style={{ width: size, height: size }}
    >
      {initial}
    </div>
  );
}

export function JoinedPlayerRow({
  address,
  status,
}: {
  address: string;
  status?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[1rem] border border-white/10 bg-white/4 px-4 py-3">
      <WalletAvatar seed={address} />
      <p className="flex-1 truncate font-mono text-sm font-semibold tabular-nums text-white">
        {ellipsify(address, 5)}
      </p>
      {status ? (
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-success">
          {status}
        </span>
      ) : null}
    </div>
  );
}

export function LedgerPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className={cn(
        "rounded-full border px-4 py-3",
        tone === "accent"
          ? "border-primary/35 bg-primary/10"
          : "border-white/10 bg-white/4"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
