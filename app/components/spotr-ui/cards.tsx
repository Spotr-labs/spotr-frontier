"use client";

import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { SpotrSide } from "../../lib/spotr-types";
import { CategoryBadge, SideBadge, TokenBoughtBadge } from "./atoms";
import { MomentumBar, SpotrLogo } from "./system";

export function FaultLineCard({
  category,
  sideA,
  sideB,
  sideAPct,
  sideBPct,
  hideOdds = false,
  flipped,
  onFlip,
  locked,
  lockedSide,
}: {
  category: string;
  sideA: string;
  sideB: string;
  sideAPct: number;
  sideBPct: number;
  hideOdds?: boolean;
  flipped: boolean;
  onFlip: () => void;
  locked: boolean;
  lockedSide: SpotrSide | null;
}) {
  return (
    <button
      type="button"
      onClick={onFlip}
      className="card-flip-scene focus-ring relative flex-1 w-full hover:scale-[1.01] transition-transform duration-200"
      aria-label={`Flip fault line card. Currently showing side ${flipped ? "B" : "A"}.`}
    >
      <div
        className={cn("card-flip-inner h-full", flipped && "is-flipped")}
      >
        {/* FRONT: Side A */}
        <div
          className={cn(
            "card-flip-face overflow-hidden rounded-[1.9rem] border bg-white p-6 text-left text-[#1a1a1a] shadow-[0_18px_40px_rgba(0,0,0,0.35)]",
            locked && lockedSide === "A"
              ? "border-success ring-2 ring-success/40"
              : "border-white/25"
          )}
        >
          <div className="relative flex h-full flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryBadge>{category}</CategoryBadge>
                <SideBadge side="A" />
                {locked && lockedSide === "A" ? <TokenBoughtBadge /> : null}
              </div>
              {!hideOdds ? (
                <div className="rounded-full border border-black/10 bg-black/5 px-3 py-1 text-sm font-bold text-[#1a1a1a]">
                  {sideAPct}%
                </div>
              ) : null}
            </div>
            <div className="flex flex-1 items-center justify-center py-8">
              <p className="max-w-full text-center font-bold leading-[1.22] text-balance text-[clamp(20px,5.5vw,26px)]">
                {sideA}
              </p>
            </div>
            {!hideOdds ? (
              <div className="mt-auto">
                <MomentumBar
                  leftPct={sideAPct}
                  rightPct={sideBPct}
                  leftAccent="blue"
                  caption={`${sideAPct}% of players spotted this take`}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* BACK: Side B */}
        <div
          className={cn(
            "card-flip-face card-flip-face--back overflow-hidden rounded-[1.9rem] border bg-[#f8f6f0] p-6 text-left text-[#1a1a1a] shadow-[0_18px_40px_rgba(0,0,0,0.35)]",
            locked && lockedSide === "B"
              ? "border-success ring-2 ring-success/40"
              : "border-white/25"
          )}
        >
          <div className="relative flex h-full flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryBadge>{category}</CategoryBadge>
                <SideBadge side="B" />
                {locked && lockedSide === "B" ? <TokenBoughtBadge /> : null}
              </div>
              {!hideOdds ? (
                <div className="rounded-full border border-black/10 bg-black/5 px-3 py-1 text-sm font-bold text-[#1a1a1a]">
                  {sideBPct}%
                </div>
              ) : null}
            </div>
            <div className="flex flex-1 items-center justify-center py-8">
              <p className="max-w-full text-center font-bold leading-[1.22] text-balance text-[clamp(20px,5.5vw,26px)]">
                {sideB}
              </p>
            </div>
            {!hideOdds ? (
              <div className="mt-auto">
                <MomentumBar
                  leftPct={sideBPct}
                  rightPct={sideAPct}
                  leftAccent="gold"
                  caption={`${sideBPct}% of players spotted this take`}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export function PositionSummaryCard({
  statement,
  finalSharePct,
}: {
  statement: string;
  finalSharePct?: number | null;
}) {
  return (
    <div className="rounded-[1rem] border border-primary/30 bg-primary/6 px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
        Your position
      </p>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-white">
        &ldquo;{statement}&rdquo;
      </p>
      {finalSharePct != null ? (
        <p className="mt-1 text-[13px] text-white/55">
          Final crowd share: {finalSharePct}%
        </p>
      ) : null}
    </div>
  );
}

export function TokenConfirmationCard({
  statement,
  settlesIn,
}: {
  statement: string;
  settlesIn: number | null;
}) {
  return (
    <div className="flex h-14 items-center gap-3 overflow-hidden rounded-[14px] border-[1.5px] border-success bg-success/12 px-4">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success">
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">
          &ldquo;{statement}&rdquo;
        </p>
        <p className="text-[11px] text-white/55">
          Token bought · settles in {settlesIn ?? "—"}s
        </p>
      </div>
    </div>
  );
}

export function ConvictionCard({
  size = 180,
  bounce = false,
}: {
  size?: number;
  bounce?: boolean;
}) {
  const w = Math.round(size * (5 / 7));
  const h = size;
  return (
    <div
      className={cn("relative shrink-0", bounce && "motion-conv-bounce")}
      style={{ width: w, height: h }}
    >
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[16px] border-2 border-primary bg-[linear-gradient(155deg,#0f2a4a_0%,#1b4f8c_45%,#0d1b2e_100%)] shadow-[0_18px_48px_rgba(0,0,0,0.55),0_0_40px_rgba(245,200,0,0.15)]">
        <span className="absolute left-2 top-2 h-[22px] w-[22px] border-l-2 border-t-2 border-primary" />
        <span className="absolute right-2 top-2 h-[22px] w-[22px] border-r-2 border-t-2 border-primary" />
        <span className="absolute bottom-2 left-2 h-[22px] w-[22px] border-b-2 border-l-2 border-primary" />
        <span className="absolute bottom-2 right-2 h-[22px] w-[22px] border-b-2 border-r-2 border-primary" />

        <p className="mb-2 text-[10px] font-bold uppercase tracking-[3px] text-primary">
          CONVICTION
        </p>
        <span className="text-primary">
          <SpotrLogo size={Math.round(size * 0.55)} />
        </span>
        <p className="mt-2 text-[10px] uppercase tracking-[2px] text-white/55">
          SEALED · SEASON 1
        </p>

        <div className="absolute bottom-[22px] left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-primary">
          <span className="text-[11px] font-bold text-primary">S1</span>
        </div>
      </div>
    </div>
  );
}
