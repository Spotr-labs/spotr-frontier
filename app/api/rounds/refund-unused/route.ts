import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { refundUnusedSpotrDeposit } from "../../../lib/server/spotr-store";
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
import { getRefundUnusedDepositInstructionAsync } from "../../../generated/spotr/instructions/refundUnusedDeposit";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

type RefundBody = {
  roundId?: string;
};

export async function POST(request: Request) {
  try {
    const walletAddress = await getPlayerWalletFromRequest(request);
    consumeSignedActionToken(walletAddress, "rounds/refund-unused");

    const body = (await request.json()) as RefundBody;
    const roundId = typeof body.roundId === "string" ? body.roundId.trim() : "";
    if (!roundId) {
      return NextResponse.json({ error: "roundId is required." }, { status: 400 });
    }

    const round = await prisma.sessionRound.findUnique({
      where: { id: roundId },
      include: {
        session: {
          select: {
            id: true,
            chainSessionNumber: true,
          },
        },
      },
    });
    if (!round) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }
    if (round.session.chainSessionNumber == null) {
      return NextResponse.json(
        { error: "Session has not been deployed on-chain yet." },
        { status: 400 },
      );
    }

    const cluster = publicSpotrConfig.cluster;
    const sessionNumber = BigInt(round.session.chainSessionNumber.toString());
    const playerAddr = address(walletAddress);
    const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
    const [roundAddress] = await findSpotrRoundPda({
      session: sessionAddress,
      index: round.roundIndex,
    });

    const sponsor = await loadSponsorSigner();
    const ix = await getRefundUnusedDepositInstructionAsync({
      sponsor,
      player: playerAddr,
      session: sessionAddress,
      round: roundAddress,
    });

    const signature = await submitSponsoredTx(cluster, [ix]);

    const responsePayload = await refundUnusedSpotrDeposit({
      walletAddress,
      roundId,
      chainTxSignature: signature,
    });

    return NextResponse.json(responsePayload);
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
      { error: error instanceof Error ? error.message : "Failed to refund deposit." },
      { status: 400 },
    );
  }
}
