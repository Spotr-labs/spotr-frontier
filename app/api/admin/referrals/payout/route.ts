import { NextResponse } from "next/server";
import { payOutAdminReferralBalance } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      walletAddress: string;
      publicKeyBase64: string;
      signedMessageBase64: string;
      signatureBase64: string;
      issuedAtIso: string;
      payload: {
        adminWalletAddress?: string;
        referrerWallet?: string;
      };
    };
    const { payload } = await verifySignedSpotrAction(
      "admin-payout-referrals",
      body
    );

    const responsePayload = await payOutAdminReferralBalance({
      adminWalletAddress: payload.adminWalletAddress ?? "",
      referrerWallet: payload.referrerWallet ?? "",
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to mark referral payout as paid.",
      },
      { status: 400 }
    );
  }
}
