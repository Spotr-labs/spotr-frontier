import { NextResponse } from "next/server";
import { getAdminOverview } from "../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const payload = await getAdminOverview(wallet);
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load overview.",
      },
      { status }
    );
  }
}
