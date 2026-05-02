import { NextResponse } from "next/server";
import { deployAdminSession } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminDeploySessionPayload,
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
    const envelope = parseSignedEnvelope(body, parseAdminDeploySessionPayload);
    consumeSignedActionToken(envelope.walletAddress, "admin/sessions/deploy");
    const { payload } = await verifySignedSpotrAction(
      "admin-deploy-session",
      envelope
    );

    const responsePayload = await deployAdminSession({
      adminWalletAddress: payload.adminWalletAddress,
      title: payload.title,
      pairIds: payload.pairIds,
      overrideStartsAtIso: payload.overrideStartsAtIso,
      overrideEndsAtIso: payload.overrideEndsAtIso,
      buyInLamports: payload.buyInLamports ?? null,
      cardPackItems: payload.cardPackItems,
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
          error instanceof Error ? error.message : "Failed to deploy session.",
      },
      { status }
    );
  }
}
