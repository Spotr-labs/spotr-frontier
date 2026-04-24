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
  AdminPairLibraryItem,
  AdminParticipant,
  AdminReferralBalance,
  AdminSessionCard,
  AdminSummary,
  FaultLinePair,
  LiveSessionSnapshot,
  ProfileSummary,
  ReferredWalletContribution,
  RecentReward,
  RewardInventoryItem,
  SessionRoundSummary,
  SpotrDashboardPayload,
  SpotrPublicConfig,
  SpotrSide,
} from "../spotr-types";
import { prisma } from "./db";
import { launchFaultLineSeeds } from "./launch-seed";

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

function getSessionWindowForDate(anchor: Date, config: SpotrPublicConfig) {
  const startsAt = new Date(anchor);
  startsAt.setUTCHours(config.defaultSessionStartHourUtc, 0, 0, 0);

  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(config.defaultSessionEndHourUtc, 0, 0, 0);
  if (endsAt <= startsAt) {
    endsAt.setUTCDate(endsAt.getUTCDate() + 1);
  }

  return { startsAt, endsAt };
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

function getNextDeployWindow(config: SpotrPublicConfig, reference = new Date()) {
  const current = new Date(reference);
  const todayWindow = getSessionWindowForDate(current, config);
  if (current < todayWindow.startsAt) {
    return todayWindow;
  }
  if (current < todayWindow.endsAt) {
    return {
      startsAt: current,
      endsAt: todayWindow.endsAt,
    };
  }

  const nextDay = new Date(current);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return getSessionWindowForDate(nextDay, config);
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

async function syncFaultLineSeeds(tx: Tx) {
  for (const pair of launchFaultLineSeeds) {
    await tx.faultLinePair.upsert({
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

  return tx.faultLinePair.findMany({ orderBy: { createdAt: "asc" } });
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
        roundIndex: index + 1,
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
      buyInLamports: BigInt(publicSpotrConfig.sessionBuyInLamports),
      roundStakeLamports: BigInt(publicSpotrConfig.roundMinStakeLamports),
      protocolFeeBps: publicSpotrConfig.protocolFeeBps,
      referralCutBps: publicSpotrConfig.referralCutBps,
      minWallets: publicSpotrConfig.sessionMinWallets,
      minTotalLamports: BigInt(publicSpotrConfig.sessionMinTotalLamports),
      cardRewardSlots: publicSpotrConfig.cardRewardSlots,
      payoutCadenceDays: publicSpotrConfig.payoutCadenceDays,
    },
  });

  await rebuildSessionRounds(tx, session.id, input.pairIds);
  return session.id;
}

async function ensureLaunchSession(tx: Tx, config: SpotrPublicConfig) {
  await syncFaultLineSeeds(tx);
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
    "sideARewardPerShare" | "sideBRewardPerShare"
  >,
  position: Pick<
    Prisma.RoundPositionGetPayload<object>,
    "side" | "shares" | "rewardDebtLamports" | "claimedLamports"
  >
) {
  const rewardPerShare =
    position.side === PositionSide.A
      ? round.sideARewardPerShare
      : round.sideBRewardPerShare;
  const totalEntitlement = (position.shares * rewardPerShare) / REWARD_SCALE;
  const pending =
    totalEntitlement - position.rewardDebtLamports - position.claimedLamports;

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
  let session = await loadSessionWithRounds(tx, sessionId);

  const participantAggregate = await tx.sessionParticipant.aggregate({
    where: { sessionId },
    _count: { _all: true },
    _sum: { totalEscrowLamports: true },
  });

  const joinedWallets = participantAggregate._count._all;
  const totalEscrowLamports = participantAggregate._sum.totalEscrowLamports ?? 0n;
  const thresholdMet =
    joinedWallets >= session.minWallets ||
    totalEscrowLamports >= session.minTotalLamports;

  let activatedAt = session.activatedAt;
  if (!activatedAt && thresholdMet) {
    activatedAt = now < session.startsAt ? session.startsAt : now;
  }

  if (activatedAt) {
    for (const round of session.rounds) {
      const opensAt = new Date(
        activatedAt.getTime() +
          (round.roundIndex - 1) * session.roundDurationSeconds * 1000
      );
      const closesAt = new Date(opensAt.getTime() + session.roundDurationSeconds * 1000);
      if (
        round.opensAt?.toISOString() !== opensAt.toISOString() ||
        round.closesAt?.toISOString() !== closesAt.toISOString()
      ) {
        await tx.sessionRound.update({
          where: { id: round.id },
          data: { opensAt, closesAt },
        });
      }
    }
  }

  let nextStatus: PrismaSessionStatus = "PENDING";
  if (!thresholdMet && now > session.endsAt) {
    nextStatus = "EXPIRED";
  } else if (activatedAt) {
    const sessionDurationMs = session.roundCount * session.roundDurationSeconds * 1000;
    const naturalCloseAt = new Date(activatedAt.getTime() + sessionDurationMs);
    const boundedCloseAt = naturalCloseAt < session.endsAt ? naturalCloseAt : session.endsAt;

    if (now >= boundedCloseAt) {
      nextStatus = "COMPLETED";
    } else if (now >= activatedAt) {
      nextStatus = "LIVE";
    }
  }

  if (
    session.joinedWallets !== joinedWallets ||
    session.totalEscrowLamports !== totalEscrowLamports ||
    session.status !== nextStatus ||
    session.activatedAt?.toISOString() !== activatedAt?.toISOString()
  ) {
    await tx.session.update({
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
    });
  }

  session = await loadSessionWithRounds(tx, sessionId);

  for (const round of session.rounds) {
    const derivedStatus = deriveRoundStatus(
      session.status,
      round.opensAt,
      round.closesAt,
      now
    );
    if (round.status !== derivedStatus) {
      await tx.sessionRound.update({
        where: { id: round.id },
        data: { status: derivedStatus },
      });
    }
  }

  await promoteClaimableReferrals(tx, sessionId, now);

  return loadSessionWithRounds(tx, sessionId);
}

async function buildProfileSummary(
  tx: Tx,
  walletAddress: string,
  now: Date
): Promise<ProfileSummary> {
  const participants = await tx.sessionParticipant.findMany({
    where: { walletAddress },
    include: {
      session: true,
      positions: {
        include: {
          round: {
            include: {
              session: true,
            },
          },
        },
      },
      rewards: true,
    },
  });

  const referralAccruals = await tx.referralAccrual.findMany({
    where: { referrerWallet: walletAddress },
    orderBy: { createdAt: "desc" },
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
  normalizedWalletAddress?: string | null
): Promise<AdminSummary> {
  const authorized =
    normalizedWalletAddress != null &&
    serverSpotrConfig.adminWallets.includes(normalizedWalletAddress);

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
      take: 6,
    }),
  ]);

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

  const referralBalanceMap = new Map<
    string,
    {
      referees: Set<string>;
      totalAccruedLamports: bigint;
      paidOutLamports: bigint;
    }
  >();
  const referralRows = await tx.referralAccrual.findMany({
    orderBy: [{ createdAt: "desc" }],
  });
  for (const accrual of referralRows) {
    const current = referralBalanceMap.get(accrual.referrerWallet) ?? {
      referees: new Set<string>(),
      totalAccruedLamports: 0n,
      paidOutLamports: 0n,
    };
    current.referees.add(accrual.refereeWallet);
    current.totalAccruedLamports += accrual.amountLamports;
    if (accrual.status === "CLAIMED") {
      current.paidOutLamports += accrual.amountLamports;
    }
    referralBalanceMap.set(accrual.referrerWallet, current);
  }

  const referralBalances = Array.from(referralBalanceMap.entries())
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
    sessionHistory: sessionHistory.map<AdminSessionCard>((sessionRecord) => ({
      id: sessionRecord.id,
      title: sessionRecord.title,
      status: mapSessionStatus(sessionRecord.status),
      startsAtIso: sessionRecord.startsAt.toISOString(),
      endsAtIso: sessionRecord.endsAt.toISOString(),
      walletsJoined: sessionRecord.joinedWallets,
      totalEscrowLamports: toNumber(sessionRecord.totalEscrowLamports),
      chainSessionNumber:
        sessionRecord.chainSessionNumber == null
          ? null
          : sessionRecord.chainSessionNumber.toString(),
      chainSessionAddress: sessionRecord.chainSessionAddress ?? null,
      chainDeployTxSignature: sessionRecord.chainDeployTxSignature ?? null,
      createdAtIso: sessionRecord.createdAt.toISOString(),
    })),
    referralBalances,
  };
}

async function buildDashboardPayload(tx: Tx, normalizedWalletAddress?: string | null) {
  const sessionId = await getPrimarySessionId(tx);
  const session = await syncSessionState(tx, sessionId);
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

  const rounds: SessionRoundSummary[] = session.rounds.map((round) => {
    const derivedStatus = deriveRoundStatus(
      session.status,
      round.opensAt,
      round.closesAt,
      now
    );
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
    },
    profile: normalizedWalletAddress
      ? await buildProfileSummary(tx, normalizedWalletAddress, now)
      : null,
    admin: await buildAdminSummary(tx, session.id, normalizedWalletAddress),
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

export async function getSpotrDashboardPayload(walletAddress?: string | null) {
  return prisma.$transaction((tx) =>
    buildDashboardPayload(tx, normalizeWalletAddress(walletAddress))
  );
}

export async function joinSpotrSession(input: {
  walletAddress: string;
  referrerWallet?: string | null;
  chainTxSignature: string;
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to join the session.");
  }
  if (!input.chainTxSignature) {
    throw new Error("A confirmed on-chain transaction signature is required.");
  }

  const sessionId = await getPrimarySessionId(prisma);
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

  const { verifyJoinSessionTx } = await import("./chain-verifier");
  const verified = await verifyJoinSessionTx({
    cluster: publicSpotrConfig.cluster,
    signature: input.chainTxSignature,
    expectedPlayer: walletAddress,
    expectedSessionNumber: BigInt(sessionForChain.chainSessionNumber.toString()),
  });
  if (verified.sessionAddress !== sessionForChain.chainSessionAddress) {
    throw new Error(
      "On-chain session PDA does not match the deployed session record."
    );
  }

  return prisma.$transaction(async (tx) => {
    const session = await syncSessionState(tx, sessionId);
    const now = new Date();

    if (session.status === "EXPIRED" || session.status === "COMPLETED") {
      throw new Error("This session is not joinable anymore.");
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
        existingParticipant.chainJoinTxSignature !== input.chainTxSignature
      ) {
        throw new Error(
          "This wallet has already joined with a different on-chain transaction."
        );
      }
      if (!existingParticipant.chainJoinTxSignature) {
        await tx.sessionParticipant.update({
          where: { id: existingParticipant.id },
          data: { chainJoinTxSignature: input.chainTxSignature },
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
          chainJoinTxSignature: input.chainTxSignature,
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
            chainTxSignature: input.chainTxSignature,
            chainSlot: verified.slot,
          }),
        },
      });
    }

    return buildDashboardPayload(tx, walletAddress);
  });
}

export async function enterSpotrRoundPosition(input: {
  walletAddress: string;
  roundId: string;
  side: SpotrSide;
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to enter a round.");
  }
  if (input.side !== "A" && input.side !== "B") {
    throw new Error("Side must be either A or B.");
  }

  return prisma.$transaction(async (tx) => {
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

    if (participant.remainingEscrowLamports < session.roundStakeLamports) {
      throw new Error("Not enough escrow remains for another round.");
    }

    const referralRelationship = await ensureReferralRelationship(tx, participant);

    const stakeLamports = session.roundStakeLamports;
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

    await tx.sessionParticipant.update({
      where: { id: participant.id },
      data: {
        remainingEscrowLamports: participant.remainingEscrowLamports - stakeLamports,
      },
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

    return buildDashboardPayload(tx, walletAddress);
  });
}

export async function claimSpotrRoundProceeds(input: { walletAddress: string }) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to claim round proceeds.");
  }

  return prisma.$transaction(async (tx) => {
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

    return buildDashboardPayload(tx, walletAddress);
  });
}

export async function claimSpotrSessionBalance(input: { walletAddress: string }) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error("A wallet address is required to claim session balance.");
  }

  return prisma.$transaction(async (tx) => {
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

    return buildDashboardPayload(tx, walletAddress);
  });
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

  return prisma.$transaction(async (tx) => {
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
        kind: "import_pairs_csv",
        metadataJson: JSON.stringify({
          rows: rows.length,
        }),
      },
    });

    return buildDashboardPayload(tx, adminWalletAddress);
  });
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

  return prisma.$transaction(async (tx) => {
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
        kind: input.active ? "activate_pair" : "deactivate_pair",
        metadataJson: JSON.stringify({
          pairId,
          slug: pair.slug,
        }),
      },
    });

    return buildDashboardPayload(tx, adminWalletAddress);
  });
}

export async function deployAdminSession(input: {
  adminWalletAddress: string;
  title?: string | null;
  pairIds: string[];
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const title = input.title?.trim() ?? "";
  const pairIds = Array.from(
    new Set(input.pairIds.map((pairId) => pairId.trim()).filter(Boolean))
  );

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (pairIds.length !== publicSpotrConfig.roundCount) {
    throw new Error(
      `Select exactly ${publicSpotrConfig.roundCount} active pairs for a session.`
    );
  }

  return prisma.$transaction(async (tx) => {
    assertAdminWallet(adminWalletAddress);
    await syncFaultLineSeeds(tx);

    const unsettledSessionCount = await tx.session.count({
      where: {
        status: { in: ["PENDING", "LIVE"] },
      },
    });
    if (unsettledSessionCount > 0) {
      throw new Error("Complete or expire the current session before deploying another.");
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
    const { startsAt, endsAt } = getNextDeployWindow(publicSpotrConfig);
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
    });

    await tx.transactionLog.create({
      data: {
        sessionId,
        walletAddress: adminWalletAddress,
        kind: "deploy_session",
        metadataJson: JSON.stringify({
          pairIds,
          roundCount: pairIds.length,
        }),
      },
    });

    return buildDashboardPayload(tx, adminWalletAddress);
  });
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

  return prisma.$transaction(async (tx) => {
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
        kind: "payout_referrals",
        amountLamports: totalLamports,
        metadataJson: JSON.stringify({
          payoutBatchId: payoutBatch.id,
          referrerWallet,
          accrualIds: accruals.map((accrual) => accrual.id),
        }),
      },
    });

    return buildDashboardPayload(tx, adminWalletAddress);
  });
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

  return prisma.$transaction(async (tx) => {
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
        kind: "assign_reward",
        metadataJson: JSON.stringify({
          rewardId: reward.id,
          targetWalletAddress,
          kind: input.kind,
          title,
        }),
      },
    });

    return buildDashboardPayload(tx, adminWalletAddress);
  });
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

  return prisma.$transaction(async (tx) => {
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
        kind: "update_reward_status",
        metadataJson: JSON.stringify({
          rewardId,
          status: input.status,
          targetWalletAddress: reward.walletAddress,
        }),
      },
    });

    return buildDashboardPayload(tx, adminWalletAddress);
  });
}

export async function recordChainDeployedSession(input: {
  adminWalletAddress: string;
  sessionId: string;
  chainTxSignature: string;
  chainSessionNumber: string;
}) {
  const adminWalletAddress = normalizeWalletAddress(input.adminWalletAddress);
  const sessionId = input.sessionId.trim();
  const chainTxSignature = input.chainTxSignature.trim();
  const chainSessionNumberStr = input.chainSessionNumber.trim();

  if (!adminWalletAddress) {
    throw new Error("An admin wallet address is required.");
  }
  if (!sessionId) {
    throw new Error("sessionId is required.");
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

  assertAdminWallet(adminWalletAddress);

  const existing = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      chainSessionNumber: true,
      chainSessionAddress: true,
      chainDeployTxSignature: true,
    },
  });
  if (!existing) {
    throw new Error("Session does not exist.");
  }
  if (
    existing.chainSessionNumber != null &&
    existing.chainSessionNumber !== chainSessionNumber
  ) {
    throw new Error(
      "This Postgres session is already bound to a different on-chain session."
    );
  }

  const { verifyCreateSessionTx } = await import("./chain-verifier");
  const verified = await verifyCreateSessionTx({
    cluster: publicSpotrConfig.cluster,
    signature: chainTxSignature,
    expectedAdmin: adminWalletAddress,
    expectedSessionNumber: chainSessionNumber,
  });

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      chainSessionNumber,
      chainSessionAddress: verified.sessionAddress,
      chainDeployTxSignature: chainTxSignature,
    },
  });
  await prisma.transactionLog.create({
    data: {
      sessionId,
      walletAddress: adminWalletAddress,
      kind: "chain_deploy_session",
      metadataJson: JSON.stringify({
        chainTxSignature,
        chainSessionNumber: chainSessionNumber.toString(),
        chainSessionAddress: verified.sessionAddress,
        chainSlot: verified.slot,
      }),
    },
  });

  return prisma.$transaction((tx) =>
    buildDashboardPayload(tx, adminWalletAddress)
  );
}
