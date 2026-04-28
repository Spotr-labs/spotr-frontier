import { NextResponse } from "next/server";
import { listAdminReferralBalances } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const { searchParams } = new URL(request.url);
    const payload = await listAdminReferralBalances({
      walletAddress: wallet,
      search: searchParams.get("search"),
      cursor: searchParams.get("cursor"),
    });
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list referrals.",
      },
      { status }
    );
  }
}
