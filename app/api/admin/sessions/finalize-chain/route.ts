import { NextResponse } from "next/server";
import { recordChainFinalizeSession } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminFinalizeSessionPayload,
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
    const envelope = parseSignedEnvelope(
      body,
      parseAdminFinalizeSessionPayload
    );
    consumeSignedActionToken(
      envelope.walletAddress,
      "admin/sessions/finalize-chain"
    );
    const { payload } = await verifySignedSpotrAction(
      "admin-finalize-session",
      envelope
    );
    await recordChainFinalizeSession({
      adminWalletAddress: payload.adminWalletAddress,
      sessionId: payload.sessionId,
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
            : "Failed to record finalize-session.",
      },
      { status }
    );
  }
}
