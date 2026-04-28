import { NextResponse } from "next/server";
import { bulkPayoutReferrals } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminPayoutBulkPayload,
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
    const envelope = parseSignedEnvelope(body, parseAdminPayoutBulkPayload);
    consumeSignedActionToken(
      envelope.walletAddress,
      "admin/referrals/payout-bulk"
    );
    const { payload } = await verifySignedSpotrAction(
      "admin-payout-referrals-bulk",
      envelope
    );
    const result = await bulkPayoutReferrals({
      adminWalletAddress: payload.adminWalletAddress,
      referrerWallets: payload.referrerWallets,
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
            : "Failed to record bulk referral payout.",
      },
      { status }
    );
  }
}
