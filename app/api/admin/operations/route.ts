import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAdminOpsBoard } from "../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../_lib/auth";

export const dynamic = "force-dynamic";

const loadOps = (wallet: string) =>
  unstable_cache(
    () => getAdminOpsBoard({ walletAddress: wallet }),
    ["admin-ops", wallet],
    { revalidate: 20, tags: ["admin-ops", `admin-ops:${wallet}`] }
  )();

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const payload = await loadOps(wallet);
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load operations board.",
      },
      { status }
    );
  }
}
