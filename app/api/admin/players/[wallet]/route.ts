import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAdminPlayerDetail } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const loadPlayer = (adminWallet: string, target: string) =>
  unstable_cache(
    () =>
      getAdminPlayerDetail({
        walletAddress: adminWallet,
        targetWalletAddress: target,
      }),
    ["admin-player", adminWallet, target],
    {
      revalidate: 20,
      tags: ["admin-player", `admin-player:${target}`, `admin-player:${adminWallet}:${target}`],
    }
  )();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const adminWallet = requireAdminWalletFromUrl(request);
    const { wallet: target } = await params;
    const payload = await loadPlayer(adminWallet, target);
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
