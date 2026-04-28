import { NextResponse } from "next/server";
import { bulkAssignRewards } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminAssignRewardBulkPayload,
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
      parseAdminAssignRewardBulkPayload
    );
    consumeSignedActionToken(
      envelope.walletAddress,
      "admin/rewards/assign-bulk"
    );
    const { payload } = await verifySignedSpotrAction(
      "admin-assign-reward-bulk",
      envelope
    );
    const result = await bulkAssignRewards({
      adminWalletAddress: payload.adminWalletAddress,
      items: payload.items,
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
            : "Failed to bulk-assign rewards.",
      },
      { status }
    );
  }
}
