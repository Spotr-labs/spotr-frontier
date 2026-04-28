import { NextResponse } from "next/server";
import { getAdminAnalytics } from "../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const { searchParams } = new URL(request.url);
    const payload = await getAdminAnalytics({
      walletAddress: wallet,
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load analytics.",
      },
      { status }
    );
  }
}
