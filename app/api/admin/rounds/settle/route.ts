import { NextResponse } from "next/server";
import { AccountRole, address } from "@solana/kit";
import { recordChainSettleRound } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminSettleRoundPayload,
  parseSignedEnvelope,
} from "../../../../lib/server/validators";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../../lib/server/rate-limit";
import {
  loadSponsorSigner,
  submitSponsoredTx,
} from "../../../../lib/server/sponsor-tx";
import { prisma } from "../../../../lib/server/db";
import { findSpotrSessionPda } from "../../../../lib/chain/session-pda";
import { findSpotrRoundPda } from "../../../../lib/chain/round-pda";
import { findPositionPda } from "../../../../generated/spotr/pdas/position";
import { getSettleRoundInstructionAsync } from "../../../../generated/spotr/instructions/settleRound";
import { redistributeFinalPayouts } from "../../../../lib/server/redistribute";
import { publicSpotrConfig } from "../../../../lib/spotr-config/public";
import { SolanaTxError } from "../../../../lib/wallet/solana-errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const envelope = parseSignedEnvelope(body, parseAdminSettleRoundPayload);
    consumeSignedActionToken(envelope.walletAddress, "admin/rounds/settle");
    const { payload } = await verifySignedSpotrAction(
      "admin-settle-round",
      envelope
    );

    const round = await prisma.sessionRound.findUnique({
      where: { id: payload.roundId },
      include: {
        session: {
          select: { chainSessionNumber: true },
        },
      },
    });
    if (!round) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }
    if (!round.winningSide) {
      return NextResponse.json(
        { error: "Resolve the round before settling." },
        { status: 400 }
      );
    }
    if (round.redistributeApplied) {
      return NextResponse.json({ ok: true, alreadySettled: true });
    }
    if (round.session.chainSessionNumber == null) {
      return NextResponse.json(
        { error: "Session has not been deployed on-chain." },
        { status: 400 }
      );
    }

    // Pull the winning-side positions in deposit_index order. The on-chain
    // settle handler sorts internally too, but ordering them here means the
    // TS-side redistribute mirror can compute matching final payouts for
    // the DB write below.
    const winners = await prisma.roundPosition.findMany({
      where: { roundId: round.id, side: round.winningSide },
      orderBy: { depositIndex: "asc" },
      select: {
        id: true,
        walletAddress: true,
        netStakeLamports: true,
        depositIndex: true,
      },
    });
    if (winners.length === 0) {
      // Nothing to redistribute. Still mark the round settled so claim
      // attempts return cleanly.
      await prisma.sessionRound.update({
        where: { id: round.id },
        data: { redistributeApplied: true, settledAt: new Date() },
      });
      return NextResponse.json({ ok: true, positionCount: 0 });
    }

    // Build position PDAs in the same order. The on-chain handler accepts
    // them in any order (it sorts by deposit_index too) so we pass them as
    // is; the TS redistribute mirror runs on the same ordering.
    const sessionNumber = BigInt(round.session.chainSessionNumber.toString());
    const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
    const [roundAddress] = await findSpotrRoundPda({
      session: sessionAddress,
      index: round.roundIndex,
    });
    const positionAddresses = await Promise.all(
      winners.map(async (w) => {
        const [pda] = await findPositionPda({
          round: roundAddress,
          player: address(w.walletAddress),
        });
        return pda;
      })
    );

    // Build remaining_accounts and submit the on-chain ix.
    const sponsor = await loadSponsorSigner();
    const baseIx = await getSettleRoundInstructionAsync({
      authority: sponsor,
      session: sessionAddress,
      round: roundAddress,
    });
    const ix = {
      ...baseIx,
      accounts: [
        ...baseIx.accounts,
        ...positionAddresses.map((address) => ({
          address,
          role: AccountRole.WRITABLE,
        })),
      ],
    } as typeof baseIx;
    const cluster = publicSpotrConfig.cluster;
    const signature = await submitSponsoredTx(cluster, [ix]);

    // Compute the same redistributed final payouts in TS for the DB mirror.
    const totalNet = winners.reduce((acc, w) => acc + w.netStakeLamports, 0n);
    const pool = round.totalPoolLamports;
    if (totalNet === 0n) {
      return NextResponse.json(
        { error: "Winning side has zero total stake." },
        { status: 400 }
      );
    }
    const pmPayouts = winners.map(
      (w) => (w.netStakeLamports * pool) / totalNet
    );
    const finalPayouts = redistributeFinalPayouts(pmPayouts);

    await recordChainSettleRound({
      adminWalletAddress: payload.adminWalletAddress,
      sessionId: round.sessionId,
      roundId: round.id,
      finalPayouts: winners.map((w, i) => ({
        positionId: w.id,
        finalPayoutLamports: finalPayouts[i],
      })),
      chainTxSignature: signature,
    });

    return NextResponse.json({ ok: true, signature, positionCount: winners.length });
  } catch (error) {
    if (error instanceof SolanaTxError) {
      return NextResponse.json(
        { error: error.report.message, code: error.code, hint: error.report.hint },
        { status: error.status }
      );
    }
    const status =
      error instanceof ValidationError
        ? 400
        : error instanceof RateLimitError
          ? 429
          : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to settle round.",
      },
      { status }
    );
  }
}
