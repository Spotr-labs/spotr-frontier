import { NextResponse } from "next/server";
import { syncAllActiveSessions } from "../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminSyncSessionsPayload,
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
    const envelope = parseSignedEnvelope(body, parseAdminSyncSessionsPayload);
    consumeSignedActionToken(envelope.walletAddress, "admin/sync");
    const { payload } = await verifySignedSpotrAction(
      "admin-sync-sessions",
      envelope
    );
    const result = await syncAllActiveSessions({
      adminWalletAddress: payload.adminWalletAddress,
    });
    return NextResponse.json(result);
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
            : "Failed to sync sessions.",
      },
      { status }
    );
  }
}
