import { NextResponse } from "next/server";
import { expireAdminSession } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminExpireSessionPayload,
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
    const envelope = parseSignedEnvelope(body, parseAdminExpireSessionPayload);
    consumeSignedActionToken(envelope.walletAddress, "admin/sessions/expire");
    const { payload } = await verifySignedSpotrAction(
      "admin-expire-session",
      envelope
    );
    await expireAdminSession({
      adminWalletAddress: payload.adminWalletAddress,
      sessionId: payload.sessionId,
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
          error instanceof Error ? error.message : "Failed to expire session.",
      },
      { status }
    );
  }
}
