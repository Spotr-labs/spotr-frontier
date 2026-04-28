import { NextResponse } from "next/server";
import { bulkTogglePairs } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminTogglePairBulkPayload,
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
      parseAdminTogglePairBulkPayload
    );
    consumeSignedActionToken(
      envelope.walletAddress,
      "admin/pairs/toggle-bulk"
    );
    const { payload } = await verifySignedSpotrAction(
      "admin-toggle-pair-bulk",
      envelope
    );
    await bulkTogglePairs({
      adminWalletAddress: payload.adminWalletAddress,
      pairIds: payload.pairIds,
      active: payload.active,
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
            : "Failed to toggle pairs in bulk.",
      },
      { status }
    );
  }
}
