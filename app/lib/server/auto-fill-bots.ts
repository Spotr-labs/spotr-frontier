import { prisma } from "./db";
import { publicSpotrConfig } from "../spotr-config/public";
import { executeSessionJoin } from "./session-join";
import { executeRoundDeposit } from "./round-deposit";
import { SolanaTxError } from "../wallet/solana-errors";
import {
  ensureUserVaultInitialized,
  mintUsdcToVault,
} from "./test-wallet-funding";
import {
  AUTO_FILL_BOT_SUPPORTED_CLUSTERS,
  readAutoFillBotsConfig,
  shouldScheduleAutoFill,
} from "./auto-fill-bots.shared";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeAutoFillError(error: unknown) {
  if (error instanceof SolanaTxError) {
    return {
      message: error.message,
      code: error.code,
      hint: error.report.hint,
      logs: error.report.logs,
      category: error.report.category,
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

function isCurrentClusterSupported() {
  return AUTO_FILL_BOT_SUPPORTED_CLUSTERS.includes(
    publicSpotrConfig.cluster as (typeof AUTO_FILL_BOT_SUPPORTED_CLUSTERS)[number]
  );
}

export async function scheduleAutoFillForRound(summary: {
  roundId: string;
  sessionId: string;
  previousStatus: string;
  previousDepositsCount: number;
  newDepositsCount: number;
  fillThreshold: number;
  actor: "player" | "bot";
}) {
  const config = readAutoFillBotsConfig();
  if (
    !shouldScheduleAutoFill({
      enabled: config.enabled,
      cluster: publicSpotrConfig.cluster,
      actor: summary.actor,
      previousStatus: summary.previousStatus,
      previousDepositsCount: summary.previousDepositsCount,
      newDepositsCount: summary.newDepositsCount,
      fillThreshold: summary.fillThreshold,
    })
  ) {
    return false;
  }
  const now = new Date();
  const scheduledAt = new Date(now.getTime() + config.initialDelayMs);
  const staleStartedBefore = new Date(now.getTime() - config.workerLeaseMs);
  try {
    const result = await prisma.sessionRound.updateMany({
      where: {
        id: summary.roundId,
        autoFillCompletedAt: null,
        OR: [
          { autoFillScheduledAt: null },
          { autoFillLastError: { not: null } },
          { autoFillStartedAt: { lt: staleStartedBefore } },
        ],
      },
      data: {
        autoFillScheduledAt: scheduledAt,
        autoFillStartedAt: null,
        autoFillLastError: null,
      },
    });
    if (result.count === 0) {
      console.log(
        `[SPOTR] auto-fill already scheduled/running for round ${summary.roundId}`
      );
      return true;
    }

    console.log(
      `[SPOTR] scheduled auto-fill for round ${summary.roundId} on ${publicSpotrConfig.cluster} at ${scheduledAt.toISOString()}`
    );
    return true;
  } catch (error) {
    console.error("[SPOTR] failed to persist auto-fill schedule:", error);
    return false;
  }
}

const queuedAutoFillTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function queueDueAutoFillForRound(params: {
  roundId: string;
  sessionId: string;
  delayMs?: number;
}) {
  const config = readAutoFillBotsConfig();
  if (
    !config.enabled ||
    !isCurrentClusterSupported() ||
    queuedAutoFillTimers.has(params.roundId)
  ) {
    return false;
  }

  const timeout = setTimeout(() => {
    void processDueAutoFillForSession(params.sessionId)
      .catch((error) => {
        console.error("[SPOTR] queued auto-fill processing failed:", error);
      })
      .finally(() => {
        queuedAutoFillTimers.delete(params.roundId);
      });
  }, params.delayMs ?? config.initialDelayMs);

  const maybeNodeTimeout = timeout as ReturnType<typeof setTimeout> & {
    unref?: () => void;
  };
  maybeNodeTimeout.unref?.();
  queuedAutoFillTimers.set(params.roundId, timeout);
  return true;
}

export async function fillRoundWithBots(params: {
  roundId: string;
  trickleDelayMs?: number;
  depositLamports?: bigint;
}) {
  const config = readAutoFillBotsConfig();
  const trickleDelayMs = params.trickleDelayMs ?? config.trickleDelayMs;
  const depositLamports = params.depositLamports ?? config.depositLamports;
  const botWallets = config.botWallets;

  const round = await prisma.sessionRound.findUnique({
    where: { id: params.roundId },
    include: {
      session: {
        select: {
          id: true,
          buyInLamports: true,
          roundFillThreshold: true,
        },
      },
      deposits: {
        select: {
          walletAddress: true,
        },
      },
    },
  });

  if (!round) {
    console.warn(`[SPOTR] auto-fill round missing: ${params.roundId}`);
    return;
  }

  if (
    round.status !== "UPCOMING" ||
    round.depositsCount >= round.session.roundFillThreshold
  ) {
    console.log(
      `[SPOTR] auto-fill complete/stopped for round ${params.roundId}: ${round.status} ${round.depositsCount}/${round.session.roundFillThreshold}`
    );
    return;
  }

  const needed = round.session.roundFillThreshold - round.depositsCount;
  const depositedWallets = new Set(
    round.deposits.map((deposit) => deposit.walletAddress)
  );
  const candidateWallets = botWallets
    .filter((wallet) => !depositedWallets.has(wallet))
    .slice(0, needed);
  if (candidateWallets.length < needed) {
    throw new Error(
      `Auto-fill bot wallet pool exhausted for round ${round.id}. Provide at least ${needed} unused bot wallets in SPOTR_AUTO_FILL_BOT_WALLETS.`
    );
  }

  for (const walletAddress of candidateWallets) {
    console.log(
      `[SPOTR] auto-fill wallet starting: round=${params.roundId} wallet=${walletAddress}`
    );
    const currentRound = await prisma.sessionRound.findUnique({
      where: { id: params.roundId },
      include: {
        session: {
          select: {
            id: true,
            buyInLamports: true,
            roundFillThreshold: true,
          },
        },
      },
    });
    if (!currentRound) {
      console.warn(`[SPOTR] auto-fill round missing: ${params.roundId}`);
      return;
    }
    if (
      currentRound.status !== "UPCOMING" ||
      currentRound.depositsCount >= currentRound.session.roundFillThreshold
    ) {
      console.log(
        `[SPOTR] auto-fill complete/stopped for round ${params.roundId}: ${currentRound.status} ${currentRound.depositsCount}/${currentRound.session.roundFillThreshold}`
      );
      return;
    }
    const fundingLamports =
      currentRound.session.buyInLamports + depositLamports;

    console.log(
      `[SPOTR] auto-fill wallet vault init: round=${currentRound.id} wallet=${walletAddress}`
    );
    await ensureUserVaultInitialized(walletAddress);
    console.log(
      `[SPOTR] auto-fill wallet mint: round=${currentRound.id} wallet=${walletAddress} amount=${fundingLamports.toString()}`
    );
    await mintUsdcToVault(walletAddress, fundingLamports);
    console.log(
      `[SPOTR] auto-fill wallet join: round=${currentRound.id} wallet=${walletAddress}`
    );
    await executeSessionJoin({
      walletAddress,
      sessionId: currentRound.session.id,
      actor: "bot",
      returnPayload: false,
    });
    console.log(
      `[SPOTR] auto-fill wallet deposit: round=${currentRound.id} wallet=${walletAddress} amount=${depositLamports.toString()}`
    );
    await executeRoundDeposit({
      walletAddress,
      roundId: currentRound.id,
      amountLamports: depositLamports,
      actor: "bot",
      returnPayload: false,
    });

    console.log(
      `[SPOTR] bot deposited into round ${currentRound.id}: wallet=${walletAddress} amount=${depositLamports.toString()}`
    );

    if (trickleDelayMs > 0) {
      await sleep(trickleDelayMs);
    }
  }
}

export async function processDueAutoFillForSession(
  sessionId: string,
  options: { maxRounds?: number } = {}
) {
  const config = readAutoFillBotsConfig();
  if (!config.enabled || !isCurrentClusterSupported()) {
    return { processed: 0, claimed: 0 };
  }

  const maxRounds = Math.max(1, options.maxRounds ?? 1);
  let processed = 0;
  let claimed = 0;
  for (let attempt = 0; attempt < maxRounds; attempt += 1) {
    const now = new Date();
    const staleStartedBefore = new Date(now.getTime() - config.workerLeaseMs);
    const dueRound = await prisma.sessionRound.findFirst({
      where: {
        sessionId,
        status: "UPCOMING",
        autoFillScheduledAt: { lte: now },
        autoFillCompletedAt: null,
        OR: [
          { autoFillStartedAt: null },
          { autoFillStartedAt: { lt: staleStartedBefore } },
        ],
      },
      orderBy: { roundIndex: "asc" },
      select: { id: true },
    });

    if (!dueRound) return { processed, claimed };

    const claim = await prisma.sessionRound.updateMany({
      where: {
        id: dueRound.id,
        autoFillScheduledAt: { lte: now },
        autoFillCompletedAt: null,
        OR: [
          { autoFillStartedAt: null },
          { autoFillStartedAt: { lt: staleStartedBefore } },
        ],
      },
      data: {
        autoFillStartedAt: now,
        autoFillLastError: null,
      },
    });
    if (claim.count === 0) return { processed, claimed };
    claimed += 1;

    try {
      console.log(`[SPOTR] processing due auto-fill for round ${dueRound.id}`);
      await fillRoundWithBots({
        roundId: dueRound.id,
        trickleDelayMs: config.trickleDelayMs,
        depositLamports: config.depositLamports,
      });
      await prisma.sessionRound.update({
        where: { id: dueRound.id },
        data: {
          autoFillCompletedAt: new Date(),
          autoFillStartedAt: null,
          autoFillLastError: null,
        },
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SPOTR] auto-fill job failed:", describeAutoFillError(error));
      await prisma.sessionRound.update({
        where: { id: dueRound.id },
        data: {
          autoFillStartedAt: null,
          autoFillScheduledAt: new Date(Date.now() + config.initialDelayMs),
          autoFillLastError: message.slice(0, 500),
        },
      });
      return { processed, claimed };
    }
  }
  return { processed, claimed };
}
