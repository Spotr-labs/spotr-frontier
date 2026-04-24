import { NextResponse } from "next/server";
import { updateAdminPairState } from "../../../../lib/server/spotr-store";
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
        pairId?: string;
        active?: boolean;
      };
    };
    const { payload } = await verifySignedSpotrAction("admin-toggle-pair", body);

    const responsePayload = await updateAdminPairState({
      adminWalletAddress: payload.adminWalletAddress ?? "",
      pairId: payload.pairId ?? "",
      active: Boolean(payload.active),
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update pair state.",
      },
      { status: 400 }
    );
  }
}
