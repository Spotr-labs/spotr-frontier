import { NextResponse } from "next/server";
import { updateAdminRewardStatus } from "../../../../lib/server/spotr-store";
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
        rewardId?: string;
        status?: "assigned" | "claimable" | "claimed";
      };
    };
    const { payload } = await verifySignedSpotrAction(
      "admin-update-reward-status",
      body
    );

    const responsePayload = await updateAdminRewardStatus({
      adminWalletAddress: payload.adminWalletAddress ?? "",
      rewardId: payload.rewardId ?? "",
      status: payload.status ?? "assigned",
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update reward status.",
      },
      { status: 400 }
    );
  }
}
