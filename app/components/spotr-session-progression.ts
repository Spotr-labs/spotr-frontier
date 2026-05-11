import type {
  LiveSessionSnapshot,
  SessionRoundSummary,
} from "../lib/spotr-types";

export type SpotrSessionProgression =
  | { kind: "pre_join" }
  | { kind: "resume_round"; roundId: string; roundIndex: number }
  | { kind: "recap" };

type SessionProgressionInput = Pick<
  LiveSessionSnapshot,
  "joined" | "participant" | "rounds"
>;

type SessionProgressionOptions = {
  dismissedRoundIds?: ReadonlySet<string>;
};

function getSessionJoinedAtMs(session: SessionProgressionInput) {
  const joinedAtIso = session.participant?.joinedAtIso;
  if (!joinedAtIso) return null;
  const joinedAtMs = new Date(joinedAtIso).getTime();
  return Number.isFinite(joinedAtMs) ? joinedAtMs : null;
}

function canLateDeposit(
  round: SessionRoundSummary,
  sessionJoinedAtMs: number | null
) {
  if (round.depositLamports != null) return true;
  if (sessionJoinedAtMs == null || round.opensAtIso == null) return false;
  const opensAtMs = new Date(round.opensAtIso).getTime();
  if (!Number.isFinite(opensAtMs)) return false;
  return sessionJoinedAtMs <= opensAtMs;
}

export function isSpotrRoundResolved(
  round: SessionRoundSummary,
  sessionJoinedAtMs: number | null
) {
  if (round.status === "closed" || round.status === "skipped") return true;
  if (round.lockedSide != null) return false;
  if (round.status === "open") {
    return !canLateDeposit(round, sessionJoinedAtMs);
  }
  return false;
}

export function findFirstUnresolvedSpotrRound(
  session: SessionProgressionInput,
  options?: SessionProgressionOptions
) {
  if (!session.joined) return null;
  const sessionJoinedAtMs = getSessionJoinedAtMs(session);
  const dismissedRoundIds = options?.dismissedRoundIds;
  return (
    session.rounds.find((round) => {
      if (dismissedRoundIds?.has(round.id)) return false;
      return !isSpotrRoundResolved(round, sessionJoinedAtMs);
    }) ?? null
  );
}

export function resolveSpotrSessionProgression(
  session: SessionProgressionInput,
  options?: SessionProgressionOptions
): SpotrSessionProgression {
  if (!session.joined) return { kind: "pre_join" };
  const round = findFirstUnresolvedSpotrRound(session, options);
  if (!round) return { kind: "recap" };
  return {
    kind: "resume_round",
    roundId: round.id,
    roundIndex: round.index,
  };
}
