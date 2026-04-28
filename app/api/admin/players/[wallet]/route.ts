import { NextResponse } from "next/server";
import { getAdminPlayerDetail } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const adminWallet = requireAdminWalletFromUrl(request);
    const { wallet: target } = await params;
    const payload = await getAdminPlayerDetail({
      walletAddress: adminWallet,
      targetWalletAddress: target,
    });
    if (!payload) {
      return NextResponse.json(
        { error: "Player not found." },
        { status: 404 }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load player.",
      },
      { status }
    );
  }
}
