import { NextResponse } from "next/server";
import { assignSessionCardPack } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminAssignCardPackPayload,
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
      parseAdminAssignCardPackPayload
    );
    consumeSignedActionToken(
      envelope.walletAddress,
      "admin/sessions/assign-card-pack"
    );
    const { payload } = await verifySignedSpotrAction(
      "admin-assign-card-pack",
      envelope
    );
    await assignSessionCardPack({
      adminWalletAddress: payload.adminWalletAddress,
      sessionId: payload.sessionId,
      items: payload.items,
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
            : "Failed to assign card pack.",
      },
      { status }
    );
  }
}
