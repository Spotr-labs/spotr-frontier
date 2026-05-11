import type { SessionRoundSummary } from "../lib/spotr-types";

export type SpotrRoundPhase =
  | "deposit"
  | "wait"
  | "predict"
  | "locked"
  | "reveal"
  | "settled";

export function hasRoundFillThreshold(
  round: Pick<SessionRoundSummary, "walletsDepositedForRound">,
  fillThreshold: number
) {
  return round.walletsDepositedForRound >= fillThreshold;
}

export function canPredictRound(
  round: Pick<SessionRoundSummary, "status" | "walletsDepositedForRound">,
  fillThreshold: number
) {
  return round.status === "open" || hasRoundFillThreshold(round, fillThreshold);
}

export function deriveSpotrRoundPhase(
  round: Pick<
    SessionRoundSummary,
    "depositLamports" | "lockedSide" | "status" | "walletsDepositedForRound"
  >,
  options: {
    fillThreshold: number;
    countdown: number | null;
  }
): SpotrRoundPhase {
  if (round.status === "closed" || round.status === "skipped") return "settled";
  if (round.depositLamports != null && options.countdown === 0) return "reveal";
  if (round.lockedSide) return "locked";
  if (round.depositLamports == null) return "deposit";
  if (canPredictRound(round, options.fillThreshold)) return "predict";
  return "wait";
}
