import { NextResponse } from "next/server";
import { listAdminPairs } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";

export const dynamic = "force-dynamic";

function parseTriBool(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const { searchParams } = new URL(request.url);
    const payload = await listAdminPairs({
      walletAddress: wallet,
      search: searchParams.get("search"),
      active: parseTriBool(searchParams.get("active")),
      assigned: parseTriBool(searchParams.get("assigned")),
      cursor: searchParams.get("cursor"),
    });
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list pairs.",
      },
      { status }
    );
  }
}
