import { strict as assert } from "node:assert";
import { test } from "node:test";

import type {
  LiveSessionSnapshot,
  SessionRoundSummary,
} from "../lib/spotr-types";
import {
  findFirstUnresolvedSpotrRound,
  resolveSpotrSessionProgression,
} from "./spotr-session-progression";

function makeRound(
  overrides: Partial<SessionRoundSummary> & Pick<SessionRoundSummary, "id" | "index">
): SessionRoundSummary {
  return {
    id: overrides.id,
    index: overrides.index,
    pairId: overrides.pairId ?? `pair-${overrides.index}`,
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

function makeSession(input: {
  joined: boolean;
  joinedAtIso?: string | null;
  rounds: SessionRoundSummary[];
}): LiveSessionSnapshot {
  return {
    id: "session-1",
    title: "Session 1",
    status: "live",
    walletsJoined: 12,
    totalEscrowLamports: 0,
    protocolFeeAccruedLamports: 0,
    startsAtIso: "2026-05-11T10:00:00.000Z",
    endsAtIso: "2026-05-11T16:00:00.000Z",
    activatedAtIso: "2026-05-11T10:00:00.000Z",
    referralCutBps: 0,
    rounds: input.rounds,
    joined: input.joined,
    remainingEscrowLamports: 0,
    claimableSessionBalanceLamports: 0,
    currentRoundId: null,
    currentRoundIndex: null,
    chainSessionNumber: "1",
    chainSessionAddress: "chain-session",
    participant: input.joinedAtIso ? { joinedAtIso: input.joinedAtIso } : null,
  };
}

test("joined player with an open round and no side chosen resumes that round", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:55:00.000Z",
    rounds: [makeRound({ id: "r1", index: 0, status: "open" })],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), {
    kind: "resume_round",
    roundId: "r1",
    roundIndex: 0,
  });
});

test("joined player with a deposited waiting round and no side chosen resumes that round", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:00:00.000Z",
    rounds: [
      makeRound({
        id: "r1",
        index: 0,
        status: "upcoming",
        depositLamports: 1_000_000,
      }),
    ],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), {
    kind: "resume_round",
    roundId: "r1",
    roundIndex: 0,
  });
});

test("joined player who missed a closed round treats it as sat out and advances", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:00:00.000Z",
    rounds: [
      makeRound({ id: "r1", index: 0, status: "closed" }),
      makeRound({ id: "r2", index: 1, status: "upcoming" }),
    ],
  });

  assert.equal(findFirstUnresolvedSpotrRound(session)?.id, "r2");
  assert.deepEqual(resolveSpotrSessionProgression(session), {
    kind: "resume_round",
    roundId: "r2",
    roundIndex: 1,
  });
});

test("late joiner does not get blocked by an already-open round they can no longer enter", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T12:05:00.000Z",
    rounds: [
      makeRound({
        id: "r1",
        index: 0,
        status: "open",
        opensAtIso: "2026-05-11T12:00:00.000Z",
      }),
      makeRound({ id: "r2", index: 1, status: "upcoming" }),
    ],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), {
    kind: "resume_round",
    roundId: "r2",
    roundIndex: 1,
  });
});

test("joined player with a locked open round stays on that round until reveal", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:55:00.000Z",
    rounds: [
      makeRound({
        id: "r1",
        index: 0,
        status: "open",
        depositLamports: 1_000_000,
        lockedSide: "A",
      }),
      makeRound({ id: "r2", index: 1, status: "upcoming" }),
    ],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), {
    kind: "resume_round",
    roundId: "r1",
    roundIndex: 0,
  });
});

test("dismissed locked round advances to the next unresolved round", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:55:00.000Z",
    rounds: [
      makeRound({
        id: "r1",
        index: 0,
        status: "open",
        depositLamports: 1_000_000,
        lockedSide: "A",
      }),
      makeRound({ id: "r2", index: 1, status: "upcoming" }),
    ],
  });

  assert.deepEqual(
    resolveSpotrSessionProgression(session, {
      dismissedRoundIds: new Set(["r1"]),
    }),
    {
      kind: "resume_round",
      roundId: "r2",
      roundIndex: 1,
    }
  );
});

test("dismissed final locked round goes to recap", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:55:00.000Z",
    rounds: [
      makeRound({
        id: "r1",
        index: 0,
        status: "open",
        depositLamports: 1_000_000,
        lockedSide: "A",
      }),
    ],
  });

  assert.deepEqual(
    resolveSpotrSessionProgression(session, {
      dismissedRoundIds: new Set(["r1"]),
    }),
    { kind: "recap" }
  );
});

test("joined player with every round either locked or sat out goes to recap", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:00:00.000Z",
    rounds: [
      makeRound({ id: "r1", index: 0, status: "closed", lockedSide: "A" }),
      makeRound({ id: "r2", index: 1, status: "closed" }),
      makeRound({ id: "r3", index: 2, status: "skipped" }),
    ],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), { kind: "recap" });
});

test("player who finished round 2 resumes round 3 instead of recap", () => {
  const session = makeSession({
    joined: true,
    joinedAtIso: "2026-05-11T11:00:00.000Z",
    rounds: [
      makeRound({
        id: "r1",
        index: 0,
        status: "closed",
        depositLamports: 1_000_000,
        lockedSide: "A",
      }),
      makeRound({
        id: "r2",
        index: 1,
        status: "closed",
        depositLamports: 1_000_000,
        lockedSide: "B",
      }),
      makeRound({ id: "r3", index: 2, status: "upcoming" }),
      makeRound({ id: "r4", index: 3, status: "upcoming" }),
    ],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), {
    kind: "resume_round",
    roundId: "r3",
    roundIndex: 2,
  });
});

test("not joined stays in pre_join progression", () => {
  const session = makeSession({
    joined: false,
    joinedAtIso: null,
    rounds: [makeRound({ id: "r1", index: 0, status: "upcoming" })],
  });

  assert.deepEqual(resolveSpotrSessionProgression(session), { kind: "pre_join" });
});
