import {
  PositionSide,
  ReferralStatus,
  RewardKind,
  RewardStatus,
  RoundStatus,
  SessionStatus as PrismaSessionStatus,
  type Prisma,
} from "@prisma/client";
import { publicSpotrConfig } from "../spotr-config/public";
import { serverSpotrConfig } from "../spotr-config/server";
import type {
  AdminAnalytics,
  AdminAuditEntry,
  AdminAuditListResponse,
  AdminCardPackTemplate,
  AdminOpsResponse,
  AdminOpsRoundRow,
  AdminOpsSessionRow,
  AdminOverviewResponse,
  AdminPairLibraryItem,
  AdminPairListResponse,
  AdminPairTableRow,
  AdminParticipant,
  AdminPlayerDetail,
  AdminPlayerListItem,
  AdminPlayerListResponse,
  AdminPlayerPositionRow,
  AdminPlayerReferralPanel,
  AdminPlayerReward,
  AdminPlayerSessionRow,
  AdminReferralBalance,
  AdminReferralBatch,
  AdminReferralBatchListResponse,
  AdminReferralListResponse,
  AdminReferrerDetail,
  AdminRewardItem,
  AdminRewardListResponse,
  AdminSessionDetail,
  AdminSessionListItem,
  AdminSessionListResponse,
  AdminSessionParticipantDetail,
  AdminSessionPositionDetail,
  AdminSessionReferralDetail,
  AdminSessionRoundDetail,
  AdminSideDistributionPoint,
  AdminSessionCard,
  AdminSummary,
  AdminTimePoint,
  AdminTopReferrer,
  AdminTransactionDetail,
  AdminTransactionListResponse,
  FaultLinePair,
  LiveSessionSnapshot,
  ProfileSessionHistoryRow,
  ProfileSessionRoundRow,
  ProfileSummary,
  ReferredWalletContribution,
  RecentReward,
  RewardInventoryItem,
  SessionPublicResults,
  SessionRoundSummary,
  SpotrDashboardPayload,
  SpotrPublicConfig,
  SpotrSide,
} from "../spotr-types";
import { prisma } from "./db";
import { launchFaultLineSeeds } from "./launch-seed";
import { getSessionWindowForDate } from "../spotr-config/session-window";
import { getJoinChainPersistence } from "./join-persistence";

const REWARD_SCALE = 1_000_000_000n;

type Tx = Prisma.TransactionClient;

type SessionWithRounds = Prisma.SessionGetPayload<{
  include: {
    rounds: {
      include: { pair: true };
      orderBy: { roundIndex: "asc" };
    };
  };
}>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeWalletAddress(walletAddress?: string | null) {
  const normalized = walletAddress?.trim();
  if (!normalized) return null;
  return normalized;
}

function toNumber(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

function mapSessionStatus(status: PrismaSessionStatus): LiveSessionSnapshot["status"] {
  switch (status) {
    case "LIVE":
      return "live";
    case "EXPIRED":
      return "expired";
    case "COMPLETED":
      return "completed";
    case "PENDING":
    default:
      return "pending";
  }
}

function mapRoundStatus(status: RoundStatus): SessionRoundSummary["status"] {
  switch (status) {
    case "OPEN":
      return "open";
    case "CLOSED":
      return "closed";
    case "SKIPPED":
      return "skipped";
    case "UPCOMING":
    default:
      return "upcoming";
  }
}

function mapRewardKind(kind: RewardKind): RewardInventoryItem["kind"] {
  switch (kind) {
    case "MERCH":
      return "merch";
    case "GIFT_CARD":
      return "gift-card";
    case "VOUCHER":
      return "voucher";
    case "NFT":
    default:
      return "nft";
  }
}

function mapRewardStatus(status: RewardStatus): RewardInventoryItem["status"] {
  switch (status) {
    case "CLAIMABLE":
      return "claimable";
    case "CLAIMED":
      return "claimed";
    case "ASSIGNED":
    default:
      return "assigned";
  }
}

function getLaunchWindow(config: SpotrPublicConfig) {
  return getSessionWindowForDate(new Date(config.launchIso), config);
}

function getSessionTitle(seasonLabel: string, ordinal?: number) {
  return ordinal == null
    ? `${seasonLabel} launch session`
    : `${seasonLabel} session ${ordinal}`;
}

function getSessionSlug(seasonLabel: string, startsAt: Date, ordinal?: number) {
  const base = `${slugify(seasonLabel)}-${startsAt.toISOString().slice(0, 10)}`;
  return ordinal == null ? base : `${base}-s${ordinal}`;
}

function getProbabilities(
  sideALamports: bigint,
  sideBLamports: bigint,
  fallbackSideA: number,
  fallbackSideB: number
) {
  const total = sideALamports + sideBLamports;
  if (total <= 0n) {
    return { sideA: fallbackSideA, sideB: fallbackSideB };
  }

  const sideA = Number((sideALamports * 100n) / total);
  return {
    sideA,
    sideB: 100 - sideA,
  };
}

function getDefaultCrowdLabel() {
  return launchFaultLineSeeds[0]?.crowdLabel ?? "of players spotted this take";
}

let faultLineSeedsSynced = false;

async function syncFaultLineSeeds() {
  if (faultLineSeedsSynced) return;
  for (const pair of launchFaultLineSeeds) {
    await prisma.faultLinePair.upsert({
      where: { slug: pair.slug },
      update: {
        category: pair.category,
        sideA: pair.sideA,
        sideB: pair.sideB,
        defaultSideAPct: pair.sideAPct,
        defaultSideBPct: pair.sideBPct,
        crowdLabel: pair.crowdLabel,
      },
      create: {
        slug: pair.slug,
        category: pair.category,
        sideA: pair.sideA,
        sideB: pair.sideB,
        defaultSideAPct: pair.sideAPct,
        defaultSideBPct: pair.sideBPct,
        crowdLabel: pair.crowdLabel,
        active: true,
      },
    });
  }
  faultLineSeedsSynced = true;
}

async function rebuildSessionRounds(tx: Tx, sessionId: string, pairIds: string[]) {
  await tx.referralAccrual.deleteMany({
    where: { sessionId },
  });
  await tx.roundPosition.deleteMany({
    where: {
      round: { sessionId },
    },
  });
  await tx.sessionRound.deleteMany({
    where: { sessionId },
  });
  await tx.transactionLog.deleteMany({
    where: { sessionId },
  });

  const pairs = await tx.faultLinePair.findMany({
    where: {
      id: { in: pairIds },
    },
  });
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]));

  await tx.sessionRound.createMany({
    data: pairIds.map((pairId, index) => {
      const pair = pairById.get(pairId);
      if (!pair) {
        throw new Error(`Pair ${pairId} was not found while rebuilding session rounds.`);
      }
      return {
        sessionId,
        pairId,
        roundIndex: index,
        status: "UPCOMING",
        sideAProbabilityPct: pair.defaultSideAPct,
        sideBProbabilityPct: pair.defaultSideBPct,
      };
    }),
  });
}

async function createSessionWithPairs(
  tx: Tx,
  input: {
    slug: string;
    title: string;
    seasonLabel: string;
    launchIso: Date;
    startsAt: Date;
    endsAt: Date;
    pairIds: string[];
    buyInLamports?: number;
  }
) {
  const session = await tx.session.create({
    data: {
      slug: input.slug,
      title: input.title,
      seasonLabel: input.seasonLabel,
      status: "PENDING",
      launchIso: input.launchIso,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      roundCount: publicSpotrConfig.roundCount,
      roundDurationSeconds: publicSpotrConfig.roundDurationSeconds,
      roundFillThreshold: publicSpotrConfig.roundFillThreshold,
      buyInLamports: BigInt(input.buyInLamports ?? publicSpotrConfig.sessionBuyInLamports),
      protocolFeeBps: publicSpotrConfig.protocolFeeBps,
      referralCutBps: publicSpotrConfig.referralCutBps,
      cardRewardSlots: publicSpotrConfig.cardRewardSlots,
      payoutCadenceDays: publicSpotrConfig.payoutCadenceDays,
    },
  });

  await rebuildSessionRounds(tx, session.id, input.pairIds);
  return session.id;
}

async function ensureLaunchSession(tx: Tx, config: SpotrPublicConfig) {
  await syncFaultLineSeeds();
  const sessionCount = await tx.session.count();
  if (sessionCount > 0) {
    return;
  }

  const pairs = await tx.faultLinePair.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    take: config.roundCount,
  });
  const selectedPairs = pairs.slice(0, config.roundCount);
  if (selectedPairs.length < config.roundCount) {
    throw new Error("Not enough active fault-line pairs to build the launch session.");
  }

  const { startsAt, endsAt } = getLaunchWindow(config);
  await createSessionWithPairs(tx, {
    slug: getSessionSlug(config.seasonLabel, startsAt),
    title: getSessionTitle(config.seasonLabel),
    seasonLabel: config.seasonLabel,
    launchIso: new Date(config.launchIso),
    startsAt,
    endsAt,
    pairIds: selectedPairs.map((pair) => pair.id),
  });
}

async function getPrimarySessionId(tx: Tx) {
  await ensureLaunchSession(tx, publicSpotrConfig);

  const live = await tx.session.findFirst({
    where: { status: "LIVE" },
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (live) {
    return live.id;
  }

  const pending = await tx.session.findFirst({
    where: { status: "PENDING" },
    orderBy: [{ startsAt: "asc" }, { createdAt: "desc" }],
  });
  if (pending) {
    return pending.id;
  }

  const latest = await tx.session.findFirst({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!latest) {
    throw new Error("No SPOTR session is available.");
  }

  return latest.id;
}

function deriveRoundStatus(
  sessionStatus: PrismaSessionStatus,
  opensAt: Date | null,
  closesAt: Date | null,
  now: Date
): RoundStatus {
  if (sessionStatus === "EXPIRED") {
    return "UPCOMING";
  }
  if (!opensAt || !closesAt) {
    return "UPCOMING";
  }
  if (now < opensAt) {
    return "UPCOMING";
  }
  if (now >= closesAt || sessionStatus === "COMPLETED") {
    return "CLOSED";
  }
  return "OPEN";
}

function isSessionSettled(status: PrismaSessionStatus) {
  return status === "COMPLETED" || status === "EXPIRED";
}

function derivePositionClaimableLamports(
  round: Pick<
    Prisma.SessionRoundGetPayload<object>,
    "winningSide" | "redistributeApplied"
  >,
  position: Pick<
    Prisma.RoundPositionGetPayload<object>,
    "side" | "finalPayoutLamports" | "claimedLamports"
  >
) {
  // Pre-settlement → nothing claimable.
  if (!round.redistributeApplied) return 0n;
  // Losing-side positions have final_payout = 0 by design (settle_round
  // only writes the winning side). Be defensive: explicitly zero them out.
  if (round.winningSide && round.winningSide !== position.side) return 0n;
  const pending = position.finalPayoutLamports - position.claimedLamports;
  return pending > 0n ? pending : 0n;
}

async function promoteClaimableReferrals(tx: Tx, sessionId: string, now: Date) {
  await tx.referralAccrual.updateMany({
    where: {
      sessionId,
      status: "PENDING",
    },
    data: {
      status: "CLAIMABLE",
      claimableAt: now,
    },
  });
}

async function loadSessionWithRounds(tx: Tx, sessionId: string): Promise<SessionWithRounds> {
  return tx.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      rounds: {
        include: { pair: true },
        orderBy: { roundIndex: "asc" },
      },
    },
  });
}

async function syncSessionState(tx: Tx, sessionId: string) {
  const now = new Date();
  const session = await loadSessionWithRounds(tx, sessionId);

  const participantAggregate = await tx.sessionParticipant.aggregate({
    where: { sessionId },
    _count: { _all: true },
    _sum: { totalEscrowLamports: true },
  });

  const joinedWallets = participantAggregate._count._all;
  const totalEscrowLamports = participantAggregate._sum.totalEscrowLamports ?? 0n;

  // Activation is time-based: once startsAt arrives, the session is live
  // regardless of how many wallets joined. At endsAt, COMPLETED vs EXPIRED
  // is decided by whether anyone joined.
  let activatedAt = session.activatedAt;
  if (!activatedAt && now >= session.startsAt) {
    activatedAt = session.startsAt;
  }

  let nextStatus: PrismaSessionStatus = "PENDING";
  if (now >= session.endsAt) {
    nextStatus = joinedWallets > 0 ? "COMPLETED" : "EXPIRED";
  } else if (activatedAt) {
    nextStatus = "LIVE";
  }

  let mutated = false;
  const writes: Array<Promise<unknown>> = [];

  if (activatedAt) {
    // closesAt mirrors the session window (rounds settle when the session
    // ends). opensAt is stamped only at the moment the round actually flips
    // Pending → Open in `recordRoundDeposit` — DO NOT overwrite it here, or
    // the per-round countdown (`opensAt + roundDurationSeconds - now`) jumps
    // straight to 0 because `activatedAt` is far in the past by then. We
    // also seed opensAt = activatedAt for UPCOMING rounds so the late-deposit
    // gate has a sane scheduled value to compare against until the flip.
    const closesAt = session.endsAt;
    const roundIdsToReschedule = session.rounds
      .filter(
        (round) =>
          (round.status === "UPCOMING" &&
            round.opensAt?.toISOString() !== activatedAt.toISOString()) ||
          round.closesAt?.toISOString() !== closesAt.toISOString()
      )
      .map((round) => round.id);
    if (roundIdsToReschedule.length > 0) {
      writes.push(
        tx.sessionRound.updateMany({
          where: { id: { in: roundIdsToReschedule }, status: "UPCOMING" },
          data: { opensAt: activatedAt, closesAt },
        })
      );
      // closesAt for already-OPEN rounds: keep the session-end value too.
      writes.push(
        tx.sessionRound.updateMany({
          where: {
            id: { in: roundIdsToReschedule },
            status: { not: "UPCOMING" },
          },
          data: { closesAt },
        })
      );
      mutated = true;
    }
  }

  const sessionFieldsChanged =
    session.joinedWallets !== joinedWallets ||
    session.totalEscrowLamports !== totalEscrowLamports ||
    session.status !== nextStatus ||
    session.activatedAt?.toISOString() !== activatedAt?.toISOString();

  if (sessionFieldsChanged) {
    writes.push(
      tx.session.update({
        where: { id: sessionId },
        data: {
          joinedWallets,
          totalEscrowLamports,
          status: nextStatus,
          activatedAt,
          completedAt:
            nextStatus === "COMPLETED"
              ? session.completedAt ?? now
              : nextStatus === "EXPIRED"
                ? null
                : session.completedAt,
        },
      })
    );
    mutated = true;
  }

  // Group round status flips by target status so we can issue at most one
  // updateMany per status (most calls produce zero or one).
  const roundStatusUpdates = new Map<RoundStatus, string[]>();
  for (const round of session.rounds) {
    const opensAt = activatedAt ?? round.opensAt;
    const closesAt = activatedAt ? session.endsAt : round.closesAt;
    const derivedStatus = deriveRoundStatus(nextStatus, opensAt, closesAt, now);
    // Rounds transition UPCOMING → OPEN only via the deposit threshold in
    // recordRoundDeposit — never by time alone. Only allow time-driven
    // transitions away from OPEN (i.e. OPEN → CLOSED).
    if (derivedStatus === "OPEN" && round.status === "UPCOMING") continue;
    if (round.status !== derivedStatus) {
      const list = roundStatusUpdates.get(derivedStatus) ?? [];
      list.push(round.id);
      roundStatusUpdates.set(derivedStatus, list);
    }
  }

  for (const [status, ids] of roundStatusUpdates) {
    writes.push(
      tx.sessionRound.updateMany({
        where: { id: { in: ids } },
        data: { status },
      })
    );
    mutated = true;
  }

  // Only promote referrals when the session is actually live or completed —
  // earlier statuses cannot have promotable accruals.
  if (nextStatus === "LIVE" || nextStatus === "COMPLETED") {
    writes.push(promoteClaimableReferrals(tx, sessionId, now));
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }

  if (!mutated) {
    return session;
  }

  return loadSessionWithRounds(tx, sessionId);
}

async function buildProfileSummary(
  tx: Tx,
  walletAddress: string,
  now: Date
): Promise<ProfileSummary> {
  const participants = await tx.sessionParticipant.findMany({
    where: { walletAddress },
    orderBy: { joinedAt: "desc" },
    take: 50,
    select: {
      remainingEscrowLamports: true,
      session: { select: { status: true } },
      positions: {
        take: 200,
        orderBy: { submittedAt: "desc" },
        select: {
          roundId: true,
          side: true,
          stakeLamports: true,
          claimedLamports: true,
          finalPayoutLamports: true,
          round: {
            select: {
              opensAt: true,
              closesAt: true,
              winningSide: true,
              redistributeApplied: true,
              session: { select: { status: true } },
            },
          },
        },
      },
      rewards: {
        take: 50,
        orderBy: { assignedAt: "desc" },
        select: {
          id: true,
          kind: true,
          title: true,
          subtitle: true,
          status: true,
          assignedAt: true,
        },
      },
    },
  });

  const referralAccruals = await tx.referralAccrual.findMany({
    where: { referrerWallet: walletAddress },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  let cumulativePnlLamports = 0n;
  let claimableRoundLamports = 0n;
  let claimableSessionBalanceLamports = 0n;

  for (const participant of participants) {
    if (isSessionSettled(participant.session.status)) {
      claimableSessionBalanceLamports += participant.remainingEscrowLamports;
    }

    for (const position of participant.positions) {
      const roundStatus = deriveRoundStatus(
        position.round.session.status,
        position.round.opensAt,
        position.round.closesAt,
        now
      );
      if (roundStatus !== "CLOSED") {
        continue;
      }

      const pending = derivePositionClaimableLamports(position.round, position);
      const settled = pending + position.claimedLamports;
      claimableRoundLamports += pending;
      cumulativePnlLamports += settled - position.stakeLamports;
    }
  }

  const rewards = participants
    .flatMap((participant) => participant.rewards)
    .sort((left, right) => right.assignedAt.getTime() - left.assignedAt.getTime())
    .slice(0, publicSpotrConfig.cardRewardSlots)
    .map<RewardInventoryItem>((reward) => ({
      id: reward.id,
      kind: mapRewardKind(reward.kind),
      title: reward.title,
      subtitle: reward.subtitle,
      status: mapRewardStatus(reward.status),
    }));

  const referralPendingLamports = referralAccruals.reduce(
    (total, referral) =>
      referral.status === "CLAIMED" ? total : total + referral.amountLamports,
    0n
  );
  const referralPaidOutLamports = referralAccruals.reduce(
    (total, referral) =>
      referral.status === "CLAIMED" ? total + referral.amountLamports : total,
    0n
  );
  const referredWalletMap = new Map<
    string,
    { totalEarnedLamports: bigint; paidOutLamports: bigint }
  >();
  for (const referral of referralAccruals) {
    const current = referredWalletMap.get(referral.refereeWallet) ?? {
      totalEarnedLamports: 0n,
      paidOutLamports: 0n,
    };
    current.totalEarnedLamports += referral.amountLamports;
    if (referral.status === "CLAIMED") {
      current.paidOutLamports += referral.amountLamports;
    }
    referredWalletMap.set(referral.refereeWallet, current);
  }

  const referredWalletBreakdown = Array.from(referredWalletMap.entries())
    .map<ReferredWalletContribution>(([referredWallet, totals]) => ({
      walletAddress: referredWallet,
      totalEarnedLamports: toNumber(totals.totalEarnedLamports),
      paidOutLamports: toNumber(totals.paidOutLamports),
      balanceDueLamports: toNumber(
        totals.totalEarnedLamports - totals.paidOutLamports
      ),
    }))
    .sort((left, right) => right.totalEarnedLamports - left.totalEarnedLamports);

  return {
    walletAddress,
    displayName: null,
    paidSessions: participants.filter((participant) => participant.positions.length > 0).length,
    cumulativePnlLamports: toNumber(cumulativePnlLamports),
    referredWallets: referredWalletBreakdown.length,
    referralPendingLamports: toNumber(referralPendingLamports),
    referralPaidOutLamports: toNumber(referralPaidOutLamports),
    claimableRoundLamports: toNumber(claimableRoundLamports),
    claimableSessionBalanceLamports: toNumber(claimableSessionBalanceLamports),
    referredWalletBreakdown,
    rewards,
  };
}

async function buildAdminSummary(
  tx: Tx,
  sessionId: string,
  normalizedWalletAddress?: string | null,
  sessionsCursor?: string | null
): Promise<AdminSummary> {
  const authorized =
    normalizedWalletAddress != null &&
    serverSpotrConfig.adminWallets.includes(normalizedWalletAddress);

  if (!authorized) {
    return {
      authorized: false,
      lowPairAlert: false,
      activePairs: 0,
      availablePairs: 0,
      liveSessions: 0,
      pendingSessions: 0,
      protocolFeesLamports: 0,
      pendingReferralLamports: 0,
      assignedRewards: 0,
      claimableRewards: 0,
      recentTransactions: [],
      recentRewards: [],
      participants: [],
      pairLibrary: [],
      sessionHistory: [],
      nextSessionsCursor: null,
      referralBalances: [],
    };
  }

  const { skip: sessionsSkip } = decodeListCursor(sessionsCursor ?? null);
  const [
    allPairs,
    assignedPairs,
    liveSessions,
    pendingSessions,
    protocolFees,
    referralAccruals,
    assignedRewards,
    claimableRewards,
    recentTransactions,
    recentRewards,
    participants,
    sessionHistory,
  ] = await Promise.all([
    tx.faultLinePair.findMany({
      orderBy: [{ active: "desc" }, { category: "asc" }, { slug: "asc" }],
    }),
    tx.sessionRound.findMany({
      where: {
        session: {
          status: { in: ["PENDING", "LIVE"] },
        },
      },
      select: { pairId: true },
      distinct: ["pairId"],
    }),
    tx.session.count({ where: { status: "LIVE" } }),
    tx.session.count({ where: { status: "PENDING" } }),
    tx.session.aggregate({
      _sum: { protocolFeeAccruedLamports: true },
    }),
    tx.referralAccrual.aggregate({
      where: {
        status: { in: ["PENDING", "CLAIMABLE"] },
      },
      _sum: { amountLamports: true },
    }),
    tx.rewardInventory.count({ where: { status: "ASSIGNED" } }),
    tx.rewardInventory.count({ where: { status: "CLAIMABLE" } }),
    tx.transactionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    tx.rewardInventory.findMany({
      orderBy: { assignedAt: "desc" },
      take: 6,
    }),
    tx.sessionParticipant.findMany({
      where: { sessionId },
      orderBy: { joinedAt: "desc" },
      take: 8,
      include: {
        positions: {
          select: { id: true },
        },
      },
    }),
    tx.session.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 21,
      skip: sessionsSkip,
    }),
  ]);

  const hasMoreSessions = sessionHistory.length > 20;
  const sessionsPage = hasMoreSessions ? sessionHistory.slice(0, 20) : sessionHistory;

  const assignedPairIds = new Set(assignedPairs.map((pair) => pair.pairId));
  const activePairs = allPairs.filter((pair) => pair.active).length;
  const pairLibrary = allPairs.map<AdminPairLibraryItem>((pair) => ({
    id: pair.id,
    slug: pair.slug,
    category: pair.category,
    sideA: pair.sideA,
    sideB: pair.sideB,
    active: pair.active,
    assigned: assignedPairIds.has(pair.id),
  }));

  const [perPairTotals, paidOutTotals] = await Promise.all([
    tx.referralAccrual.groupBy({
      by: ["referrerWallet", "refereeWallet"],
      where: {
        session: { status: { in: ["PENDING", "LIVE", "COMPLETED"] } },
      },
      _sum: { amountLamports: true },
    }),
    tx.referralAccrual.groupBy({
      by: ["referrerWallet"],
      where: { status: "CLAIMED" },
      _sum: { amountLamports: true },
    }),
  ]);

  const paidByReferrer = new Map<string, bigint>();
  for (const row of paidOutTotals) {
    paidByReferrer.set(row.referrerWallet, row._sum.amountLamports ?? 0n);
  }

  const referralBalanceMap = new Map<
    string,
    {
      referees: Set<string>;
      totalAccruedLamports: bigint;
    }
  >();
  for (const row of perPairTotals) {
    const current = referralBalanceMap.get(row.referrerWallet) ?? {
      referees: new Set<string>(),
      totalAccruedLamports: 0n,
    };
    current.referees.add(row.refereeWallet);
    current.totalAccruedLamports += row._sum.amountLamports ?? 0n;
    referralBalanceMap.set(row.referrerWallet, current);
  }

  const referralBalances = Array.from(referralBalanceMap.entries())
    .map<AdminReferralBalance>(([referrerWallet, totals]) => {
      const paidOutLamports = paidByReferrer.get(referrerWallet) ?? 0n;
      return {
        referrerWallet,
        referredWallets: totals.referees.size,
        totalAccruedLamports: toNumber(totals.totalAccruedLamports),
        paidOutLamports: toNumber(paidOutLamports),
        balanceDueLamports: toNumber(
          totals.totalAccruedLamports - paidOutLamports
        ),
      };
    })
    .sort((left, right) => right.balanceDueLamports - left.balanceDueLamports);

  return {
    authorized,
    lowPairAlert: activePairs < publicSpotrConfig.lowPairAlertThreshold,
    activePairs,
    availablePairs: pairLibrary.filter((pair) => pair.active && !pair.assigned).length,
    liveSessions,
    pendingSessions,
    protocolFeesLamports: toNumber(protocolFees._sum.protocolFeeAccruedLamports),
    pendingReferralLamports: toNumber(referralAccruals._sum.amountLamports),
    assignedRewards,
    claimableRewards,
    recentTransactions: recentTransactions.map((transaction) => ({
      id: transaction.id,
      kind: transaction.kind,
      walletAddress: transaction.walletAddress,
      amountLamports:
        transaction.amountLamports == null ? null : toNumber(transaction.amountLamports),
      createdAtIso: transaction.createdAt.toISOString(),
    })),
    recentRewards: recentRewards.map<RecentReward>((reward) => ({
      id: reward.id,
      walletAddress: reward.walletAddress,
      title: reward.title,
      status: mapRewardStatus(reward.status),
      assignedAtIso: reward.assignedAt.toISOString(),
    })),
    participants: participants.map<AdminParticipant>((participant) => ({
      walletAddress: participant.walletAddress,
      joinedAtIso: participant.joinedAt.toISOString(),
      remainingEscrowLamports: toNumber(participant.remainingEscrowLamports),
      referredByWallet: participant.referredByWallet,
      positionsEntered: participant.positions.length,
    })),
    pairLibrary,
    sessionHistory: sessionsPage.map<AdminSessionCard>((sessionRecord) => ({
      id: sessionRecord.id,
      title: sessionRecord.title,
      status: mapSessionStatus(sessionRecord.status),
      startsAtIso: sessionRecord.startsAt.toISOString(),
      endsAtIso: sessionRecord.endsAt.toISOString(),
      walletsJoined: sessionRecord.joinedWallets,
      totalEscrowLamports: toNumber(sessionRecord.totalEscrowLamports),
      buyInLamports: toNumber(sessionRecord.buyInLamports),
      chainSessionNumber:
        sessionRecord.chainSessionNumber == null
          ? null
          : sessionRecord.chainSessionNumber.toString(),
      chainSessionAddress: sessionRecord.chainSessionAddress ?? null,
      chainDeployTxSignature: sessionRecord.chainDeployTxSignature ?? null,
      createdAtIso: sessionRecord.createdAt.toISOString(),
    })),
    nextSessionsCursor: hasMoreSessions ? encodeListCursor(sessionsSkip + 20) : null,
    referralBalances,
  };
}

async function buildDashboardPayload(
  tx: Tx,
  normalizedWalletAddress?: string | null,
  overrideSessionId?: string | null,
  options?: { skipSync?: boolean }
) {
  const sessionId = overrideSessionId ?? await getPrimarySessionId(tx);
  const session = options?.skipSync
    ? await loadSessionWithRounds(tx, sessionId)
    : await syncSessionState(tx, sessionId);
  const now = new Date();

  const participant = normalizedWalletAddress
    ? await tx.sessionParticipant.findUnique({
        where: {
          sessionId_walletAddress: {
            sessionId: session.id,
            walletAddress: normalizedWalletAddress,
          },
        },
      })
    : null;

  const walletPositions = participant
    ? await tx.roundPosition.findMany({
        where: { participantId: participant.id },
      })
    : [];
  const positionByRoundId = new Map(
    walletPositions.map((position) => [position.roundId, position])
  );

  const walletDeposits = participant
    ? await tx.roundDeposit.findMany({
        where: { participantId: participant.id },
      })
    : [];
  const depositByRoundId = new Map(
    walletDeposits.map((deposit) => [deposit.roundId, deposit])
  );

  // Fetch the first 7 depositors per round for the wait-screen player feed.
  // Uses a LATERAL join so we touch O(rounds × 7) rows instead of every
  // deposit. Backed by the (roundId, depositedAt) composite index.
  const roundIds = session.rounds.map((r) => r.id);
  const earliestDeposits = roundIds.length
    ? await tx.$queryRaw<Array<{ roundId: string; walletAddress: string }>>`
        SELECT d."roundId", d."walletAddress"
        FROM "SessionRound" r
        JOIN LATERAL (
          SELECT "roundId", "walletAddress", "depositedAt"
          FROM "RoundDeposit"
          WHERE "roundId" = r.id
          ORDER BY "depositedAt" ASC
          LIMIT 7
        ) d ON TRUE
        WHERE r.id = ANY(${roundIds}::text[])
      `
    : [];
  const depositorsByRoundId = new Map<string, string[]>();
  for (const d of earliestDeposits) {
    const list = depositorsByRoundId.get(d.roundId) ?? [];
    list.push(d.walletAddress);
    depositorsByRoundId.set(d.roundId, list);
  }

  const rounds: SessionRoundSummary[] = session.rounds.map((round) => {
    const timeStatus = deriveRoundStatus(
      session.status,
      round.opensAt,
      round.closesAt,
      now
    );
    // Rounds open via deposit threshold, not by time — preserve the DB
    // UPCOMING status until recordRoundDeposit flips it to OPEN.
    const derivedStatus =
      timeStatus === "OPEN" && round.status === "UPCOMING" ? "UPCOMING" : timeStatus;
    const probabilities = getProbabilities(
      round.sideATotalNetLamports,
      round.sideBTotalNetLamports,
      round.sideAProbabilityPct,
      round.sideBProbabilityPct
    );
    const position = positionByRoundId.get(round.id);
    const claimableLamports =
      position && derivedStatus === "CLOSED"
        ? derivePositionClaimableLamports(round, position)
        : 0n;
    const deposit = depositByRoundId.get(round.id);

    return {
      id: round.id,
      index: round.roundIndex,
      pairId: round.pairId,
      lockedSide:
        position?.side === PositionSide.A
          ? "A"
          : position?.side === PositionSide.B
            ? "B"
            : undefined,
      status: mapRoundStatus(derivedStatus),
      opensAtIso: round.opensAt?.toISOString() ?? null,
      closesAtIso: round.closesAt?.toISOString() ?? null,
      sideAProbabilityPct: probabilities.sideA,
      sideBProbabilityPct: probabilities.sideB,
      sideATotalEntries: round.sideATotalEntries,
      sideBTotalEntries: round.sideBTotalEntries,
      stakeLamports: position ? toNumber(position.stakeLamports) : null,
      claimableLamports: toNumber(claimableLamports),
      claimedLamports: position ? toNumber(position.claimedLamports) : 0,
      walletsDepositedForRound: round.depositsCount,
      depositorAddresses: depositorsByRoundId.get(round.id) ?? [],
      depositLamports: deposit ? toNumber(deposit.amountLamports) : null,
      depositRefunded: deposit?.refundedAt != null,
    };
  });

  const faultLines: FaultLinePair[] = session.rounds.map((round) => {
    const probabilities = getProbabilities(
      round.sideATotalNetLamports,
      round.sideBTotalNetLamports,
      round.sideAProbabilityPct,
      round.sideBProbabilityPct
    );

    return {
      id: round.pair.slug,
      roundId: round.id,
      roundIndex: round.roundIndex,
      category: round.pair.category,
      sideA: round.pair.sideA,
      sideB: round.pair.sideB,
      sideAPct: probabilities.sideA,
      sideBPct: probabilities.sideB,
      crowdLabel: round.pair.crowdLabel,
    };
  });

  const currentRound =
    rounds.find((round) => round.status === "open") ??
    rounds.find((round) => round.status === "upcoming") ??
    null;

  const availableSessionRows = await tx.session.findMany({
    where: { status: { in: ["PENDING", "LIVE"] } },
    orderBy: [{ status: "asc" }, { startsAt: "asc" }],
    take: 50,
  });
  const availableSessions: AdminSessionCard[] = availableSessionRows.map((row) => ({
    id: row.id,
    title: row.title,
    status: mapSessionStatus(row.status),
    startsAtIso: row.startsAt.toISOString(),
    endsAtIso: row.endsAt.toISOString(),
    walletsJoined: row.joinedWallets,
    totalEscrowLamports: toNumber(row.totalEscrowLamports),
    buyInLamports: toNumber(row.buyInLamports),
    chainSessionNumber:
      row.chainSessionNumber == null ? null : row.chainSessionNumber.toString(),
    chainSessionAddress: row.chainSessionAddress ?? null,
    chainDeployTxSignature: row.chainDeployTxSignature ?? null,
    createdAtIso: row.createdAt.toISOString(),
  }));

  return {
    session: {
      id: session.id,
      title: session.title,
      status: mapSessionStatus(session.status),
      walletsJoined: session.joinedWallets,
      totalEscrowLamports: toNumber(session.totalEscrowLamports),
      protocolFeeAccruedLamports: toNumber(session.protocolFeeAccruedLamports),
      startsAtIso: session.startsAt.toISOString(),
      endsAtIso: session.endsAt.toISOString(),
      activatedAtIso: session.activatedAt?.toISOString() ?? null,
      referralCutBps: session.referralCutBps,
      rounds,
      joined: participant != null,
      remainingEscrowLamports:
        participant == null ? null : toNumber(participant.remainingEscrowLamports),
      claimableSessionBalanceLamports:
        participant != null && isSessionSettled(session.status)
          ? toNumber(participant.remainingEscrowLamports)
          : 0,
      currentRoundId: currentRound?.id ?? null,
      currentRoundIndex: currentRound?.index ?? null,
      chainSessionNumber:
        session.chainSessionNumber == null
          ? null
          : session.chainSessionNumber.toString(),
      chainSessionAddress: session.chainSessionAddress ?? null,
      participant: participant
        ? { joinedAtIso: participant.joinedAt.toISOString() }
        : null,
    },
    profile: normalizedWalletAddress
      ? await buildProfileSummary(tx, normalizedWalletAddress, now)
      : null,
    admin: await buildAdminSummary(tx, session.id, normalizedWalletAddress),
    availableSessions,
    faultLines,
  } satisfies SpotrDashboardPayload;
}

function assertAdminWallet(walletAddress: string) {
  if (!serverSpotrConfig.adminWallets.includes(walletAddress)) {
    throw new Error("This wallet is not configured for SPOTR admin actions.");
  }
}

function parseRewardKind(kind: string) {
  switch (kind) {
    case "merch":
      return RewardKind.MERCH;
    case "gift-card":
      return RewardKind.GIFT_CARD;
    case "voucher":
      return RewardKind.VOUCHER;
    case "nft":
      return RewardKind.NFT;
    default:
      throw new Error("Reward kind must be one of nft, merch, gift-card, or voucher.");
  }
}

function parseRewardStatus(status: string) {
  switch (status) {
    case "assigned":
      return RewardStatus.ASSIGNED;
    case "claimable":
      return RewardStatus.CLAIMABLE;
    case "claimed":
      return RewardStatus.CLAIMED;
    default:
      throw new Error("Reward status must be assigned, claimable, or claimed.");
  }
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseOptionalInteger(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer value in pair CSV: ${value}`);
  }
  return parsed;
}

function parsePairCsv(csv: string) {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);

  if (rows.length === 0) {
    throw new Error("Pair CSV is empty.");
  }

  const normalizedHeader = rows[0].map((cell) =>
    cell.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  );
  const hasHeader =
    normalizedHeader.includes("category") &&
    (normalizedHeader.includes("side_a") || normalizedHeader.includes("sidea")) &&
    (normalizedHeader.includes("side_b") || normalizedHeader.includes("sideb"));

  const header = hasHeader ? normalizedHeader : ["id", "category", "side_a", "side_b"];
  const bodyRows = hasHeader ? rows.slice(1) : rows;
  if (bodyRows.length === 0) {
    throw new Error("Pair CSV does not contain any data rows.");
  }

  const getColumnIndex = (...aliases: string[]) =>
    header.findIndex((column) => aliases.includes(column));

  const idIndex = getColumnIndex("id", "slug");
  const categoryIndex = getColumnIndex("category");
  const sideAIndex = getColumnIndex("side_a", "sidea");
  const sideBIndex = getColumnIndex("side_b", "sideb");
  const sideAPctIndex = getColumnIndex("side_a_pct", "side_a_probability_pct");
  const sideBPctIndex = getColumnIndex("side_b_pct", "side_b_probability_pct");
  const crowdLabelIndex = getColumnIndex("crowd_label");

  if (categoryIndex < 0 || sideAIndex < 0 || sideBIndex < 0) {
    throw new Error("Pair CSV must contain category, side_a, and side_b columns.");
  }

  return bodyRows.map((row, index) => {
    const category = row[categoryIndex]?.trim();
    const sideA = row[sideAIndex]?.trim();
    const sideB = row[sideBIndex]?.trim();
    if (!category || !sideA || !sideB) {
      throw new Error(`Pair CSV row ${index + 1} is missing required values.`);
    }

    const sideAPct = parseOptionalInteger(
      sideAPctIndex >= 0 ? row[sideAPctIndex] : undefined
    );
    const sideBPct = parseOptionalInteger(
      sideBPctIndex >= 0 ? row[sideBPctIndex] : undefined
    );

    return {
      slug:
        row[idIndex]?.trim() ||
        slugify(`${category}-${sideA.slice(0, 24)}-${sideB.slice(0, 24)}`),
      category,
      sideA,
      sideB,
      sideAPct: sideAPct ?? 50,
      sideBPct: sideBPct ?? 50,
      crowdLabel:
        (crowdLabelIndex >= 0 ? row[crowdLabelIndex]?.trim() : undefined) ||
        getDefaultCrowdLabel(),
    };
  });
}

async function resolveParticipantReferrerWallet(
  tx: Tx,
  walletAddress: string,
  requestedReferrerWallet?: string | null
) {
  const existingRelationship = await tx.referralRelationship.findUnique({
    where: { refereeWallet: walletAddress },
  });
  if (existingRelationship) {
    return existingRelationship.referrerWallet;
  }

  const requestedReferrer = normalizeWalletAddress(requestedReferrerWallet);
  if (!requestedReferrer || requestedReferrer === walletAddress) {
    return null;
  }

  return requestedReferrer;
}

async function ensureReferralRelationship(
  tx: Tx,
  participant: Prisma.SessionParticipantGetPayload<object>
) {
  if (
    !participant.referredByWallet ||
    participant.referredByWallet === participant.walletAddress
  ) {
    return null;
  }

  const existingRelationship = await tx.referralRelationship.findUnique({
    where: { refereeWallet: participant.walletAddress },
  });
  if (existingRelationship) {
    return existingRelationship;
  }

  return tx.referralRelationship.create({
    data: {
      referrerWallet: participant.referredByWallet,
      refereeWallet: participant.walletAddress,
      sourceSessionId: participant.sessionId,
    },
  });
}

async function getEligibleReferralShareLamports(
  tx: Tx,
  session: SessionWithRounds,
  participant: Prisma.SessionParticipantGetPayload<object>,
  feeLamports: bigint
) {
  if (!participant.referredByWallet) {
    return 0n;
  }

  const referrerPaidSessions = await tx.sessionParticipant.count({
    where: {
      walletAddress: participant.referredByWallet,
      positions: {
        some: {},
      },
      session: {
        status: "COMPLETED",
      },
    },
  });
  if (referrerPaidSessions < publicSpotrConfig.minPaidSessionsForReferral) {
    return 0n;
  }

  return (feeLamports * BigInt(session.referralCutBps)) / 10_000n;
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  const id = sessionId?.trim();
  if (!id) return false;
  const row = await prisma.session.findUnique({
    where: { id },
    select: { id: true },
  });
  return row != null;
}

export async function getSpotrDashboardPayload(walletAddress?: string | null, sessionId?: string | null) {
  await syncFaultLineSeeds();
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  // If a sessionId is passed but the row no longer exists (e.g. a stale tab
  // after a DB reset), fall back to the primary session instead of letting
  // Prisma's findUniqueOrThrow surface as a 500.
  const requestedSessionId = sessionId?.trim() ? sessionId.trim() : null;
  const sessionStillExists = requestedSessionId
    ? await sessionExists(requestedSessionId)
    : false;
  const resolvedSessionId =
    sessionStillExists && requestedSessionId
      ? requestedSessionId
      : await getPrimarySessionId(prisma);
  // Write-side state advance runs in its own tx; bumping `maxWait` because
  // the hosted Prisma Postgres connection pool is small and the read-side
  // payload below also pulls connections — the default 2s `maxWait` causes
  // P2028 ("Unable to start a transaction in the given time") under load.
  await prisma.$transaction(
    (tx) => syncSessionState(tx, resolvedSessionId),
    { timeout: 15_000, maxWait: 10_000 }
  );
  return buildDashboardPayload(prisma, normalizedWallet, resolvedSessionId, {
    skipSync: true,
  });
}

export async function joinSpotrSession(input: {
  walletAddress: string;
  referrerWallet?: string | null;
  chainTxSignature: string;
  sessionId?: string | null;
  actor?: "player" | "bot";
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to join the session.");
  }
  if (!input.chainTxSignature) {
    throw new Error("A confirmed on-chain transaction signature is required.");
  }

  const sessionId = input.sessionId?.trim()
    ? input.sessionId.trim()
    : await getPrimarySessionId(prisma);
  const sessionForChain = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      chainSessionNumber: true,
      chainSessionAddress: true,
    },
  });
  if (
    !sessionForChain ||
    sessionForChain.chainSessionNumber == null ||
    !sessionForChain.chainSessionAddress
  ) {
    throw new Error(
      "This session has not been deployed on-chain yet. Ask an admin to deploy it before joining."
    );
  }

  const sessionNumber = BigInt(sessionForChain.chainSessionNumber.toString());
  const alreadyJoined = input.chainTxSignature === "already-joined";

  const { verifyJoinSessionTx, verifyPlayerSessionExists } = await import("./chain-verifier");

  let verifiedSessionAddress: string;
  let verifiedPlayerSessionAddress: string;
  let verifiedSlot: number | null = null;

  if (alreadyJoined) {
    const result = await verifyPlayerSessionExists({
      cluster: publicSpotrConfig.cluster,
      expectedPlayer: walletAddress,
      expectedSessionNumber: sessionNumber,
    });
    verifiedSessionAddress = result.sessionAddress;
    verifiedPlayerSessionAddress = result.playerSessionAddress;
  } else {
    const result = await verifyJoinSessionTx({
      cluster: publicSpotrConfig.cluster,
      signature: input.chainTxSignature,
      expectedPlayer: walletAddress,
      expectedSessionNumber: sessionNumber,
    });
    verifiedSessionAddress = result.sessionAddress;
    verifiedPlayerSessionAddress = result.playerSessionAddress;
    verifiedSlot = result.slot;
  }

  const chainPersistence = getJoinChainPersistence({
    chainTxSignature: input.chainTxSignature,
    playerSessionAddress: verifiedPlayerSessionAddress,
  });

  if (verifiedSessionAddress !== sessionForChain.chainSessionAddress) {
    throw new Error(
      "On-chain session PDA does not match the deployed session record."
    );
  }

  await syncFaultLineSeeds();
  await prisma.$transaction(async (tx) => {
    const session = await syncSessionState(tx, sessionId);

    const now = new Date();

    if (session.status === "EXPIRED" || session.status === "COMPLETED") {
      throw new Error("This session is not joinable anymore.");
    }
    if (now < session.startsAt) {
      throw new Error("This session has not started yet.");
    }
    if (now > session.endsAt) {
      throw new Error("The session window has already closed.");
    }

    const existingParticipant = await tx.sessionParticipant.findUnique({
      where: {
        sessionId_walletAddress: {
          sessionId: session.id,
          walletAddress,
        },
      },
    });

    if (existingParticipant) {
      if (
        existingParticipant.chainJoinTxSignature &&
        !alreadyJoined &&
        existingParticipant.chainJoinTxSignature !== input.chainTxSignature
      ) {
        throw new Error(
          "This wallet has already joined with a different on-chain transaction."
        );
      }
      if (
        existingParticipant.chainJoinTxSignature !== chainPersistence.chainJoinTxSignature ||
        existingParticipant.chainPlayerSessionAddress !==
          chainPersistence.chainPlayerSessionAddress
      ) {
        await tx.sessionParticipant.update({
          where: { id: existingParticipant.id },
          data: chainPersistence,
        });
      }
    } else {
      const referredByWallet = await resolveParticipantReferrerWallet(
        tx,
        walletAddress,
        input.referrerWallet
      );

      await tx.sessionParticipant.create({
        data: {
          sessionId: session.id,
          walletAddress,
          totalEscrowLamports: session.buyInLamports,
          remainingEscrowLamports: session.buyInLamports,
          referredByWallet,
          ...chainPersistence,
        },
      });

      await tx.transactionLog.create({
        data: {
          sessionId: session.id,
          walletAddress,
          kind: "join_session",
          amountLamports: session.buyInLamports,
          metadataJson: JSON.stringify({
            referralCutBps: session.referralCutBps,
            chainTxSignature: chainPersistence.chainJoinTxSignature,
            chainPlayerSessionAddress: chainPersistence.chainPlayerSessionAddress,
            chainSlot: verifiedSlot,
            botFill: input.actor === "bot",
          }),
        },
      });
    }
  }, { timeout: 30_000 });

  return getSpotrDashboardPayload(walletAddress, sessionId);
}

export async function enterSpotrRoundPosition(input: {
  walletAddress: string;
  roundId: string;
  side: SpotrSide;
  chainTxSignature: string;
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to enter a round.");
  }
  if (input.side !== "A" && input.side !== "B") {
    throw new Error("Side must be either A or B.");
  }

  await prisma.$transaction(async (tx) => {
    const sessionId = await getPrimarySessionId(tx);
    const session = await syncSessionState(tx, sessionId);
    if (session.status !== "LIVE") {
      throw new Error("The session is not live yet.");
    }

    const round = session.rounds.find((candidate) => candidate.id === input.roundId);
    if (!round) {
      throw new Error("Round not found.");
    }

    const currentRoundStatus = deriveRoundStatus(
      session.status,
      round.opensAt,
      round.closesAt,
      new Date()
    );
    if (currentRoundStatus !== "OPEN") {
      throw new Error("This round is not open for entries.");
    }

    const participant = await tx.sessionParticipant.findUnique({
      where: {
        sessionId_walletAddress: {
          sessionId: session.id,
          walletAddress,
        },
      },
    });
    if (!participant) {
      throw new Error("Join the session before entering a position.");
    }

    const existingPosition = await tx.roundPosition.findFirst({
      where: {
        roundId: round.id,
        participantId: participant.id,
      },
    });
    if (existingPosition) {
      throw new Error("You already entered this round.");
    }

    // Wager comes from the player's RoundDeposit (committed during the
    // wait phase). The on-chain `enter_position` reads from the same PDA;
    // we consume that ticket here.
    const deposit = await tx.roundDeposit.findUnique({
      where: {
        roundId_participantId: {
          roundId: round.id,
          participantId: participant.id,
        },
      },
    });
    if (!deposit) {
      throw new Error("Deposit for this round not found.");
    }
    if (deposit.usedAt || deposit.refundedAt) {
      throw new Error("This deposit has already been consumed or refunded.");
    }

    const referralRelationship = await ensureReferralRelationship(tx, participant);

    const stakeLamports = deposit.amountLamports;
    const feeLamports = (stakeLamports * BigInt(session.protocolFeeBps)) / 10_000n;
    const referralShareLamports = await getEligibleReferralShareLamports(
      tx,
      session,
      participant,
      feeLamports
    );
    const protocolFeeNetLamports = feeLamports - referralShareLamports;
    const netStakeLamports = stakeLamports - feeLamports;

    const sideFields =
      input.side === "A"
        ? {
            totalEntries: round.sideATotalEntries,
            totalShares: round.sideATotalShares,
            totalNetLamports: round.sideATotalNetLamports,
            rewardPerShare: round.sideARewardPerShare,
          }
        : {
            totalEntries: round.sideBTotalEntries,
            totalShares: round.sideBTotalShares,
            totalNetLamports: round.sideBTotalNetLamports,
            rewardPerShare: round.sideBRewardPerShare,
          };

    const rewardIncrement =
      sideFields.totalShares === 0n
        ? 0n
        : (netStakeLamports * REWARD_SCALE) / sideFields.totalShares;
    const rewardPerShare = sideFields.rewardPerShare + rewardIncrement;
    const shares = netStakeLamports;
    const rewardDebtLamports = (shares * rewardPerShare) / REWARD_SCALE;

    await tx.roundPosition.create({
      data: {
        roundId: round.id,
        participantId: participant.id,
        walletAddress,
        side: input.side === "A" ? PositionSide.A : PositionSide.B,
        stakeLamports,
        feeLamports,
        netStakeLamports,
        shares,
        rewardDebtLamports,
      },
    });

    await tx.roundDeposit.update({
      where: { id: deposit.id },
      data: { usedAt: new Date() },
    });

    await tx.session.update({
      where: { id: session.id },
      data: {
        protocolFeeAccruedLamports:
          session.protocolFeeAccruedLamports + protocolFeeNetLamports,
      },
    });

    await tx.sessionRound.update({
      where: { id: round.id },
      data:
        input.side === "A"
          ? {
              sideATotalEntries: round.sideATotalEntries + 1,
              sideATotalShares: round.sideATotalShares + shares,
              sideATotalNetLamports: round.sideATotalNetLamports + netStakeLamports,
              sideARewardPerShare: rewardPerShare,
              totalVolumeLamports: round.totalVolumeLamports + stakeLamports,
            }
          : {
              sideBTotalEntries: round.sideBTotalEntries + 1,
              sideBTotalShares: round.sideBTotalShares + shares,
              sideBTotalNetLamports: round.sideBTotalNetLamports + netStakeLamports,
              sideBRewardPerShare: rewardPerShare,
              totalVolumeLamports: round.totalVolumeLamports + stakeLamports,
            },
    });

    if (referralShareLamports > 0n && participant.referredByWallet) {
      await tx.referralAccrual.create({
        data: {
          sessionId: session.id,
          roundId: round.id,
          relationshipId: referralRelationship?.id,
          referrerWallet: participant.referredByWallet,
          refereeWallet: walletAddress,
          amountLamports: referralShareLamports,
          status: ReferralStatus.CLAIMABLE,
          claimableAt: new Date(),
        },
      });

      await tx.transactionLog.create({
        data: {
          sessionId: session.id,
          walletAddress: participant.referredByWallet,
          kind: "accrue_referral_fee",
          amountLamports: referralShareLamports,
          metadataJson: JSON.stringify({
            refereeWallet: walletAddress,
            roundId: round.id,
          }),
        },
      });
    }

    await tx.transactionLog.create({
      data: {
        sessionId: session.id,
        walletAddress,
        kind: input.side === "A" ? "enter_position_a" : "enter_position_b",
        amountLamports: stakeLamports,
        metadataJson: JSON.stringify({
          roundId: round.id,
          feeLamports: feeLamports.toString(),
          protocolFeeNetLamports: protocolFeeNetLamports.toString(),
          referralShareLamports: referralShareLamports.toString(),
          netStakeLamports: netStakeLamports.toString(),
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(walletAddress);
}

/**
 * Record a `deposit_for_round` ticket in the DB once the on-chain instruction
 * has succeeded. Returns the refreshed dashboard payload so the caller can
 * round-trip it back to the client.
 */
export async function recordRoundDeposit(input: {
  walletAddress: string;
  roundId: string;
  amountLamports: bigint;
  chainTxSignature?: string | null;
  actor?: "player" | "bot";
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to record a round deposit.");
  }
  if (input.amountLamports <= 0n) {
    throw new Error("Deposit amount must be positive.");
  }

  const depositSummary = await prisma.$transaction(async (tx) => {
    const round = await tx.sessionRound.findUnique({
      where: { id: input.roundId },
      include: { session: true },
    });
    if (!round) throw new Error("Round not found.");
    const session = await syncSessionState(tx, round.sessionId);
    if (session.status !== "LIVE") {
      throw new Error("The session is not live yet.");
    }

    const participant = await tx.sessionParticipant.findUnique({
      where: {
        sessionId_walletAddress: {
          sessionId: session.id,
          walletAddress,
        },
      },
    });
    if (!participant) {
      throw new Error("Join the session before depositing into a round.");
    }

    const existing = await tx.roundDeposit.findUnique({
      where: {
        roundId_participantId: {
          roundId: round.id,
          participantId: participant.id,
        },
      },
    });
    if (existing) {
      throw new Error("You have already deposited for this round.");
    }

    await tx.roundDeposit.create({
      data: {
        roundId: round.id,
        participantId: participant.id,
        walletAddress,
        amountLamports: input.amountLamports,
        chainDepositTx: input.chainTxSignature ?? null,
      },
    });

    const newCount = round.depositsCount + 1;
    const newPool = round.depositPoolLamports + input.amountLamports;
    const fillThreshold = session.roundFillThreshold;
    const shouldOpen = newCount >= fillThreshold;
    const statusAfter = shouldOpen ? RoundStatus.OPEN : round.status;

    await tx.sessionRound.update({
      where: { id: round.id },
      data: {
        depositsCount: newCount,
        depositPoolLamports: newPool,
        // Stamp the actual flip moment so the client-side countdown
        // (`opensAt + roundDurationSeconds - now`) starts a fresh window.
        // We must overwrite any pre-existing `opensAt` (which `syncSessionState`
        // seeds to `activatedAt` for the late-deposit gate) — keeping that
        // stale value would make countdown 0 immediately on flip.
        ...(shouldOpen
          ? { status: RoundStatus.OPEN, opensAt: new Date() }
          : {}),
      },
    });

    await tx.transactionLog.create({
      data: {
        sessionId: session.id,
        walletAddress,
        kind: "deposit_for_round",
        amountLamports: input.amountLamports,
        metadataJson: JSON.stringify({
          roundId: round.id,
          newCount,
          fillThreshold,
          botFill: input.actor === "bot",
        }),
      },
    });
    return {
      roundId: round.id,
      sessionId: session.id,
      previousStatus: round.status,
      statusAfter,
      previousDepositsCount: round.depositsCount,
      newDepositsCount: newCount,
      fillThreshold,
    };
  }, { timeout: 15_000 });

  return {
    payload: await getSpotrDashboardPayload(walletAddress),
    summary: depositSummary,
  };
}

/**
 * Refund a deposit for a round that closed without filling (or where the
 * player never picked a side). Mirrors the on-chain `refund_unused_deposit`
 * instruction.
 */
export async function refundUnusedSpotrDeposit(input: {
  walletAddress: string;
  roundId: string;
  chainTxSignature?: string | null;
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to refund a deposit.");
  }

  await prisma.$transaction(async (tx) => {
    const round = await tx.sessionRound.findUnique({
      where: { id: input.roundId },
    });
    if (!round) throw new Error("Round not found.");
    if (round.status !== RoundStatus.CLOSED) {
      throw new Error("The round is still open.");
    }

    const participant = await tx.sessionParticipant.findUnique({
      where: {
        sessionId_walletAddress: {
          sessionId: round.sessionId,
          walletAddress,
        },
      },
    });
    if (!participant) throw new Error("No session participation found.");

    const deposit = await tx.roundDeposit.findUnique({
      where: {
        roundId_participantId: {
          roundId: round.id,
          participantId: participant.id,
        },
      },
    });
    if (!deposit) throw new Error("No deposit to refund.");
    if (deposit.refundedAt) throw new Error("This deposit has already been refunded.");
    if (deposit.usedAt) throw new Error("This deposit was already consumed by a position.");

    await tx.roundDeposit.update({
      where: { id: deposit.id },
      data: {
        refundedAt: new Date(),
        chainRefundTx: input.chainTxSignature ?? null,
      },
    });

    await tx.transactionLog.create({
      data: {
        sessionId: round.sessionId,
        walletAddress,
        kind: "refund_unused_deposit",
        amountLamports: deposit.amountLamports,
        metadataJson: JSON.stringify({ roundId: round.id }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(walletAddress);
}

/**
 * Record the on-chain `resolve_round` outcome in the DB. Captures
 * `winningSide`, computes `totalPoolLamports`, and sets the audit trail.
 * Pure DB write — the on-chain ix has already been signed by the admin.
 */
export async function recordChainResolveRound(input: {
  adminWalletAddress: string;
  sessionId: string;
  roundId: string;
  winningSide: "A" | "B";
  chainTxSignature: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  return prisma.$transaction(async (tx) => {
    const round = await tx.sessionRound.findUnique({
      where: { id: input.roundId },
      include: { session: true },
    });
    if (!round) throw new Error("Round not found.");
    if (round.sessionId !== input.sessionId) {
      throw new Error("roundId does not belong to sessionId.");
    }
    if (round.winningSide) {
      throw new Error("This round is already resolved.");
    }
    const totalPool =
      round.sideATotalNetLamports + round.sideBTotalNetLamports;
    await tx.sessionRound.update({
      where: { id: round.id },
      data: {
        winningSide: input.winningSide === "A" ? PositionSide.A : PositionSide.B,
        totalPoolLamports: totalPool,
      },
    });
    await tx.transactionLog.create({
      data: {
        sessionId: round.sessionId,
        walletAddress: input.adminWalletAddress,
        kind: "admin_resolve_round",
        amountLamports: null,
        metadataJson: JSON.stringify({
          roundId: round.id,
          winningSide: input.winningSide,
          chainTxSignature: input.chainTxSignature,
        }),
      },
    });
  }, { timeout: 15_000 });
}

/**
 * Server-driven settlement: sponsor wallet signs `settle_round` with all
 * winning positions as remaining_accounts, then mirrors the redistributed
 * payouts into RoundPosition.finalPayoutLamports so claim_round + the
 * dashboard payload have a single source of truth.
 *
 * Returns the on-chain transaction signature.
 */
export async function executeSpotrSettleRound(_input: {
  adminWalletAddress: string;
  sessionId: string;
  roundId: string;
}): Promise<{ chainTxSignature: string }> {
  // The actual chain submission lives in the API route handler so it can
  // share the same `loadSponsorSigner` / `submitSponsoredTx` helpers as the
  // other on-chain admin endpoints. The route calls this DB-update helper
  // *after* the chain ix succeeds. Implementation in
  // `app/api/admin/rounds/settle/route.ts`.
  throw new Error("executeSpotrSettleRound is implemented inline in the settle route");
}

/**
 * After the on-chain `settle_round` succeeds, mirror the per-position
 * `final_payout_usdc_units` values into the DB so the UI / dashboard /
 * claim path read from a single source of truth. Caller passes the same
 * ordered `[positionAddress, finalPayoutLamports]` tuples that were in the
 * on-chain ix, computed in TS via the redistribute() pure function.
 */
export async function recordChainSettleRound(input: {
  adminWalletAddress: string;
  sessionId: string;
  roundId: string;
  finalPayouts: { positionId: string; finalPayoutLamports: bigint }[];
  chainTxSignature: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  return prisma.$transaction(async (tx) => {
    const round = await tx.sessionRound.findUnique({
      where: { id: input.roundId },
    });
    if (!round) throw new Error("Round not found.");
    if (!round.winningSide) {
      throw new Error("Round must be resolved before settling.");
    }
    if (round.redistributeApplied) {
      throw new Error("This round has already been settled.");
    }
    for (const { positionId, finalPayoutLamports } of input.finalPayouts) {
      await tx.roundPosition.update({
        where: { id: positionId },
        data: { finalPayoutLamports },
      });
    }
    await tx.sessionRound.update({
      where: { id: round.id },
      data: { redistributeApplied: true, settledAt: new Date() },
    });
    await tx.transactionLog.create({
      data: {
        sessionId: round.sessionId,
        walletAddress: input.adminWalletAddress,
        kind: "admin_settle_round",
        amountLamports: null,
        metadataJson: JSON.stringify({
          roundId: round.id,
          chainTxSignature: input.chainTxSignature,
          positionCount: input.finalPayouts.length,
        }),
      },
    });
  }, { timeout: 15_000 });
}


export async function claimSpotrRoundProceeds(input: { walletAddress: string }) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to claim round proceeds.");
  }

  await prisma.$transaction(async (tx) => {
    const sessionId = await getPrimarySessionId(tx);
    await syncSessionState(tx, sessionId);
    const now = new Date();

    const positions = await tx.roundPosition.findMany({
      where: { walletAddress },
      include: {
        round: {
          include: {
            session: true,
          },
        },
      },
    });

    let totalClaimedLamports = 0n;
    const claimedRoundIds: string[] = [];

    for (const position of positions) {
      const roundStatus = deriveRoundStatus(
        position.round.session.status,
        position.round.opensAt,
        position.round.closesAt,
        now
      );
      if (roundStatus !== "CLOSED") {
        continue;
      }

      const pending = derivePositionClaimableLamports(position.round, position);
      if (pending <= 0n) {
        continue;
      }

      await tx.roundPosition.update({
        where: { id: position.id },
        data: {
          claimedLamports: position.claimedLamports + pending,
          claimedAt: now,
        },
      });

      totalClaimedLamports += pending;
      claimedRoundIds.push(position.roundId);
    }

    if (totalClaimedLamports <= 0n) {
      throw new Error("No round proceeds are claimable right now.");
    }

    await tx.transactionLog.create({
      data: {
        walletAddress,
        kind: "claim_round_proceeds",
        amountLamports: totalClaimedLamports,
        metadataJson: JSON.stringify({
          roundIds: claimedRoundIds,
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(walletAddress);
}

export async function claimSpotrSessionBalance(input: { walletAddress: string }) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to claim session balance.");
  }

  await prisma.$transaction(async (tx) => {
    const sessionId = await getPrimarySessionId(tx);
    await syncSessionState(tx, sessionId);

    const participants = await tx.sessionParticipant.findMany({
      where: { walletAddress },
      include: { session: true },
    });

    let totalClaimedLamports = 0n;
    const sessionIds: string[] = [];

    for (const participant of participants) {
      if (!isSessionSettled(participant.session.status)) {
        continue;
      }
      if (participant.remainingEscrowLamports <= 0n) {
        continue;
      }

      totalClaimedLamports += participant.remainingEscrowLamports;
      sessionIds.push(participant.sessionId);

      await tx.sessionParticipant.update({
        where: { id: participant.id },
        data: {
          remainingEscrowLamports: 0n,
        },
      });
    }

    if (totalClaimedLamports <= 0n) {
      throw new Error("No session balance is claimable right now.");
    }

    await tx.transactionLog.create({
      data: {
        walletAddress,
        kind: "claim_session_balance",
        amountLamports: totalClaimedLamports,
        metadataJson: JSON.stringify({
          sessionIds,
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(walletAddress);
}

export async function importAdminPairs(input: {
  adminWalletAddress: string;
  csv: string;
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const csv = input.csv.trim();

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (!csv) {
    throw new Error("Pair CSV content is required.");
  }

  await prisma.$transaction(async (tx) => {
    assertAdminWallet(adminWalletAddress);

    const rows = parsePairCsv(csv);
    for (const row of rows) {
      await tx.faultLinePair.upsert({
        where: { slug: row.slug },
        update: {
          category: row.category,
          sideA: row.sideA,
          sideB: row.sideB,
          defaultSideAPct: row.sideAPct,
          defaultSideBPct: row.sideBPct,
          crowdLabel: row.crowdLabel,
          active: true,
        },
        create: {
          slug: row.slug,
          category: row.category,
          sideA: row.sideA,
          sideB: row.sideB,
          defaultSideAPct: row.sideAPct,
          defaultSideBPct: row.sideBPct,
          crowdLabel: row.crowdLabel,
          active: true,
        },
      });
    }

    await tx.transactionLog.create({
      data: {
        walletAddress: adminWalletAddress,
        kind: "admin_import_pairs",
        metadataJson: JSON.stringify({
          rows: rows.length,
          payloadSnapshot: {
            csvLength: csv.length,
          },
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(adminWalletAddress);
}

export async function updateAdminPairState(input: {
  adminWalletAddress: string;
  pairId: string;
  active: boolean;
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const pairId = input.pairId.trim();

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (!pairId) {
    throw new Error("A pair id is required.");
  }

  await prisma.$transaction(async (tx) => {
    assertAdminWallet(adminWalletAddress);

    const pair = await tx.faultLinePair.findUnique({
      where: { id: pairId },
    });
    if (!pair) {
      throw new Error("Pair not found.");
    }

    await tx.faultLinePair.update({
      where: { id: pairId },
      data: { active: input.active },
    });

    await tx.transactionLog.create({
      data: {
        walletAddress: adminWalletAddress,
        kind: input.active ? "admin_activate_pair" : "admin_deactivate_pair",
        metadataJson: JSON.stringify({
          pairId,
          slug: pair.slug,
          payloadSnapshot: { pairId, active: input.active },
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(adminWalletAddress);
}

export async function deployAdminSessionWithChain(input: {
  adminWalletAddress: string;
  title?: string | null;
  pairIds: string[];
  startsAtIso: string;
  endsAtIso: string;
  buyInLamports?: number | null;
  cardPackItems?: Array<{
    kind: RewardInventoryItem["kind"];
    title: string;
    subtitle: string;
  }>;
  chainTxSignature: string;
  chainSessionNumber: string;
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const title = input.title?.trim() ?? "";
  const pairIds = Array.from(
    new Set(input.pairIds.map((pairId) => pairId.trim()).filter(Boolean))
  );
  const chainTxSignature = input.chainTxSignature.trim();
  const chainSessionNumberStr = input.chainSessionNumber.trim();

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (pairIds.length !== publicSpotrConfig.roundCount) {
    throw new Error(
      `Select exactly ${publicSpotrConfig.roundCount} active pairs for a session.`
    );
  }
  if (!chainTxSignature) {
    throw new Error("chainTxSignature is required.");
  }
  if (!chainSessionNumberStr) {
    throw new Error("chainSessionNumber is required.");
  }

  let chainSessionNumber: bigint;
  try {
    chainSessionNumber = BigInt(chainSessionNumberStr);
  } catch {
    throw new Error("chainSessionNumber must be a u64-compatible integer.");
  }
  if (chainSessionNumber <= 0n) {
    throw new Error("chainSessionNumber must be a positive integer.");
  }

  const startsAt = new Date(input.startsAtIso);
  const endsAt = new Date(input.endsAtIso);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("startsAtIso is not a valid timestamp.");
  }
  if (Number.isNaN(endsAt.getTime())) {
    throw new Error("endsAtIso is not a valid timestamp.");
  }
  if (endsAt <= startsAt) {
    throw new Error("Session end time must be after the start time.");
  }

  const cardPackItems = (input.cardPackItems ?? []).map((item) => ({
    kind: parseRewardKind(item.kind),
    title: item.title.trim(),
    subtitle: item.subtitle.trim(),
  }));
  for (const item of cardPackItems) {
    if (!item.title) throw new Error("Card-pack item title is required.");
    if (!item.subtitle) throw new Error("Card-pack item subtitle is required.");
  }

  assertAdminWallet(adminWalletAddress);

  // The on-chain tx is the authorization proof: it must exist, be signed by
  // the named admin, and reference the same session_number derived PDA.
  const { verifyCreateSessionTx } = await import("./chain-verifier");
  const verified = await verifyCreateSessionTx({
    cluster: publicSpotrConfig.cluster,
    signature: chainTxSignature,
    expectedAdmin: adminWalletAddress,
    expectedSessionNumber: chainSessionNumber,
  });

  await syncFaultLineSeeds();
  // Keep the write transaction tight: the dashboard read uses a parallel
  // `Promise.all` of ~14 queries which Prisma Accelerate refuses to run
  // inside an interactive transaction. Run writes here, then assemble the
  // dashboard with its own (properly-scoped) read tx afterwards.
  await prisma.$transaction(async (tx) => {
    const liveSessionCount = await tx.session.count({
      where: { status: "LIVE" },
    });
    if (liveSessionCount > 0) {
      throw new Error("Complete or expire the live session before deploying another.");
    }

    const existingByNumber = await tx.session.findUnique({
      where: { chainSessionNumber },
      select: { id: true },
    });
    if (existingByNumber) {
      throw new Error("This on-chain session number is already bound to a Postgres session.");
    }

    const pairs = await tx.faultLinePair.findMany({
      where: {
        id: { in: pairIds },
        active: true,
      },
    });
    if (pairs.length !== pairIds.length) {
      throw new Error("All selected pairs must exist and be active.");
    }

    const sessionOrdinal = (await tx.session.count()) + 1;
    const sessionTitle =
      title || getSessionTitle(publicSpotrConfig.seasonLabel, sessionOrdinal);
    const sessionId = await createSessionWithPairs(tx, {
      slug: getSessionSlug(publicSpotrConfig.seasonLabel, startsAt, sessionOrdinal),
      title: sessionTitle,
      seasonLabel: publicSpotrConfig.seasonLabel,
      launchIso: startsAt,
      startsAt,
      endsAt,
      pairIds,
      buyInLamports: input.buyInLamports ?? undefined,
    });

    await tx.session.update({
      where: { id: sessionId },
      data: {
        chainSessionNumber,
        chainSessionAddress: verified.sessionAddress,
        chainDeployTxSignature: chainTxSignature,
      },
    });

    if (cardPackItems.length > 0) {
      await tx.sessionCardPackTemplate.createMany({
        data: cardPackItems.map((item) => ({
          sessionId,
          kind: item.kind,
          title: item.title,
          subtitle: item.subtitle,
        })),
      });
    }

    await tx.transactionLog.create({
      data: {
        sessionId,
        walletAddress: adminWalletAddress,
        kind: "admin_deploy_session",
        metadataJson: JSON.stringify({
          pairIds,
          roundCount: pairIds.length,
          chainTxSignature,
          chainSessionNumber: chainSessionNumber.toString(),
          chainSessionAddress: verified.sessionAddress,
          chainSlot: verified.slot,
          payloadSnapshot: {
            title: sessionTitle,
            pairIds,
            startsAtIso: startsAt.toISOString(),
            endsAtIso: endsAt.toISOString(),
            cardPackItems: cardPackItems.length,
          },
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(adminWalletAddress);
}

export async function payOutAdminReferralBalance(input: {
  adminWalletAddress: string;
  referrerWallet: string;
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const referrerWallet = normalizeWalletAddress(input.referrerWallet);

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (!referrerWallet) {
    throw new Error("A referrer wallet address is required.");
  }

  await prisma.$transaction(async (tx) => {
    assertAdminWallet(adminWalletAddress);

    const accruals = await tx.referralAccrual.findMany({
      where: {
        referrerWallet,
        status: "CLAIMABLE",
      },
    });
    const totalLamports = accruals.reduce(
      (total, accrual) => total + accrual.amountLamports,
      0n
    );
    if (totalLamports <= 0n) {
      throw new Error("This referrer has no payout due right now.");
    }

    const payoutBatch = await tx.referralPayoutBatch.create({
      data: {
        referrerWallet,
        adminWalletAddress,
        totalLamports,
        referralCount: new Set(accruals.map((accrual) => accrual.refereeWallet)).size,
        metadataJson: JSON.stringify({
          accrualIds: accruals.map((accrual) => accrual.id),
        }),
      },
    });

    await tx.referralAccrual.updateMany({
      where: {
        id: { in: accruals.map((accrual) => accrual.id) },
      },
      data: {
        status: "CLAIMED",
        claimedAt: payoutBatch.paidAt,
        payoutBatchId: payoutBatch.id,
      },
    });

    await tx.transactionLog.create({
      data: {
        walletAddress: adminWalletAddress,
        kind: "admin_payout_referrals",
        amountLamports: totalLamports,
        metadataJson: JSON.stringify({
          payoutBatchId: payoutBatch.id,
          referrerWallet,
          accrualIds: accruals.map((accrual) => accrual.id),
          payloadSnapshot: { referrerWallet },
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(adminWalletAddress);
}

export async function assignAdminReward(input: {
  adminWalletAddress: string;
  targetWalletAddress: string;
  title: string;
  subtitle: string;
  kind: RewardInventoryItem["kind"];
  sessionId?: string | null;
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const targetWalletAddress = normalizeWalletAddress(input.targetWalletAddress);
  const title = input.title.trim();
  const subtitle = input.subtitle.trim();

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (!targetWalletAddress) {
    throw new Error("A target wallet address is required.");
  }
  if (!title) {
    throw new Error("Reward title is required.");
  }
  if (!subtitle) {
    throw new Error("Reward subtitle is required.");
  }

  await prisma.$transaction(async (tx) => {
    assertAdminWallet(adminWalletAddress);

    const sessionId =
      input.sessionId?.trim() || (await getPrimarySessionId(tx));
    const participant = await tx.sessionParticipant.findUnique({
      where: {
        sessionId_walletAddress: {
          sessionId,
          walletAddress: targetWalletAddress,
        },
      },
    });
    if (!participant) {
      throw new Error("Target wallet has not joined the selected session.");
    }

    const reward = await tx.rewardInventory.create({
      data: {
        participantId: participant.id,
        walletAddress: participant.walletAddress,
        sessionId,
        kind: parseRewardKind(input.kind),
        title,
        subtitle,
        status: "ASSIGNED",
      },
    });

    await tx.transactionLog.create({
      data: {
        sessionId,
        walletAddress: adminWalletAddress,
        kind: "admin_assign_reward",
        metadataJson: JSON.stringify({
          rewardId: reward.id,
          targetWalletAddress,
          kind: input.kind,
          title,
          payloadSnapshot: {
            targetWalletAddress,
            kind: input.kind,
            title,
            subtitle,
            sessionId,
          },
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(adminWalletAddress);
}

export async function updateAdminRewardStatus(input: {
  adminWalletAddress: string;
  rewardId: string;
  status: RewardInventoryItem["status"];
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const rewardId = input.rewardId.trim();

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (!rewardId) {
    throw new Error("Reward id is required.");
  }

  await prisma.$transaction(async (tx) => {
    assertAdminWallet(adminWalletAddress);

    const reward = await tx.rewardInventory.findUnique({
      where: { id: rewardId },
    });
    if (!reward) {
      throw new Error("Reward not found.");
    }

    const nextStatus = parseRewardStatus(input.status);
    await tx.rewardInventory.update({
      where: { id: rewardId },
      data: {
        status: nextStatus,
        claimedAt: nextStatus === RewardStatus.CLAIMED ? new Date() : null,
      },
    });

    await tx.transactionLog.create({
      data: {
        sessionId: reward.sessionId,
        walletAddress: adminWalletAddress,
        kind: "admin_update_reward_status",
        metadataJson: JSON.stringify({
          rewardId,
          status: input.status,
          targetWalletAddress: reward.walletAddress,
          payloadSnapshot: { rewardId, status: input.status },
        }),
      },
    });
  }, { timeout: 15_000 });

  return getSpotrDashboardPayload(adminWalletAddress);
}

export async function getSessionPublicResults(
  sessionId: string
): Promise<SessionPublicResults | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      rounds: {
        include: { pair: true },
        orderBy: { roundIndex: "asc" },
      },
    },
  });

  if (!session) return null;

  const now = new Date();

  return {
    id: session.id,
    title: session.title,
    status: mapSessionStatus(session.status),
    startsAtIso: session.startsAt.toISOString(),
    endsAtIso: session.endsAt.toISOString(),
    walletsJoined: session.joinedWallets,
    totalEscrowLamports: Number(session.totalEscrowLamports),
    rounds: session.rounds.map((round) => {
      const derivedStatus = deriveRoundStatus(
        session.status,
        round.opensAt,
        round.closesAt,
        now
      );
      const probs = getProbabilities(
        round.sideATotalNetLamports,
        round.sideBTotalNetLamports,
        round.sideAProbabilityPct,
        round.sideBProbabilityPct
      );
      const winningSide: SpotrSide | null =
        round.winningSide === PositionSide.A
          ? "A"
          : round.winningSide === PositionSide.B
            ? "B"
            : null;
      return {
        index: round.roundIndex,
        status: mapRoundStatus(derivedStatus),
        category: round.pair.category,
        sideA: round.pair.sideA,
        sideB: round.pair.sideB,
        sideAPct: probs.sideA,
        sideBPct: probs.sideB,
        sideATotalEntries: round.sideATotalEntries,
        sideBTotalEntries: round.sideBTotalEntries,
        totalVolumeLamports: Number(round.totalVolumeLamports),
        winningSide,
      };
    }),
  };
}

export async function listProfileSessionHistory(
  walletAddress: string
): Promise<ProfileSessionHistoryRow[]> {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet) return [];

  const participants = await prisma.sessionParticipant.findMany({
    where: { walletAddress: wallet },
    include: {
      session: {
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      },
      positions: {
        include: {
          round: {
            select: {
              status: true,
              winningSide: true,
              redistributeApplied: true,
            },
          },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  return participants.map((participant) => {
    let totalStake = 0n;
    let totalProceeds = 0n;
    for (const position of participant.positions) {
      totalStake += position.stakeLamports;
      const claimable =
        position.round.status === "CLOSED"
          ? derivePositionClaimableLamports(position.round, position)
          : 0n;
      totalProceeds += claimable + position.claimedLamports;
    }
    return {
      sessionId: participant.session.id,
      title: participant.session.title,
      status: mapSessionStatus(participant.session.status),
      joinedAtIso: participant.joinedAt.toISOString(),
      startsAtIso: participant.session.startsAt.toISOString(),
      endsAtIso: participant.session.endsAt.toISOString(),
      positionsEntered: participant.positions.length,
      netPnlLamports: toNumber(totalProceeds - totalStake),
    };
  });
}

/**
 * Per-round detail for a single (wallet, session) pair. Drives the expanded
 * row on /profile when the user clicks into a session. Includes every round
 * the wallet either deposited or entered into; rounds the wallet sat out
 * are omitted.
 */
export async function getProfileSessionRounds(
  walletAddressInput: string,
  sessionId: string,
): Promise<ProfileSessionRoundRow[]> {
  const walletAddress = normalizeWalletAddress(walletAddressInput);
  if (!walletAddress) return [];

  const participant = await prisma.sessionParticipant.findUnique({
    where: {
      sessionId_walletAddress: {
        sessionId,
        walletAddress,
      },
    },
    include: {
      deposits: {
        include: {
          round: {
            include: { pair: true },
          },
        },
      },
      positions: {
        include: {
          round: {
            include: { pair: true },
          },
        },
      },
    },
  });
  if (!participant) return [];

  type RoundWithPair = (typeof participant.deposits)[number]["round"];
  type Position = (typeof participant.positions)[number];
  type Deposit = (typeof participant.deposits)[number];

  const rounds = new Map<
    string,
    { round: RoundWithPair; deposit: Deposit | null; position: Position | null }
  >();
  for (const deposit of participant.deposits) {
    rounds.set(deposit.roundId, {
      round: deposit.round,
      deposit,
      position: null,
    });
  }
  for (const position of participant.positions) {
    const existing = rounds.get(position.roundId);
    if (existing) {
      existing.position = position;
    } else {
      rounds.set(position.roundId, {
        round: position.round,
        deposit: null,
        position,
      });
    }
  }

  const sideToSpotr = (side: PositionSide | null): "A" | "B" | null =>
    side === PositionSide.A ? "A" : side === PositionSide.B ? "B" : null;

  return Array.from(rounds.values())
    .sort((a, b) => a.round.roundIndex - b.round.roundIndex)
    .map(({ round, deposit, position }) => {
      const claimable = position
        ? derivePositionClaimableLamports(round, position)
        : 0n;
      return {
        roundId: round.id,
        roundIndex: round.roundIndex,
        pairCategory: round.pair.category,
        sideA: round.pair.sideA,
        sideB: round.pair.sideB,
        status: mapRoundStatus(round.status),
        depositMicroUsdc: deposit ? toNumber(deposit.amountLamports) : null,
        depositRefunded: deposit ? deposit.refundedAt != null : false,
        lockedSide: sideToSpotr(position?.side ?? null),
        stakeMicroUsdc: position ? toNumber(position.stakeLamports) : 0,
        claimableMicroUsdc: toNumber(claimable),
        claimedMicroUsdc: position ? toNumber(position.claimedLamports) : 0,
        winningSide: sideToSpotr(round.winningSide ?? null),
        redistributeApplied: round.redistributeApplied,
      };
    });
}

const ADMIN_LIST_PAGE_SIZE = 50;
const ADMIN_AUDIT_PREFIX = "admin_";

function decodeListCursor(cursor?: string | null): { skip: number } {
  if (!cursor) return { skip: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (typeof parsed?.skip === "number" && Number.isFinite(parsed.skip)) {
      return { skip: Math.max(0, Math.floor(parsed.skip)) };
    }
  } catch {
    // ignore
  }
  return { skip: 0 };
}

function encodeListCursor(skip: number): string {
  return Buffer.from(JSON.stringify({ skip }), "utf8").toString("base64");
}

function utcDayKey(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfUtcDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function fillTimeSeries(
  fromIso: string,
  toIso: string,
  values: Map<string, number>
): AdminTimePoint[] {
  const out: AdminTimePoint[] = [];
  const cursor = startOfUtcDay(new Date(fromIso));
  const end = startOfUtcDay(new Date(toIso));
  while (cursor <= end) {
    const key = utcDayKey(cursor);
    out.push({ dateIso: cursor.toISOString(), value: values.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function defaultAnalyticsRange(now = new Date()): { from: Date; to: Date } {
  const to = startOfUtcDay(now);
  to.setUTCDate(to.getUTCDate() + 1);
  to.setUTCMilliseconds(-1);
  const from = startOfUtcDay(now);
  from.setUTCDate(from.getUTCDate() - 13); // 14-day window inclusive
  return { from, to };
}

function parseAnalyticsRange(input: { from?: string | null; to?: string | null }) {
  const fallback = defaultAnalyticsRange();
  let from = fallback.from;
  let to = fallback.to;
  if (input.from) {
    const parsed = new Date(input.from);
    if (!Number.isNaN(parsed.getTime())) {
      from = startOfUtcDay(parsed);
    }
  }
  if (input.to) {
    const parsed = new Date(input.to);
    if (!Number.isNaN(parsed.getTime())) {
      to = startOfUtcDay(parsed);
      to.setUTCDate(to.getUTCDate() + 1);
      to.setUTCMilliseconds(-1);
    }
  }
  if (to <= from) {
    to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return { from, to };
}

function mapAdminTransaction(transaction: {
  id: string;
  sessionId: string | null;
  walletAddress: string | null;
  kind: string;
  amountLamports: bigint | null;
  metadataJson: string | null;
  createdAt: Date;
}): AdminTransactionDetail {
  return {
    id: transaction.id,
    sessionId: transaction.sessionId,
    walletAddress: transaction.walletAddress,
    kind: transaction.kind,
    amountLamports:
      transaction.amountLamports == null
        ? null
        : Number(transaction.amountLamports),
    metadataJson: transaction.metadataJson,
    createdAtIso: transaction.createdAt.toISOString(),
  };
}

export async function getAdminOverview(
  walletAddress: string
): Promise<AdminOverviewResponse> {
  assertAdminWallet(walletAddress);
  const sessionId = await getPrimarySessionId(prisma);
  const summary = await buildAdminSummary(prisma, sessionId, walletAddress);

  const range = defaultAnalyticsRange();

  const [positions, joins, recentTransactionsRaw, liveSessions] = await Promise.all([
    prisma.roundPosition.findMany({
      where: { submittedAt: { gte: range.from, lte: range.to } },
      select: {
        submittedAt: true,
        stakeLamports: true,
        feeLamports: true,
      },
    }),
    prisma.sessionParticipant.findMany({
      where: { joinedAt: { gte: range.from, lte: range.to } },
      select: { joinedAt: true },
    }),
    prisma.transactionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.session.findMany({
      where: { status: "LIVE" },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { title: true },
    }),
  ]);

  const volumeMap = new Map<string, number>();
  const feesMap = new Map<string, number>();
  for (const position of positions) {
    const key = utcDayKey(position.submittedAt);
    volumeMap.set(
      key,
      (volumeMap.get(key) ?? 0) + Number(position.stakeLamports)
    );
    feesMap.set(
      key,
      (feesMap.get(key) ?? 0) + Number(position.feeLamports)
    );
  }
  const joinsMap = new Map<string, number>();
  for (const entry of joins) {
    const key = utcDayKey(entry.joinedAt);
    joinsMap.set(key, (joinsMap.get(key) ?? 0) + 1);
  }

  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  return {
    summary,
    sparklines: {
      volumeByDay: fillTimeSeries(fromIso, toIso, volumeMap),
      feesByDay: fillTimeSeries(fromIso, toIso, feesMap),
      joinsByDay: fillTimeSeries(fromIso, toIso, joinsMap),
    },
    recentTransactions: recentTransactionsRaw.map(mapAdminTransaction),
    liveSessionTitles: liveSessions.map((row) => row.title),
  };
}

export async function listAdminSessions(input: {
  walletAddress: string;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminSessionListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    200
  );
  const { skip } = decodeListCursor(input.cursor ?? null);

  const statusFilter = (() => {
    if (!input.status) return undefined;
    const map: Record<string, PrismaSessionStatus> = {
      pending: "PENDING",
      live: "LIVE",
      expired: "EXPIRED",
      completed: "COMPLETED",
    };
    return map[input.status.toLowerCase()];
  })();

  const dateFrom = input.dateFrom ? new Date(input.dateFrom) : null;
  const dateTo = input.dateTo ? new Date(input.dateTo) : null;

  const where: Prisma.SessionWhereInput = {};
  if (statusFilter) where.status = statusFilter;
  if (dateFrom || dateTo) {
    where.startsAt = {};
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
      (where.startsAt as Prisma.DateTimeFilter).gte = dateFrom;
    }
    if (dateTo && !Number.isNaN(dateTo.getTime())) {
      (where.startsAt as Prisma.DateTimeFilter).lte = dateTo;
    }
  }

  const items = await prisma.session.findMany({
    where,
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    skip,
    take: pageSize + 1,
    include: { rounds: { orderBy: { roundIndex: "asc" }, select: { pairId: true } } },
  });
  const hasMore = items.length > pageSize;
  const slice = hasMore ? items.slice(0, pageSize) : items;

  return {
    items: slice.map<AdminSessionListItem>((session) => ({
      id: session.id,
      slug: session.slug,
      title: session.title,
      status: mapSessionStatus(session.status),
      startsAtIso: session.startsAt.toISOString(),
      endsAtIso: session.endsAt.toISOString(),
      activatedAtIso: session.activatedAt?.toISOString() ?? null,
      completedAtIso: session.completedAt?.toISOString() ?? null,
      joinedWallets: session.joinedWallets,
      totalEscrowLamports: toNumber(session.totalEscrowLamports),
      protocolFeeAccruedLamports: toNumber(
        session.protocolFeeAccruedLamports
      ),
      chainSessionNumber:
        session.chainSessionNumber == null
          ? null
          : session.chainSessionNumber.toString(),
      chainSessionAddress: session.chainSessionAddress ?? null,
      chainDeployTxSignature: session.chainDeployTxSignature ?? null,
      createdAtIso: session.createdAt.toISOString(),
      pairIds: session.rounds.map((r) => r.pairId),
    })),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function getAdminSessionDetail(input: {
  walletAddress: string;
  sessionId: string;
}): Promise<AdminSessionDetail | null> {
  assertAdminWallet(input.walletAddress);

  // Run state advance in its own short tx so the (read-only) payload
  // assembly below doesn't share the transaction's wall-clock budget.
  // `maxWait` is bumped because the hosted Prisma Postgres pool is small
  // and the parallel reads below also pull connections.
  await prisma
    .$transaction(
      (tx) => syncSessionState(tx, input.sessionId),
      { timeout: 10_000, maxWait: 10_000 }
    )
    .catch(() => null);

  const [session, positions, referrals, transactions] = await Promise.all([
    prisma.session.findUnique({
      where: { id: input.sessionId },
      include: {
        rounds: {
          include: { pair: true, positions: { select: { id: true } } },
          orderBy: { roundIndex: "asc" },
        },
        participants: {
          orderBy: { joinedAt: "asc" },
          include: { positions: { select: { id: true } } },
        },
        cardPackTemplates: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.roundPosition.findMany({
      where: { round: { sessionId: input.sessionId } },
      orderBy: { submittedAt: "asc" },
      include: { round: { select: { roundIndex: true } } },
    }),
    prisma.referralAccrual.findMany({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transactionLog.findMany({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  if (!session) return null;

  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    seasonLabel: session.seasonLabel,
    status: mapSessionStatus(session.status),
    startsAtIso: session.startsAt.toISOString(),
    endsAtIso: session.endsAt.toISOString(),
    activatedAtIso: session.activatedAt?.toISOString() ?? null,
    completedAtIso: session.completedAt?.toISOString() ?? null,
    launchIso: session.launchIso.toISOString(),
    joinedWallets: session.joinedWallets,
    totalEscrowLamports: toNumber(session.totalEscrowLamports),
    protocolFeeAccruedLamports: toNumber(session.protocolFeeAccruedLamports),
    buyInLamports: toNumber(session.buyInLamports),
    protocolFeeBps: session.protocolFeeBps,
    referralCutBps: session.referralCutBps,
    cardRewardSlots: session.cardRewardSlots,
    payoutCadenceDays: session.payoutCadenceDays,
    chainSessionNumber:
      session.chainSessionNumber == null
        ? null
        : session.chainSessionNumber.toString(),
    chainSessionAddress: session.chainSessionAddress ?? null,
    chainDeployTxSignature: session.chainDeployTxSignature ?? null,
    createdAtIso: session.createdAt.toISOString(),
    rounds: session.rounds.map<AdminSessionRoundDetail>((round) => ({
      id: round.id,
      index: round.roundIndex,
      pairId: round.pairId,
      category: round.pair.category,
      sideA: round.pair.sideA,
      sideB: round.pair.sideB,
      status: mapRoundStatus(round.status),
      opensAtIso: round.opensAt?.toISOString() ?? null,
      closesAtIso: round.closesAt?.toISOString() ?? null,
      settledAtIso: round.settledAt?.toISOString() ?? null,
      sideAProbabilityPct: round.sideAProbabilityPct,
      sideBProbabilityPct: round.sideBProbabilityPct,
      sideATotalEntries: round.sideATotalEntries,
      sideBTotalEntries: round.sideBTotalEntries,
      sideATotalNetLamports: toNumber(round.sideATotalNetLamports),
      sideBTotalNetLamports: toNumber(round.sideBTotalNetLamports),
      totalVolumeLamports: toNumber(round.totalVolumeLamports),
      positionsCount: round.positions.length,
    })),
    participants: session.participants.map<AdminSessionParticipantDetail>(
      (participant) => ({
        id: participant.id,
        walletAddress: participant.walletAddress,
        joinedAtIso: participant.joinedAt.toISOString(),
        totalEscrowLamports: toNumber(participant.totalEscrowLamports),
        remainingEscrowLamports: toNumber(participant.remainingEscrowLamports),
        referredByWallet: participant.referredByWallet,
        positionsEntered: participant.positions.length,
        chainJoinTxSignature: participant.chainJoinTxSignature,
        chainPlayerSessionAddress: participant.chainPlayerSessionAddress,
      })
    ),
    positions: positions.map<AdminSessionPositionDetail>((position) => ({
      id: position.id,
      roundId: position.roundId,
      roundIndex: position.round.roundIndex,
      walletAddress: position.walletAddress,
      side: position.side === "A" ? "A" : "B",
      submittedAtIso: position.submittedAt.toISOString(),
      stakeLamports: toNumber(position.stakeLamports),
      feeLamports: toNumber(position.feeLamports),
      netStakeLamports: toNumber(position.netStakeLamports),
      shares: toNumber(position.shares),
      rewardDebtLamports: toNumber(position.rewardDebtLamports),
      claimedLamports: toNumber(position.claimedLamports),
      claimedAtIso: position.claimedAt?.toISOString() ?? null,
    })),
    referrals: referrals.map<AdminSessionReferralDetail>((referral) => ({
      id: referral.id,
      referrerWallet: referral.referrerWallet,
      refereeWallet: referral.refereeWallet,
      status:
        referral.status === "CLAIMED"
          ? "claimed"
          : referral.status === "CLAIMABLE"
            ? "claimable"
            : "pending",
      amountLamports: toNumber(referral.amountLamports),
      createdAtIso: referral.createdAt.toISOString(),
      claimableAtIso: referral.claimableAt?.toISOString() ?? null,
      claimedAtIso: referral.claimedAt?.toISOString() ?? null,
    })),
    transactions: transactions.map(mapAdminTransaction),
    cardPackTemplates: session.cardPackTemplates.map<AdminCardPackTemplate>(
      (template) => ({
        id: template.id,
        kind: mapRewardKind(template.kind),
        title: template.title,
        subtitle: template.subtitle,
        createdAtIso: template.createdAt.toISOString(),
      })
    ),
  };
}

export async function expireAdminSession(input: {
  adminWalletAddress: string;
  sessionId: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  const sessionId = input.sessionId.trim();
  if (!sessionId) throw new Error("sessionId is required.");
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Session not found.");
    if (session.status === "COMPLETED") {
      throw new Error("Cannot expire a completed session.");
    }
    await tx.session.update({
      where: { id: sessionId },
      data: { status: "EXPIRED" },
    });
    await tx.transactionLog.create({
      data: {
        sessionId,
        walletAddress: input.adminWalletAddress,
        kind: "admin_expire_session",
        metadataJson: JSON.stringify({
          payloadSnapshot: { sessionId },
          previousStatus: session.status,
        }),
      },
    });
  });
}

export async function recordChainCloseRound(input: {
  adminWalletAddress: string;
  sessionId: string;
  roundId: string;
  chainTxSignature: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  await prisma.transactionLog.create({
    data: {
      sessionId: input.sessionId,
      walletAddress: input.adminWalletAddress,
      kind: "admin_close_round",
      metadataJson: JSON.stringify({
        payloadSnapshot: {
          sessionId: input.sessionId,
          roundId: input.roundId,
          chainTxSignature: input.chainTxSignature,
        },
      }),
    },
  });
  await prisma.$transaction(async (tx) => {
    await syncSessionState(tx, input.sessionId).catch(() => null);
  });
}

export async function recordChainSweepOrphans(input: {
  adminWalletAddress: string;
  sessionId: string;
  roundId: string;
  chainTxSignature: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  await prisma.transactionLog.create({
    data: {
      sessionId: input.sessionId,
      walletAddress: input.adminWalletAddress,
      kind: "admin_sweep_orphans",
      metadataJson: JSON.stringify({
        payloadSnapshot: {
          sessionId: input.sessionId,
          roundId: input.roundId,
          chainTxSignature: input.chainTxSignature,
        },
      }),
    },
  });
}

export async function recordChainFinalizeSession(input: {
  adminWalletAddress: string;
  sessionId: string;
  chainTxSignature: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  await prisma.transactionLog.create({
    data: {
      sessionId: input.sessionId,
      walletAddress: input.adminWalletAddress,
      kind: "admin_finalize_session",
      metadataJson: JSON.stringify({
        payloadSnapshot: {
          sessionId: input.sessionId,
          chainTxSignature: input.chainTxSignature,
        },
      }),
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: input.sessionId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });
}

export async function recordChainWithdrawFees(input: {
  adminWalletAddress: string;
  sessionId: string;
  chainTxSignature: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  await prisma.transactionLog.create({
    data: {
      sessionId: input.sessionId,
      walletAddress: input.adminWalletAddress,
      kind: "admin_withdraw_protocol_fees",
      metadataJson: JSON.stringify({
        payloadSnapshot: {
          sessionId: input.sessionId,
          chainTxSignature: input.chainTxSignature,
        },
      }),
    },
  });
  await prisma.session.update({
    where: { id: input.sessionId },
    data: { protocolFeeAccruedLamports: 0n },
  });
}

export async function assignSessionCardPack(input: {
  adminWalletAddress: string;
  sessionId: string;
  items: Array<{
    kind: RewardInventoryItem["kind"];
    title: string;
    subtitle: string;
  }>;
}) {
  assertAdminWallet(input.adminWalletAddress);
  if (!input.sessionId) throw new Error("sessionId is required.");
  if (input.items.length === 0)
    throw new Error("Provide at least one card-pack item.");

  const items = input.items.map((item) => ({
    kind: parseRewardKind(item.kind),
    title: item.title.trim(),
    subtitle: item.subtitle.trim(),
  }));
  for (const item of items) {
    if (!item.title) throw new Error("Card-pack item title is required.");
    if (!item.subtitle) throw new Error("Card-pack item subtitle is required.");
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: input.sessionId },
    });
    if (!session) throw new Error("Session not found.");
    await tx.sessionCardPackTemplate.createMany({
      data: items.map((item) => ({
        sessionId: input.sessionId,
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
      })),
    });
    await tx.transactionLog.create({
      data: {
        sessionId: input.sessionId,
        walletAddress: input.adminWalletAddress,
        kind: "admin_assign_card_pack",
        metadataJson: JSON.stringify({
          payloadSnapshot: {
            sessionId: input.sessionId,
            itemCount: items.length,
          },
        }),
      },
    });
  });
}

export async function listAdminPairs(input: {
  walletAddress: string;
  search?: string | null;
  active?: boolean | null;
  assigned?: boolean | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminPairListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    200
  );
  const { skip } = decodeListCursor(input.cursor ?? null);

  const where: Prisma.FaultLinePairWhereInput = {};
  const search = input.search?.trim();
  if (search) {
    where.OR = [
      { category: { contains: search } },
      { sideA: { contains: search } },
      { sideB: { contains: search } },
      { slug: { contains: search } },
    ];
  }
  if (typeof input.active === "boolean") where.active = input.active;

  const [pairs, assignedPairs] = await Promise.all([
    prisma.faultLinePair.findMany({
      where,
      orderBy: [{ active: "desc" }, { category: "asc" }, { slug: "asc" }],
      skip,
      take: pageSize + 1,
    }),
    prisma.sessionRound.findMany({
      where: {
        session: { status: "LIVE" },
      },
      select: { pairId: true },
      distinct: ["pairId"],
    }),
  ]);
  const assignedPairIds = new Set(assignedPairs.map((p) => p.pairId));
  let filtered = pairs;
  if (typeof input.assigned === "boolean") {
    filtered = pairs.filter((pair) =>
      input.assigned ? assignedPairIds.has(pair.id) : !assignedPairIds.has(pair.id)
    );
  }
  const hasMore = filtered.length > pageSize;
  const slice = hasMore ? filtered.slice(0, pageSize) : filtered;

  return {
    items: slice.map<AdminPairTableRow>((pair) => ({
      id: pair.id,
      slug: pair.slug,
      category: pair.category,
      sideA: pair.sideA,
      sideB: pair.sideB,
      defaultSideAPct: pair.defaultSideAPct,
      defaultSideBPct: pair.defaultSideBPct,
      crowdLabel: pair.crowdLabel,
      active: pair.active,
      assigned: assignedPairIds.has(pair.id),
      createdAtIso: pair.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function editAdminPair(input: {
  adminWalletAddress: string;
  id: string;
  category?: string;
  sideA?: string;
  sideB?: string;
  crowdLabel?: string;
  defaultSideAPct?: number;
}) {
  assertAdminWallet(input.adminWalletAddress);
  const id = input.id.trim();
  if (!id) throw new Error("Pair id is required.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.faultLinePair.findUnique({ where: { id } });
    if (!existing) throw new Error("Pair not found.");
    const updateData: Prisma.FaultLinePairUpdateInput = {};
    if (input.category !== undefined) {
      const value = input.category.trim();
      if (!value) throw new Error("category cannot be empty.");
      updateData.category = value;
    }
    if (input.sideA !== undefined) {
      const value = input.sideA.trim();
      if (!value) throw new Error("sideA cannot be empty.");
      updateData.sideA = value;
    }
    if (input.sideB !== undefined) {
      const value = input.sideB.trim();
      if (!value) throw new Error("sideB cannot be empty.");
      updateData.sideB = value;
    }
    if (input.crowdLabel !== undefined) {
      updateData.crowdLabel = input.crowdLabel.trim() || existing.crowdLabel;
    }
    if (input.defaultSideAPct !== undefined) {
      const pct = Math.round(input.defaultSideAPct);
      if (pct < 0 || pct > 100) {
        throw new Error("defaultSideAPct must be between 0 and 100.");
      }
      updateData.defaultSideAPct = pct;
      updateData.defaultSideBPct = 100 - pct;
    }
    await tx.faultLinePair.update({ where: { id }, data: updateData });
    await tx.transactionLog.create({
      data: {
        walletAddress: input.adminWalletAddress,
        kind: "admin_edit_pair",
        metadataJson: JSON.stringify({
          payloadSnapshot: { id, ...updateData },
        }),
      },
    });
  });
}

export async function bulkTogglePairs(input: {
  adminWalletAddress: string;
  pairIds: string[];
  active: boolean;
}) {
  assertAdminWallet(input.adminWalletAddress);
  const pairIds = Array.from(
    new Set(input.pairIds.map((p) => p.trim()).filter(Boolean))
  );
  if (pairIds.length === 0) throw new Error("Provide at least one pair id.");
  return prisma.$transaction(async (tx) => {
    await tx.faultLinePair.updateMany({
      where: { id: { in: pairIds } },
      data: { active: input.active },
    });
    await tx.transactionLog.create({
      data: {
        walletAddress: input.adminWalletAddress,
        kind: "admin_toggle_pair_bulk",
        metadataJson: JSON.stringify({
          payloadSnapshot: { pairIds, active: input.active },
          count: pairIds.length,
        }),
      },
    });
  });
}

export async function listAdminPlayers(input: {
  walletAddress: string;
  search?: string | null;
  sessionId?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminPlayerListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    200
  );
  const { skip } = decodeListCursor(input.cursor ?? null);

  const where: Prisma.SessionParticipantWhereInput = {};
  const search = input.search?.trim();
  if (search) {
    where.walletAddress = { contains: search };
  }
  if (input.sessionId) where.sessionId = input.sessionId;

  const allParticipants = await prisma.sessionParticipant.findMany({
    where,
    include: {
      positions: {
        select: { stakeLamports: true },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  type Aggregated = {
    walletAddress: string;
    sessionsJoined: number;
    totalStakedLamports: bigint;
    totalEscrowLamports: bigint;
    remainingEscrowLamports: bigint;
    positionsEntered: number;
    rewardsAssigned: number;
    referredByWallet: string | null;
    firstJoinedAt: Date | null;
    lastJoinedAt: Date | null;
  };
  const aggregated = new Map<string, Aggregated>();
  for (const participant of allParticipants) {
    const current =
      aggregated.get(participant.walletAddress) ??
      ({
        walletAddress: participant.walletAddress,
        sessionsJoined: 0,
        totalStakedLamports: 0n,
        totalEscrowLamports: 0n,
        remainingEscrowLamports: 0n,
        positionsEntered: 0,
        rewardsAssigned: 0,
        referredByWallet: null,
        firstJoinedAt: null,
        lastJoinedAt: null,
      } as Aggregated);
    current.sessionsJoined += 1;
    for (const position of participant.positions) {
      current.totalStakedLamports += position.stakeLamports;
    }
    current.totalEscrowLamports += participant.totalEscrowLamports;
    current.remainingEscrowLamports += participant.remainingEscrowLamports;
    current.positionsEntered += participant.positions.length;
    if (!current.referredByWallet && participant.referredByWallet) {
      current.referredByWallet = participant.referredByWallet;
    }
    if (!current.firstJoinedAt || participant.joinedAt < current.firstJoinedAt) {
      current.firstJoinedAt = participant.joinedAt;
    }
    if (!current.lastJoinedAt || participant.joinedAt > current.lastJoinedAt) {
      current.lastJoinedAt = participant.joinedAt;
    }
    aggregated.set(participant.walletAddress, current);
  }

  const wallets = Array.from(aggregated.keys());
  const rewardsCounts = await prisma.rewardInventory.groupBy({
    by: ["walletAddress"],
    where: { walletAddress: { in: wallets } },
    _count: { _all: true },
  });
  for (const row of rewardsCounts) {
    const current = aggregated.get(row.walletAddress);
    if (current) current.rewardsAssigned = row._count._all;
  }

  const sorted = Array.from(aggregated.values()).sort((left, right) => {
    const leftMs = left.lastJoinedAt?.getTime() ?? 0;
    const rightMs = right.lastJoinedAt?.getTime() ?? 0;
    return rightMs - leftMs;
  });
  const sliced = sorted.slice(skip, skip + pageSize + 1);
  const hasMore = sliced.length > pageSize;
  const page = hasMore ? sliced.slice(0, pageSize) : sliced;

  return {
    items: page.map<AdminPlayerListItem>((entry) => ({
      walletAddress: entry.walletAddress,
      displayName: null,
      sessionsJoined: entry.sessionsJoined,
      totalStakedLamports: toNumber(entry.totalStakedLamports),
      totalEscrowLamports: toNumber(entry.totalEscrowLamports),
      remainingEscrowLamports: toNumber(entry.remainingEscrowLamports),
      positionsEntered: entry.positionsEntered,
      rewardsAssigned: entry.rewardsAssigned,
      referredByWallet: entry.referredByWallet,
      firstJoinedAtIso: entry.firstJoinedAt?.toISOString() ?? null,
      lastJoinedAtIso: entry.lastJoinedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function getAdminPlayerDetail(input: {
  walletAddress: string;
  targetWalletAddress: string;
}): Promise<AdminPlayerDetail | null> {
  assertAdminWallet(input.walletAddress);
  const target = normalizeWalletAddress(input.targetWalletAddress);
  if (!target) return null;
  const participants = await prisma.sessionParticipant.findMany({
    where: { walletAddress: target },
    include: {
      session: { select: { id: true, title: true, status: true } },
      positions: {
        include: { round: { include: { pair: true } } },
      },
    },
    orderBy: { joinedAt: "desc" },
  });
  if (participants.length === 0) return null;

  const sessions: AdminPlayerSessionRow[] = participants.map((participant) => ({
    participantId: participant.id,
    sessionId: participant.session.id,
    sessionTitle: participant.session.title,
    status: mapSessionStatus(participant.session.status),
    joinedAtIso: participant.joinedAt.toISOString(),
    totalEscrowLamports: toNumber(participant.totalEscrowLamports),
    remainingEscrowLamports: toNumber(participant.remainingEscrowLamports),
    positionsEntered: participant.positions.length,
  }));

  const positions: AdminPlayerPositionRow[] = participants.flatMap((participant) =>
    participant.positions.map((position) => ({
      id: position.id,
      sessionId: participant.session.id,
      sessionTitle: participant.session.title,
      roundIndex: position.round.roundIndex,
      category: position.round.pair.category,
      side: position.side === "A" ? "A" : "B",
      stakeLamports: toNumber(position.stakeLamports),
      feeLamports: toNumber(position.feeLamports),
      claimedLamports: toNumber(position.claimedLamports),
      submittedAtIso: position.submittedAt.toISOString(),
    }))
  );

  const rewards = await prisma.rewardInventory.findMany({
    where: { walletAddress: target },
    orderBy: { assignedAt: "desc" },
  });
  const rewardItems: AdminPlayerReward[] = rewards.map((reward) => ({
    id: reward.id,
    kind: mapRewardKind(reward.kind),
    title: reward.title,
    subtitle: reward.subtitle,
    status: mapRewardStatus(reward.status),
    assignedAtIso: reward.assignedAt.toISOString(),
    claimedAtIso: reward.claimedAt?.toISOString() ?? null,
    sessionId: reward.sessionId,
  }));

  const referredBy = participants.find((p) => p.referredByWallet)?.referredByWallet ?? null;
  const refereeAccruals = await prisma.referralAccrual.findMany({
    where: { referrerWallet: target },
  });
  const referredCountSet = new Set(refereeAccruals.map((row) => row.refereeWallet));
  const totalAccrued = refereeAccruals.reduce(
    (sum, row) => sum + row.amountLamports,
    0n
  );
  const paidOut = refereeAccruals
    .filter((row) => row.status === "CLAIMED")
    .reduce((sum, row) => sum + row.amountLamports, 0n);

  const referralPanel: AdminPlayerReferralPanel = {
    referredByWallet: referredBy,
    referredCount: referredCountSet.size,
    totalAccruedLamports: toNumber(totalAccrued),
    paidOutLamports: toNumber(paidOut),
    balanceDueLamports: toNumber(totalAccrued - paidOut),
  };

  const firstJoined = participants[participants.length - 1]?.joinedAt ?? null;
  const lastJoined = participants[0]?.joinedAt ?? null;

  return {
    walletAddress: target,
    displayName: null,
    firstJoinedAtIso: firstJoined?.toISOString() ?? null,
    lastJoinedAtIso: lastJoined?.toISOString() ?? null,
    sessions,
    positions,
    rewards: rewardItems,
    referralPanel,
  };
}

export async function listAdminTransactions(input: {
  walletAddress: string;
  kind?: string | null;
  walletFilter?: string | null;
  sessionId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminTransactionListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    500
  );
  const { skip } = decodeListCursor(input.cursor ?? null);
  const where: Prisma.TransactionLogWhereInput = {};
  if (input.kind) where.kind = input.kind;
  if (input.walletFilter) where.walletAddress = input.walletFilter;
  if (input.sessionId) where.sessionId = input.sessionId;
  if (input.dateFrom || input.dateTo) {
    where.createdAt = {};
    if (input.dateFrom) {
      const parsed = new Date(input.dateFrom);
      if (!Number.isNaN(parsed.getTime())) {
        (where.createdAt as Prisma.DateTimeFilter).gte = parsed;
      }
    }
    if (input.dateTo) {
      const parsed = new Date(input.dateTo);
      if (!Number.isNaN(parsed.getTime())) {
        (where.createdAt as Prisma.DateTimeFilter).lte = parsed;
      }
    }
  }
  const items = await prisma.transactionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize + 1,
  });
  const hasMore = items.length > pageSize;
  const slice = hasMore ? items.slice(0, pageSize) : items;
  return {
    items: slice.map(mapAdminTransaction),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function listAdminAudit(input: {
  walletAddress: string;
  actor?: string | null;
  kind?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminAuditListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    500
  );
  const { skip } = decodeListCursor(input.cursor ?? null);
  const where: Prisma.TransactionLogWhereInput = {
    kind: { startsWith: ADMIN_AUDIT_PREFIX },
  };
  if (input.kind) where.kind = input.kind;
  if (input.actor) where.walletAddress = input.actor;
  if (input.dateFrom || input.dateTo) {
    where.createdAt = {};
    if (input.dateFrom) {
      const parsed = new Date(input.dateFrom);
      if (!Number.isNaN(parsed.getTime())) {
        (where.createdAt as Prisma.DateTimeFilter).gte = parsed;
      }
    }
    if (input.dateTo) {
      const parsed = new Date(input.dateTo);
      if (!Number.isNaN(parsed.getTime())) {
        (where.createdAt as Prisma.DateTimeFilter).lte = parsed;
      }
    }
  }
  const items = await prisma.transactionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize + 1,
  });
  const hasMore = items.length > pageSize;
  const slice = hasMore ? items.slice(0, pageSize) : items;
  return {
    items: slice.map<AdminAuditEntry>((row) => ({
      id: row.id,
      actor: row.walletAddress,
      kind: row.kind,
      sessionId: row.sessionId,
      amountLamports:
        row.amountLamports == null ? null : Number(row.amountLamports),
      metadataJson: row.metadataJson,
      createdAtIso: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function listAdminReferralBalances(input: {
  walletAddress: string;
  search?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminReferralListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    500
  );
  const { skip } = decodeListCursor(input.cursor ?? null);

  const accruals = await prisma.referralAccrual.findMany({
    orderBy: { createdAt: "desc" },
  });
  const balanceMap = new Map<
    string,
    {
      referees: Set<string>;
      totalAccruedLamports: bigint;
      paidOutLamports: bigint;
    }
  >();
  for (const accrual of accruals) {
    const current =
      balanceMap.get(accrual.referrerWallet) ??
      {
        referees: new Set<string>(),
        totalAccruedLamports: 0n,
        paidOutLamports: 0n,
      };
    current.referees.add(accrual.refereeWallet);
    current.totalAccruedLamports += accrual.amountLamports;
    if (accrual.status === "CLAIMED") {
      current.paidOutLamports += accrual.amountLamports;
    }
    balanceMap.set(accrual.referrerWallet, current);
  }

  const allBalances = Array.from(balanceMap.entries())
    .map<AdminReferralBalance>(([referrerWallet, totals]) => ({
      referrerWallet,
      referredWallets: totals.referees.size,
      totalAccruedLamports: toNumber(totals.totalAccruedLamports),
      paidOutLamports: toNumber(totals.paidOutLamports),
      balanceDueLamports: toNumber(
        totals.totalAccruedLamports - totals.paidOutLamports
      ),
    }))
    .sort((left, right) => right.balanceDueLamports - left.balanceDueLamports);

  const search = input.search?.trim().toLowerCase();
  const filtered = search
    ? allBalances.filter((row) =>
        row.referrerWallet.toLowerCase().includes(search)
      )
    : allBalances;

  const sliced = filtered.slice(skip, skip + pageSize + 1);
  const hasMore = sliced.length > pageSize;
  const page = hasMore ? sliced.slice(0, pageSize) : sliced;

  return {
    items: page,
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function listReferralBatches(input: {
  walletAddress: string;
  referrerWallet?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminReferralBatchListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    500
  );
  const { skip } = decodeListCursor(input.cursor ?? null);
  const where: Prisma.ReferralPayoutBatchWhereInput = {};
  if (input.referrerWallet) where.referrerWallet = input.referrerWallet;
  if (input.dateFrom || input.dateTo) {
    where.paidAt = {};
    if (input.dateFrom) {
      const parsed = new Date(input.dateFrom);
      if (!Number.isNaN(parsed.getTime())) {
        (where.paidAt as Prisma.DateTimeFilter).gte = parsed;
      }
    }
    if (input.dateTo) {
      const parsed = new Date(input.dateTo);
      if (!Number.isNaN(parsed.getTime())) {
        (where.paidAt as Prisma.DateTimeFilter).lte = parsed;
      }
    }
  }
  const batches = await prisma.referralPayoutBatch.findMany({
    where,
    orderBy: { paidAt: "desc" },
    skip,
    take: pageSize + 1,
  });
  const hasMore = batches.length > pageSize;
  const slice = hasMore ? batches.slice(0, pageSize) : batches;
  return {
    items: slice.map<AdminReferralBatch>((batch) => ({
      id: batch.id,
      referrerWallet: batch.referrerWallet,
      adminWalletAddress: batch.adminWalletAddress,
      totalLamports: toNumber(batch.totalLamports),
      referralCount: batch.referralCount,
      paidAtIso: batch.paidAt.toISOString(),
    })),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function getAdminReferrerDetail(input: {
  walletAddress: string;
  referrerWallet: string;
}): Promise<AdminReferrerDetail | null> {
  assertAdminWallet(input.walletAddress);
  const referrerWallet = normalizeWalletAddress(input.referrerWallet);
  if (!referrerWallet) return null;
  const accruals = await prisma.referralAccrual.findMany({
    where: { referrerWallet },
    orderBy: { createdAt: "desc" },
  });
  if (accruals.length === 0) return null;
  const refereeBreakdownMap = new Map<
    string,
    { earned: bigint; paid: bigint }
  >();
  for (const accrual of accruals) {
    const current =
      refereeBreakdownMap.get(accrual.refereeWallet) ??
      { earned: 0n, paid: 0n };
    current.earned += accrual.amountLamports;
    if (accrual.status === "CLAIMED") current.paid += accrual.amountLamports;
    refereeBreakdownMap.set(accrual.refereeWallet, current);
  }
  const totalAccruedLamports = accruals.reduce(
    (sum, a) => sum + a.amountLamports,
    0n
  );
  const paidOutLamports = accruals
    .filter((a) => a.status === "CLAIMED")
    .reduce((sum, a) => sum + a.amountLamports, 0n);

  const batches = await prisma.referralPayoutBatch.findMany({
    where: { referrerWallet },
    orderBy: { paidAt: "desc" },
  });

  return {
    referrerWallet,
    referredWallets: refereeBreakdownMap.size,
    totalAccruedLamports: toNumber(totalAccruedLamports),
    paidOutLamports: toNumber(paidOutLamports),
    balanceDueLamports: toNumber(totalAccruedLamports - paidOutLamports),
    batches: batches.map<AdminReferralBatch>((batch) => ({
      id: batch.id,
      referrerWallet: batch.referrerWallet,
      adminWalletAddress: batch.adminWalletAddress,
      totalLamports: toNumber(batch.totalLamports),
      referralCount: batch.referralCount,
      paidAtIso: batch.paidAt.toISOString(),
    })),
    refereeBreakdown: Array.from(refereeBreakdownMap.entries())
      .map<ReferredWalletContribution>(([wallet, totals]) => ({
        walletAddress: wallet,
        totalEarnedLamports: toNumber(totals.earned),
        paidOutLamports: toNumber(totals.paid),
        balanceDueLamports: toNumber(totals.earned - totals.paid),
      }))
      .sort((left, right) => right.totalEarnedLamports - left.totalEarnedLamports),
    activeAccruals: accruals
      .filter((a) => a.status !== "CLAIMED")
      .map<AdminSessionReferralDetail>((accrual) => ({
        id: accrual.id,
        referrerWallet: accrual.referrerWallet,
        refereeWallet: accrual.refereeWallet,
        status:
          accrual.status === "CLAIMED"
            ? "claimed"
            : accrual.status === "CLAIMABLE"
              ? "claimable"
              : "pending",
        amountLamports: toNumber(accrual.amountLamports),
        createdAtIso: accrual.createdAt.toISOString(),
        claimableAtIso: accrual.claimableAt?.toISOString() ?? null,
        claimedAtIso: accrual.claimedAt?.toISOString() ?? null,
      })),
  };
}

export async function bulkPayoutReferrals(input: {
  adminWalletAddress: string;
  referrerWallets: string[];
}) {
  assertAdminWallet(input.adminWalletAddress);
  const referrers = Array.from(
    new Set(
      input.referrerWallets
        .map((wallet) => normalizeWalletAddress(wallet))
        .filter((wallet): wallet is string => Boolean(wallet))
    )
  );
  if (referrers.length === 0) {
    throw new Error("Provide at least one referrer wallet to pay out.");
  }
  return prisma.$transaction(async (tx) => {
    const results: { referrerWallet: string; totalLamports: number }[] = [];
    for (const referrerWallet of referrers) {
      const accruals = await tx.referralAccrual.findMany({
        where: { referrerWallet, status: "CLAIMABLE" },
      });
      if (accruals.length === 0) continue;
      const totalLamports = accruals.reduce(
        (sum, a) => sum + a.amountLamports,
        0n
      );
      const batch = await tx.referralPayoutBatch.create({
        data: {
          referrerWallet,
          adminWalletAddress: input.adminWalletAddress,
          totalLamports,
          referralCount: new Set(accruals.map((a) => a.refereeWallet)).size,
          metadataJson: JSON.stringify({
            accrualIds: accruals.map((a) => a.id),
            bulk: true,
          }),
        },
      });
      await tx.referralAccrual.updateMany({
        where: { id: { in: accruals.map((a) => a.id) } },
        data: {
          status: "CLAIMED",
          claimedAt: batch.paidAt,
          payoutBatchId: batch.id,
        },
      });
      results.push({
        referrerWallet,
        totalLamports: Number(totalLamports),
      });
    }
    await tx.transactionLog.create({
      data: {
        walletAddress: input.adminWalletAddress,
        kind: "admin_payout_referrals_bulk",
        amountLamports: results.reduce(
          (sum, row) => sum + BigInt(row.totalLamports),
          0n
        ),
        metadataJson: JSON.stringify({
          payoutCount: results.length,
          payloadSnapshot: { referrerWallets: referrers },
          results,
        }),
      },
    });
    return { results };
  });
}

export async function listAdminRewards(input: {
  walletAddress: string;
  status?: string | null;
  kind?: string | null;
  sessionId?: string | null;
  walletFilter?: string | null;
  cursor?: string | null;
  pageSize?: number | null;
}): Promise<AdminRewardListResponse> {
  assertAdminWallet(input.walletAddress);
  const pageSize = Math.min(
    Math.max(input.pageSize ?? ADMIN_LIST_PAGE_SIZE, 1),
    500
  );
  const { skip } = decodeListCursor(input.cursor ?? null);
  const where: Prisma.RewardInventoryWhereInput = {};
  if (input.status) {
    const map: Record<string, RewardStatus> = {
      assigned: "ASSIGNED",
      claimable: "CLAIMABLE",
      claimed: "CLAIMED",
    };
    const mapped = map[input.status.toLowerCase()];
    if (mapped) where.status = mapped;
  }
  if (input.kind) {
    try {
      where.kind = parseRewardKind(input.kind);
    } catch {
      // ignore unknown kind
    }
  }
  if (input.sessionId) where.sessionId = input.sessionId;
  if (input.walletFilter) where.walletAddress = input.walletFilter;

  const items = await prisma.rewardInventory.findMany({
    where,
    orderBy: { assignedAt: "desc" },
    skip,
    take: pageSize + 1,
    include: { session: { select: { title: true } } },
  });
  const hasMore = items.length > pageSize;
  const slice = hasMore ? items.slice(0, pageSize) : items;
  return {
    items: slice.map<AdminRewardItem>((reward) => ({
      id: reward.id,
      walletAddress: reward.walletAddress,
      sessionId: reward.sessionId,
      sessionTitle: reward.session?.title ?? null,
      kind: mapRewardKind(reward.kind),
      title: reward.title,
      subtitle: reward.subtitle,
      status: mapRewardStatus(reward.status),
      assignedAtIso: reward.assignedAt.toISOString(),
      claimedAtIso: reward.claimedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}

export async function bulkAssignRewards(input: {
  adminWalletAddress: string;
  items: Array<{
    targetWalletAddress: string;
    title: string;
    subtitle: string;
    kind: RewardInventoryItem["kind"];
    sessionId?: string | null;
  }>;
}) {
  assertAdminWallet(input.adminWalletAddress);
  if (input.items.length === 0) {
    throw new Error("Provide at least one reward to assign.");
  }
  const items = input.items.map((item) => ({
    targetWalletAddress:
      normalizeWalletAddress(item.targetWalletAddress) ?? "",
    title: item.title.trim(),
    subtitle: item.subtitle.trim(),
    kind: parseRewardKind(item.kind),
    sessionId: item.sessionId?.trim() || null,
  }));
  for (const item of items) {
    if (!item.targetWalletAddress) {
      throw new Error("Each reward item needs a valid target wallet.");
    }
    if (!item.title) throw new Error("Each reward item needs a title.");
    if (!item.subtitle) throw new Error("Each reward item needs a subtitle.");
  }
  return prisma.$transaction(async (tx) => {
    const fallbackSessionId = await getPrimarySessionId(tx);
    const assignedIds: string[] = [];
    for (const item of items) {
      const sessionId = item.sessionId ?? fallbackSessionId;
      const participant = await tx.sessionParticipant.findUnique({
        where: {
          sessionId_walletAddress: {
            sessionId,
            walletAddress: item.targetWalletAddress,
          },
        },
      });
      if (!participant) {
        throw new Error(
          `Wallet ${item.targetWalletAddress} has not joined session ${sessionId}.`
        );
      }
      const created = await tx.rewardInventory.create({
        data: {
          participantId: participant.id,
          walletAddress: participant.walletAddress,
          sessionId,
          kind: item.kind,
          title: item.title,
          subtitle: item.subtitle,
          status: "ASSIGNED",
        },
      });
      assignedIds.push(created.id);
    }
    await tx.transactionLog.create({
      data: {
        walletAddress: input.adminWalletAddress,
        kind: "admin_assign_reward_bulk",
        metadataJson: JSON.stringify({
          payloadSnapshot: { itemCount: items.length },
          assignedIds,
        }),
      },
    });
    return { assignedCount: assignedIds.length };
  });
}

export async function getAdminAnalytics(input: {
  walletAddress: string;
  from?: string | null;
  to?: string | null;
}): Promise<AdminAnalytics> {
  assertAdminWallet(input.walletAddress);
  const range = parseAnalyticsRange({ from: input.from, to: input.to });
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const positions = await prisma.roundPosition.findMany({
    where: { submittedAt: { gte: range.from, lte: range.to } },
    select: { submittedAt: true, stakeLamports: true, feeLamports: true },
    take: 5000,
  });
  const joins = await prisma.sessionParticipant.findMany({
    where: { joinedAt: { gte: range.from, lte: range.to } },
    select: { joinedAt: true },
    take: 5000,
  });
  const sessionsInRange = await prisma.session.findMany({
    where: { endsAt: { gte: range.from, lte: range.to } },
    select: { endsAt: true, status: true },
  });

  const volumeMap = new Map<string, number>();
  const feesMap = new Map<string, number>();
  for (const position of positions) {
    const key = utcDayKey(position.submittedAt);
    volumeMap.set(
      key,
      (volumeMap.get(key) ?? 0) + Number(position.stakeLamports)
    );
    feesMap.set(
      key,
      (feesMap.get(key) ?? 0) + Number(position.feeLamports)
    );
  }
  const joinsMap = new Map<string, number>();
  for (const entry of joins) {
    const key = utcDayKey(entry.joinedAt);
    joinsMap.set(key, (joinsMap.get(key) ?? 0) + 1);
  }
  const expiryMap = new Map<string, { expired: number; total: number }>();
  for (const session of sessionsInRange) {
    const key = utcDayKey(session.endsAt);
    const current = expiryMap.get(key) ?? { expired: 0, total: 0 };
    current.total += 1;
    if (session.status === "EXPIRED") current.expired += 1;
    expiryMap.set(key, current);
  }
  const expiryRateMap = new Map<string, number>();
  for (const [key, totals] of expiryMap) {
    expiryRateMap.set(
      key,
      totals.total === 0 ? 0 : Math.round((totals.expired / totals.total) * 1000) / 10
    );
  }

  const referralAggregates = await prisma.referralAccrual.groupBy({
    by: ["referrerWallet", "refereeWallet", "status"],
    _sum: { amountLamports: true },
  });
  const referrerMap = new Map<
    string,
    {
      referees: Set<string>;
      total: bigint;
      paid: bigint;
    }
  >();
  for (const row of referralAggregates) {
    const current =
      referrerMap.get(row.referrerWallet) ??
      { referees: new Set<string>(), total: 0n, paid: 0n };
    current.referees.add(row.refereeWallet);
    const amount = row._sum.amountLamports ?? 0n;
    current.total += amount;
    if (row.status === "CLAIMED") current.paid += amount;
    referrerMap.set(row.referrerWallet, current);
  }
  const topReferrers: AdminTopReferrer[] = Array.from(referrerMap.entries())
    .map(([wallet, totals]) => ({
      referrerWallet: wallet,
      referredCount: totals.referees.size,
      balanceDueLamports: toNumber(totals.total - totals.paid),
      totalAccruedLamports: toNumber(totals.total),
    }))
    .sort((a, b) => b.balanceDueLamports - a.balanceDueLamports)
    .slice(0, 10);

  const recentRounds = await prisma.sessionRound.findMany({
    orderBy: { id: "desc" },
    take: 12,
    include: {
      pair: { select: { category: true } },
      session: { select: { title: true } },
    },
  });
  const sideDistribution: AdminSideDistributionPoint[] = recentRounds
    .reverse()
    .map((round) => ({
      roundId: round.id,
      sessionTitle: round.session.title,
      roundIndex: round.roundIndex,
      category: round.pair.category,
      sideACount: round.sideATotalEntries,
      sideBCount: round.sideBTotalEntries,
    }));

  return {
    rangeFromIso: fromIso,
    rangeToIso: toIso,
    volumeByDay: fillTimeSeries(fromIso, toIso, volumeMap),
    feesByDay: fillTimeSeries(fromIso, toIso, feesMap),
    joinsByDay: fillTimeSeries(fromIso, toIso, joinsMap),
    expiryRateByDay: fillTimeSeries(fromIso, toIso, expiryRateMap),
    topReferrers,
    sideDistribution,
  };
}

export async function getAdminOpsBoard(input: {
  walletAddress: string;
}): Promise<AdminOpsResponse> {
  assertAdminWallet(input.walletAddress);
  const now = new Date();
  const liveAndPending = await prisma.session.findMany({
    where: { status: { in: ["PENDING", "LIVE"] } },
    select: {
      id: true,
      title: true,
      chainSessionNumber: true,
      chainSessionAddress: true,
      status: true,
      endsAt: true,
      joinedWallets: true,
      totalEscrowLamports: true,
      protocolFeeAccruedLamports: true,
      rounds: {
        orderBy: { roundIndex: "asc" },
        select: {
          id: true,
          closesAt: true,
          status: true,
          roundIndex: true,
          sideARewardPerShare: true,
          sideBRewardPerShare: true,
          sideATotalEntries: true,
          sideBTotalEntries: true,
          pair: { select: { category: true } },
        },
      },
    },
  });

  const staleRounds: AdminOpsRoundRow[] = [];
  const sweepableRounds: AdminOpsRoundRow[] = [];
  const finalizableSessions: AdminOpsSessionRow[] = [];
  const withdrawableSessions: AdminOpsSessionRow[] = [];

  for (const session of liveAndPending) {
    for (const round of session.rounds) {
      if (
        round.closesAt &&
        round.closesAt < now &&
        round.status !== "CLOSED" &&
        round.status !== "SKIPPED"
      ) {
        staleRounds.push({
          sessionId: session.id,
          sessionTitle: session.title,
          chainSessionNumber:
            session.chainSessionNumber == null
              ? null
              : session.chainSessionNumber.toString(),
          chainSessionAddress: session.chainSessionAddress,
          roundId: round.id,
          roundIndex: round.roundIndex,
          category: round.pair.category,
          closesAtIso: round.closesAt?.toISOString() ?? null,
          status: mapRoundStatus(round.status),
        });
      }
    }
    if (session.status === "LIVE" && session.endsAt < now) {
      finalizableSessions.push({
        sessionId: session.id,
        sessionTitle: session.title,
        chainSessionNumber:
          session.chainSessionNumber == null
            ? null
            : session.chainSessionNumber.toString(),
        chainSessionAddress: session.chainSessionAddress,
        status: mapSessionStatus(session.status),
        endsAtIso: session.endsAt.toISOString(),
        joinedWallets: session.joinedWallets,
        totalEscrowLamports: toNumber(session.totalEscrowLamports),
        protocolFeeAccruedLamports: toNumber(
          session.protocolFeeAccruedLamports
        ),
      });
    }
  }

  const completed = await prisma.session.findMany({
    where: { status: "COMPLETED" },
    select: {
      id: true,
      title: true,
      chainSessionNumber: true,
      chainSessionAddress: true,
      status: true,
      endsAt: true,
      joinedWallets: true,
      totalEscrowLamports: true,
      protocolFeeAccruedLamports: true,
      rounds: {
        orderBy: { roundIndex: "asc" },
        select: {
          id: true,
          closesAt: true,
          status: true,
          roundIndex: true,
          sideARewardPerShare: true,
          sideBRewardPerShare: true,
          sideATotalEntries: true,
          sideBTotalEntries: true,
          pair: { select: { category: true } },
        },
      },
    },
    take: 25,
    orderBy: { completedAt: "desc" },
  });

  for (const session of completed) {
    for (const round of session.rounds) {
      if (
        round.status === "CLOSED" &&
        round.sideARewardPerShare === 0n &&
        round.sideBRewardPerShare === 0n &&
        (round.sideATotalEntries > 0 || round.sideBTotalEntries > 0)
      ) {
        sweepableRounds.push({
          sessionId: session.id,
          sessionTitle: session.title,
          chainSessionNumber:
            session.chainSessionNumber == null
              ? null
              : session.chainSessionNumber.toString(),
          chainSessionAddress: session.chainSessionAddress,
          roundId: round.id,
          roundIndex: round.roundIndex,
          category: round.pair.category,
          closesAtIso: round.closesAt?.toISOString() ?? null,
          status: mapRoundStatus(round.status),
        });
      }
    }
    if (session.protocolFeeAccruedLamports > 0n) {
      withdrawableSessions.push({
        sessionId: session.id,
        sessionTitle: session.title,
        chainSessionNumber:
          session.chainSessionNumber == null
            ? null
            : session.chainSessionNumber.toString(),
        chainSessionAddress: session.chainSessionAddress,
        status: mapSessionStatus(session.status),
        endsAtIso: session.endsAt.toISOString(),
        joinedWallets: session.joinedWallets,
        totalEscrowLamports: toNumber(session.totalEscrowLamports),
        protocolFeeAccruedLamports: toNumber(
          session.protocolFeeAccruedLamports
        ),
      });
    }
  }

  return {
    staleRounds,
    finalizableSessions,
    sweepableRounds,
    withdrawableSessions,
  };
}

export async function syncAllActiveSessions(input: {
  adminWalletAddress: string;
}) {
  assertAdminWallet(input.adminWalletAddress);
  const sessions = await prisma.session.findMany({
    where: { status: { in: ["PENDING", "LIVE"] } },
    select: { id: true },
  });
  let synced = 0;
  for (const session of sessions) {
    await prisma
      .$transaction(async (tx) => {
        await syncSessionState(tx, session.id);
      })
      .then(() => {
        synced += 1;
      })
      .catch(() => null);
  }
  await prisma.transactionLog.create({
    data: {
      walletAddress: input.adminWalletAddress,
      kind: "admin_sync_sessions",
      metadataJson: JSON.stringify({
        sessionCount: sessions.length,
        syncedCount: synced,
      }),
    },
  });
  return { sessionCount: sessions.length, syncedCount: synced };
}

export async function listJoinableSessions(input?: { cursor?: string | null }) {
  const { skip } = decodeListCursor(input?.cursor ?? null);
  const pageSize = 20;
  const rows = await prisma.session.findMany({
    where: { status: { in: ["PENDING", "LIVE"] } },
    orderBy: [{ createdAt: "desc" }],
    take: pageSize + 1,
    skip,
  });
  const hasMore = rows.length > pageSize;
  const items = (hasMore ? rows.slice(0, pageSize) : rows).map<AdminSessionCard>(
    (sessionRecord) => ({
      id: sessionRecord.id,
      title: sessionRecord.title,
      status: mapSessionStatus(sessionRecord.status),
      startsAtIso: sessionRecord.startsAt.toISOString(),
      endsAtIso: sessionRecord.endsAt.toISOString(),
      walletsJoined: sessionRecord.joinedWallets,
      totalEscrowLamports: toNumber(sessionRecord.totalEscrowLamports),
      buyInLamports: toNumber(sessionRecord.buyInLamports),
      chainSessionNumber:
        sessionRecord.chainSessionNumber == null
          ? null
          : sessionRecord.chainSessionNumber.toString(),
      chainSessionAddress: sessionRecord.chainSessionAddress ?? null,
      chainDeployTxSignature: sessionRecord.chainDeployTxSignature ?? null,
      createdAtIso: sessionRecord.createdAt.toISOString(),
    })
  );
  return {
    items,
    nextCursor: hasMore ? encodeListCursor(skip + pageSize) : null,
  };
}
