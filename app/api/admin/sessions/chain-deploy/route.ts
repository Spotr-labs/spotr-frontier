import { NextResponse } from "next/server";
import { recordChainDeployedSession } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminChainDeployPayload,
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
    const envelope = parseSignedEnvelope(body, parseAdminChainDeployPayload);
    consumeSignedActionToken(envelope.walletAddress, "admin/sessions/chain-deploy");
    const { payload } = await verifySignedSpotrAction(
      "admin-chain-deploy-session",
      envelope
    );

    const responsePayload = await recordChainDeployedSession({
      adminWalletAddress: payload.adminWalletAddress,
      sessionId: payload.sessionId,
      chainTxSignature: payload.chainTxSignature,
      chainSessionNumber: payload.chainSessionNumber,
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
            : "Failed to record on-chain session deploy.",
      },
      { status }
    );
  }
}
