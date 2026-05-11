import { NextResponse } from "next/server";
import { prisma } from "../../../lib/server/db";
import { processDueAutoFillForSession } from "../../../lib/server/auto-fill-bots";
import {
  readAutoFillBotsConfig,
  shouldProcessAutoFillFromHeartbeat,
} from "../../../lib/server/auto-fill-bots.shared";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roundId = searchParams.get("roundId");
  if (!roundId) {
    return NextResponse.json({ error: "Missing roundId." }, { status: 400 });
  }

  try {
    const initialRound = await prisma.sessionRound.findUnique({
      where: { id: roundId },
      select: {
        sessionId: true,
        depositsCount: true,
        status: true,
        opensAt: true,
        autoFillScheduledAt: true,
        autoFillStartedAt: true,
        autoFillCompletedAt: true,
        autoFillLastError: true,
        deposits: {
          orderBy: { depositedAt: "asc" },
          select: { walletAddress: true },
        },
      },
    });
    if (!initialRound) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }

    const autoFillConfig = readAutoFillBotsConfig();
    if (
      shouldProcessAutoFillFromHeartbeat({
        enabled: autoFillConfig.enabled,
        cluster: publicSpotrConfig.cluster,
        status: initialRound.status,
        scheduledAt: initialRound.autoFillScheduledAt,
        completedAt: initialRound.autoFillCompletedAt,
      })
    ) {
      await processDueAutoFillForSession(initialRound.sessionId, { maxRounds: 1 });
    }

    const round = await prisma.sessionRound.findUnique({
      where: { id: roundId },
      select: {
        depositsCount: true,
        status: true,
        opensAt: true,
        autoFillScheduledAt: true,
        autoFillStartedAt: true,
        autoFillLastError: true,
        deposits: {
          orderBy: { depositedAt: "asc" },
          select: { walletAddress: true },
        },
      },
    });
    if (!round) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }

    return NextResponse.json({
      depositsCount: round.depositsCount,
      status: round.status,
      opensAtIso: round.opensAt?.toISOString() ?? null,
      autoFillScheduledAtIso: round.autoFillScheduledAt?.toISOString() ?? null,
      autoFillStartedAtIso: round.autoFillStartedAt?.toISOString() ?? null,
      autoFillLastError: round.autoFillLastError ?? null,
      depositorAddresses: round.deposits.map((deposit) => deposit.walletAddress),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load round heartbeat.",
      },
      { status: 500 }
    );
  }
}
