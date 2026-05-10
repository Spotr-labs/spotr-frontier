import { prisma } from "./db";
import { publicSpotrConfig } from "../spotr-config/public";
import { executeSessionJoin } from "./session-join";
import { executeRoundDeposit } from "./round-deposit";
import { ensureUserVaultInitialized, mintUsdcToVault } from "./test-wallet-funding";
import {
  readAutoFillBotsConfig,
  shouldScheduleAutoFill,
} from "./auto-fill-bots.shared";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function scheduleAutoFillForRound(summary: {
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
  const scheduledAt = new Date(Date.now() + config.initialDelayMs);
  void prisma.sessionRound.update({
    where: { id: summary.roundId },
    data: {
      autoFillScheduledAt: scheduledAt,
      autoFillStartedAt: null,
      autoFillCompletedAt: null,
      autoFillLastError: null,
    },
  }).catch((error) => {
    console.error("[SPOTR] failed to persist auto-fill schedule:", error);
  });

  console.log(
    `[SPOTR] scheduled auto-fill for round ${summary.roundId} on ${publicSpotrConfig.cluster} at ${scheduledAt.toISOString()}`,
  );
  return true;
}

export async function fillRoundWithBots(params: {
  roundId: string;
  trickleDelayMs?: number;
  depositLamports?: bigint;
}) {
  const config = readAutoFillBotsConfig();
  const trickleDelayMs =
    params.trickleDelayMs ?? config.trickleDelayMs;
  const depositLamports = params.depositLamports ?? config.depositLamports;
  const botWallets = config.botWallets;

  while (true) {
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
        `[SPOTR] auto-fill complete/stopped for round ${params.roundId}: ${round.status} ${round.depositsCount}/${round.session.roundFillThreshold}`,
      );
      return;
    }

    const depositedWallets = new Set(round.deposits.map((deposit) => deposit.walletAddress));
    const walletAddress = botWallets.find((wallet) => !depositedWallets.has(wallet));
    if (!walletAddress) {
      throw new Error(
        `Auto-fill bot wallet pool exhausted for round ${round.id}. Provide at least ${round.session.roundFillThreshold - 1} bot wallets in SPOTR_AUTO_FILL_BOT_WALLETS.`,
      );
    }
    const fundingLamports = round.session.buyInLamports + depositLamports;

    await ensureUserVaultInitialized(walletAddress);
    await mintUsdcToVault(walletAddress, fundingLamports);
    await executeSessionJoin({
      walletAddress,
      sessionId: round.session.id,
      actor: "bot",
    });
    await executeRoundDeposit({
      walletAddress,
      roundId: round.id,
      amountLamports: depositLamports,
      actor: "bot",
    });

    console.log(
      `[SPOTR] bot deposited into round ${round.id}: wallet=${walletAddress} amount=${depositLamports.toString()}`,
    );

    if (trickleDelayMs > 0) {
      await sleep(trickleDelayMs);
    }
  }
}

export async function processDueAutoFillForSession(sessionId: string) {
  const config = readAutoFillBotsConfig();
  if (!config.enabled) return;

  while (true) {
    const dueRound = await prisma.sessionRound.findFirst({
      where: {
        sessionId,
        status: "UPCOMING",
        autoFillScheduledAt: { lte: new Date() },
        autoFillCompletedAt: null,
        autoFillStartedAt: null,
      },
      orderBy: { roundIndex: "asc" },
      select: { id: true },
    });

    if (!dueRound) return;

    const claim = await prisma.sessionRound.updateMany({
      where: {
        id: dueRound.id,
        autoFillScheduledAt: { lte: new Date() },
        autoFillCompletedAt: null,
        autoFillStartedAt: null,
      },
      data: {
        autoFillStartedAt: new Date(),
        autoFillLastError: null,
      },
    });
    if (claim.count === 0) continue;

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SPOTR] auto-fill job failed:", error);
      await prisma.sessionRound.update({
        where: { id: dueRound.id },
        data: {
          autoFillStartedAt: null,
          autoFillScheduledAt: new Date(Date.now() + config.initialDelayMs),
          autoFillLastError: message.slice(0, 500),
        },
      });
      return;
    }
  }
}
