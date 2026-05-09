import { generateKeyPairSigner } from "@solana/kit";
import { prisma } from "./db";
import { publicSpotrConfig } from "../spotr-config/public";
import { executeSessionJoin } from "./session-join";
import { executeRoundDeposit } from "./round-deposit";
import { ensureUserVaultInitialized, mintUsdcToVault } from "./test-wallet-funding";
import {
  readAutoFillBotsConfig,
  shouldScheduleAutoFill,
} from "./auto-fill-bots.shared";

const scheduledRounds = new Map<string, ReturnType<typeof setTimeout>>();

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
  if (scheduledRounds.has(summary.roundId)) {
    return false;
  }

  console.log(
    `[SPOTR] scheduling auto-fill bots for round ${summary.roundId} on ${publicSpotrConfig.cluster} in ${config.initialDelayMs}ms`,
  );

  const timer = setTimeout(async () => {
    try {
      await fillRoundWithBots({
        roundId: summary.roundId,
        trickleDelayMs: config.trickleDelayMs,
        depositLamports: config.depositLamports,
      });
    } catch (error) {
      console.error("[SPOTR] auto-fill bot run failed:", error);
    } finally {
      scheduledRounds.delete(summary.roundId);
    }
  }, config.initialDelayMs);

  scheduledRounds.set(summary.roundId, timer);
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

    const signer = await generateKeyPairSigner();
    const walletAddress = String(signer.address);
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
