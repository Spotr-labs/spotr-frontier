import { NextResponse } from "next/server";
import { assignAdminReward } from "../../../../lib/server/spotr-store";
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
        targetWalletAddress?: string;
        title?: string;
        subtitle?: string;
        kind?: "nft" | "merch" | "gift-card" | "voucher";
        sessionId?: string | null;
      };
    };
    const { payload } = await verifySignedSpotrAction(
      "admin-assign-reward",
      body
    );

    const responsePayload = await assignAdminReward({
      adminWalletAddress: payload.adminWalletAddress ?? "",
      targetWalletAddress: payload.targetWalletAddress ?? "",
      title: payload.title ?? "",
      subtitle: payload.subtitle ?? "",
      kind: payload.kind ?? "nft",
      sessionId: payload.sessionId ?? null,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to assign reward.",
      },
      { status: 400 }
    );
  }
}
