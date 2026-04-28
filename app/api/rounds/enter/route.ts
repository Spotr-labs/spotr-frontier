import { NextResponse } from "next/server";
import { enterSpotrRoundPosition } from "../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../lib/server/signed-action";
import {
  ValidationError,
  parseEnterRoundPayload,
  parseSignedEnvelope,
} from "../../../lib/server/validators";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const envelope = parseSignedEnvelope(body, parseEnterRoundPayload);
    consumeSignedActionToken(envelope.walletAddress, "rounds/enter");
    const { payload: signedPayload } = await verifySignedSpotrAction(
      "enter-round",
      envelope
    );

    const responsePayload = await enterSpotrRoundPosition({
      walletAddress: signedPayload.walletAddress,
      roundId: signedPayload.roundId,
      side: signedPayload.side,
      wagerLamports: BigInt(signedPayload.wagerLamports),
      chainTxSignature: signedPayload.chainTxSignature,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    const status =
      error instanceof ValidationError
        ? 400
        : error instanceof RateLimitError
          ? 429
          : 400;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to enter round.",
      },
      { status }
    );
  }
}
