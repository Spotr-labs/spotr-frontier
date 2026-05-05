import { NextResponse } from "next/server";
import { recordChainResolveRound } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminResolveRoundPayload,
  parseSignedEnvelope,
} from "../../../../lib/server/validators";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../../lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const envelope = parseSignedEnvelope(body, parseAdminResolveRoundPayload);
    consumeSignedActionToken(
      envelope.walletAddress,
      "admin/rounds/resolve"
    );
    const { payload } = await verifySignedSpotrAction(
      "admin-resolve-round",
      envelope
    );
    await recordChainResolveRound({
      adminWalletAddress: payload.adminWalletAddress,
      sessionId: payload.sessionId,
      roundId: payload.roundId,
      winningSide: payload.winningSide,
      chainTxSignature: payload.chainTxSignature,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof ValidationError
        ? 400
        : error instanceof RateLimitError
          ? 429
          : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record resolve_round.",
      },
      { status }
    );
  }
}
