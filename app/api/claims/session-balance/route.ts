import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { claimSpotrSessionBalance } from "../../../lib/server/spotr-store";
import {
  PrivyAuthError,
  getPlayerWalletFromRequest,
} from "../../../lib/server/privy-auth";
import {
  loadSponsorSigner,
  submitSponsoredTx,
} from "../../../lib/server/sponsor-tx";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../lib/server/rate-limit";
import { ValidationError } from "../../../lib/server/validators";
import { prisma } from "../../../lib/server/db";
import { findSpotrSessionPda } from "../../../lib/chain/session-pda";
import { getClaimSessionBalanceInstructionAsync } from "../../../generated/spotr/instructions/claimSessionBalance";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const walletAddress = await getPlayerWalletFromRequest(request);
    consumeSignedActionToken(walletAddress, "claims/session-balance");

    const playerAddr = address(walletAddress);
    const cluster = publicSpotrConfig.cluster;

    const participants = await prisma.sessionParticipant.findMany({
      where: {
        walletAddress,
        remainingEscrowLamports: { gt: 0n },
        session: { status: { in: ["COMPLETED", "EXPIRED"] } },
      },
      include: {
        session: {
          select: { chainSessionNumber: true },
        },
      },
    });

    const sponsor = await loadSponsorSigner();
    let submitted = 0;

    for (const participant of participants) {
      const chainNum = participant.session.chainSessionNumber;
      if (chainNum == null) continue;
      const sessionNumber = BigInt(chainNum.toString());
      const [sessionAddress] = await findSpotrSessionPda(sessionNumber);

      const ix = await getClaimSessionBalanceInstructionAsync({
        sponsor,
        player: playerAddr,
        session: sessionAddress,
      });

      try {
        await submitSponsoredTx(cluster, [ix]);
        submitted += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // SessionStillInProgress / VaultLocked are benign races — leave
        // the DB row alone; subsequent calls will reconcile.
        if (
          !msg.includes("SessionStillInProgress") &&
          !msg.includes("VaultLocked")
        ) {
          throw err;
        }
      }
    }

    const responsePayload = await claimSpotrSessionBalance({ walletAddress });
    return NextResponse.json({
      ...responsePayload,
      sponsoredTxCount: submitted,
    });
  } catch (error) {
    if (error instanceof PrivyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to claim session balance.",
      },
      { status: 400 },
    );
  }
}
