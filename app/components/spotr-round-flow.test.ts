import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { SessionRoundSummary } from "../lib/spotr-types";
import {
  canPredictRound,
  deriveSpotrRoundPhase,
} from "./spotr-round-flow";

function makeRound(overrides: Partial<SessionRoundSummary> = {}): SessionRoundSummary {
  return {
    id: overrides.id ?? "round-1",
    index: overrides.index ?? 0,
    pairId: overrides.pairId ?? "pair-1",
    lockedSide: overrides.lockedSide,
    status: overrides.status ?? "upcoming",
    opensAtIso: overrides.opensAtIso ?? "2026-05-11T12:00:00.000Z",
    closesAtIso: overrides.closesAtIso ?? "2026-05-11T12:30:00.000Z",
    sideAProbabilityPct: overrides.sideAProbabilityPct ?? 50,
    sideBProbabilityPct: overrides.sideBProbabilityPct ?? 50,
    sideATotalEntries: overrides.sideATotalEntries ?? 0,
    sideBTotalEntries: overrides.sideBTotalEntries ?? 0,
    stakeLamports: overrides.stakeLamports ?? null,
    claimableLamports: overrides.claimableLamports ?? 0,
    claimedLamports: overrides.claimedLamports ?? 0,
    walletsDepositedForRound: overrides.walletsDepositedForRound ?? 0,
    depositorAddresses: overrides.depositorAddresses ?? [],
    depositLamports: overrides.depositLamports ?? null,
    depositRefunded: overrides.depositRefunded ?? false,
  };
}

test("round phase derives deposit before the wallet has a round deposit", () => {
  assert.equal(
    deriveSpotrRoundPhase(makeRound(), {
      fillThreshold: 7,
      countdown: null,
    }),
    "deposit"
  );
});

test("round phase waits after deposit until the fill threshold is reached", () => {
  assert.equal(
    deriveSpotrRoundPhase(
      makeRound({ depositLamports: 1_000_000, walletsDepositedForRound: 6 }),
      {
        fillThreshold: 7,
        countdown: null,
      }
    ),
    "wait"
  );
});

test("round phase predicts once threshold is reached even if backend status is stale", () => {
  const round = makeRound({
    depositLamports: 1_000_000,
    walletsDepositedForRound: 7,
    status: "upcoming",
  });

  assert.equal(canPredictRound(round, 7), true);
  assert.equal(
    deriveSpotrRoundPhase(round, {
      fillThreshold: 7,
      countdown: null,
    }),
    "predict"
  );
});

test("round phase keeps a locked open round active until countdown reveal", () => {
  const round = makeRound({
    depositLamports: 1_000_000,
    walletsDepositedForRound: 7,
    lockedSide: "A",
    status: "open",
  });

  assert.equal(
    deriveSpotrRoundPhase(round, {
      fillThreshold: 7,
      countdown: 12,
    }),
    "locked"
  );
  assert.equal(
    deriveSpotrRoundPhase(round, {
      fillThreshold: 7,
      countdown: 0,
    }),
    "reveal"
  );
});

test("round phase treats closed rounds as settled", () => {
  assert.equal(
    deriveSpotrRoundPhase(
      makeRound({
        depositLamports: 1_000_000,
        lockedSide: "A",
        status: "closed",
      }),
      {
        fillThreshold: 7,
        countdown: 0,
      }
    ),
    "settled"
  );
});
