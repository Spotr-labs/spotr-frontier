import { NextResponse } from "next/server";
import { importAdminPairs } from "../../../../lib/server/spotr-store";
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
        csv?: string;
      };
    };
    const { payload } = await verifySignedSpotrAction("admin-import-pairs", body);

    const responsePayload = await importAdminPairs({
      adminWalletAddress: payload.adminWalletAddress ?? "",
      csv: payload.csv ?? "",
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import pair CSV.",
      },
      { status: 400 }
    );
  }
}
