import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAdminOverview } from "../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../_lib/auth";

export const dynamic = "force-dynamic";

const loadOverview = (wallet: string) =>
  unstable_cache(
    () => getAdminOverview(wallet),
    ["admin-overview", wallet],
    { revalidate: 20, tags: ["admin-overview", `admin-overview:${wallet}`] }
  )();

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const payload = await loadOverview(wallet);
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
