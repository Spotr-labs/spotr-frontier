"use client";

import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

export function PnlNumber({
  deltaLamports,
  isSkip = false,
}: {
  deltaLamports: number;
  isSkip?: boolean;
}) {
  const tone =
    isSkip || deltaLamports === 0
      ? "text-white/70"
      : deltaLamports > 0
        ? "text-success"
        : "text-destructive";

  const sol = deltaLamports / 1_000_000_000;
  const display = isSkip
    ? "—"
    : `${sol >= 0 ? "+" : ""}${sol.toFixed(4)} SOL`;

  return (
    <p className={cn("font-mono text-[2.4rem] font-bold tabular-nums", tone)}>
      {display}
    </p>
  );
}

export function OutcomeMessage({
  won,
  isSkip = false,
}: {
  won: boolean;
  isSkip?: boolean;
}) {
  const message = isSkip
    ? "You sat this one out."
    : won
      ? "The crowd moved your way. You spotted it early."
      : "The crowd didn't follow. Better read, next round.";
  return (
    <p className="text-[14px] leading-relaxed text-white/65">{message}</p>
  );
}

export function AutoAdvanceFooter({
  durationSeconds = 5,
  onAdvance,
}: {
  durationSeconds?: number;
  onAdvance: () => void;
}) {
  const [secLeft, setSecLeft] = useState(durationSeconds);

  useEffect(() => {
    const t = window.setInterval(() => {
      setSecLeft((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          onAdvance();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [onAdvance]);

  return (
    <button
      type="button"
      onClick={onAdvance}
      className="focus-ring w-full text-center text-xs text-white/55 hover:text-white/80"
    >
      Auto-advancing in {secLeft}s · tap to go now
    </button>
  );
}
