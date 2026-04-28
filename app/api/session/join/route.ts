import { NextResponse } from "next/server";
import { joinSpotrSession } from "../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../lib/server/signed-action";
import {
  ValidationError,
  parseJoinSessionPayload,
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
    const envelope = parseSignedEnvelope(body, parseJoinSessionPayload);
    consumeSignedActionToken(envelope.walletAddress, "session/join");
    const { payload: signedPayload } = await verifySignedSpotrAction(
      "join-session",
      envelope
    );

    const responsePayload = await joinSpotrSession({
      walletAddress: signedPayload.walletAddress,
      referrerWallet: signedPayload.referrerWallet,
      chainTxSignature: signedPayload.chainTxSignature,
      sessionId: signedPayload.sessionId,
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
        error: error instanceof Error ? error.message : "Failed to join session.",
      },
      { status }
    );
  }
}
