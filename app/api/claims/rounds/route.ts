import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { claimSpotrRoundProceeds } from "../../../lib/server/spotr-store";
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
import { SolanaTxError } from "../../../lib/wallet/solana-errors";
import { prisma } from "../../../lib/server/db";
import { findSpotrSessionPda } from "../../../lib/chain/session-pda";
import { findSpotrRoundPda } from "../../../lib/chain/round-pda";
import { getClaimRoundInstructionAsync } from "../../../generated/spotr/instructions/claimRound";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const walletAddress = await getPlayerWalletFromRequest(request);
    consumeSignedActionToken(walletAddress, "claims/rounds");

    const playerAddr = address(walletAddress);
    const cluster = publicSpotrConfig.cluster;

    // Pull every unclaimed round position whose session is in a settled
    // state (Completed/Expired). The on-chain `claim_round` check requires
    // `round.state == Closed`, but in our model the session-level status
    // reaching Completed/Expired is what permissionless `close_round`
    // listens for, so we rely on the DB-derived round status here.
    const positions = await prisma.roundPosition.findMany({
      where: {
        walletAddress,
        claimedAt: null,
        round: {
          session: {
            status: { in: ["COMPLETED", "EXPIRED"] },
          },
        },
      },
      include: {
        round: {
          select: {
            roundIndex: true,
            session: {
              select: {
                chainSessionNumber: true,
              },
            },
          },
        },
      },
    });

    const sponsor = await loadSponsorSigner();
    let submitted = 0;

    for (const pos of positions) {
      const chainNum = pos.round.session.chainSessionNumber;
      if (chainNum == null) continue;
      const sessionNumber = BigInt(chainNum.toString());
      const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
      const [roundAddress] = await findSpotrRoundPda({
        session: sessionAddress,
        index: pos.round.roundIndex,
      });

      const ix = await getClaimRoundInstructionAsync({
        sponsor,
        player: playerAddr,
        session: sessionAddress,
        round: roundAddress,
      });

      try {
        await submitSponsoredTx(cluster, [ix]);
        submitted += 1;
      } catch (err) {
        // AlreadyClaimed and RoundStillOpen are benign here — the on-chain
        // program is just telling us the position is already claimed or
        // the round hasn't been closed yet on-chain. Keep iterating and
        // let the DB state reconcile via the next call.
        if (
          err instanceof SolanaTxError &&
          (err.code === "SPOTR_ALREADY_CLAIMED" ||
            err.code === "SPOTR_ROUND_STILL_OPEN")
        ) {
          continue;
        }
        throw err;
      }
    }

    const responsePayload = await claimSpotrRoundProceeds({ walletAddress });
    return NextResponse.json({ ...responsePayload, sponsoredTxCount: submitted });
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
    if (error instanceof SolanaTxError) {
      return NextResponse.json(
        { error: error.report.message, code: error.code, hint: error.report.hint },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to claim round proceeds.",
      },
      { status: 400 },
    );
  }
}
