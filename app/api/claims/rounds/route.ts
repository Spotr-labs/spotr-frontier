import { NextResponse } from "next/server";
import { claimSpotrRoundProceeds } from "../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../lib/server/signed-action";
import {
  ValidationError,
  parseSignedEnvelope,
  parseWalletOnlyPayload,
} from "../../../lib/server/validators";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const envelope = parseSignedEnvelope(body, parseWalletOnlyPayload);
    consumeSignedActionToken(envelope.walletAddress, "claims/rounds");
    const { payload } = await verifySignedSpotrAction(
      "claim-round-proceeds",
      envelope
    );

    const responsePayload = await claimSpotrRoundProceeds({
      walletAddress: payload.walletAddress,
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to claim round proceeds.",
      },
      { status }
    );
  }
}
