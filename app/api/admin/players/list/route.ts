import { NextResponse } from "next/server";
import { listAdminPlayers } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const { searchParams } = new URL(request.url);
    const payload = await listAdminPlayers({
      walletAddress: wallet,
      search: searchParams.get("search"),
      sessionId: searchParams.get("sessionId"),
      cursor: searchParams.get("cursor"),
    });
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list players.",
      },
      { status }
    );
  }
}
