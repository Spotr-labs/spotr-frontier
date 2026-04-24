import { NextResponse } from "next/server";
import { deployAdminSession } from "../../../../lib/server/spotr-store";
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
        title?: string | null;
        pairIds?: string[];
      };
    };
    const { payload } = await verifySignedSpotrAction(
      "admin-deploy-session",
      body
    );

    const responsePayload = await deployAdminSession({
      adminWalletAddress: payload.adminWalletAddress ?? "",
      title: payload.title ?? null,
      pairIds: payload.pairIds ?? [],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to deploy session.",
      },
      { status: 400 }
    );
  }
}
