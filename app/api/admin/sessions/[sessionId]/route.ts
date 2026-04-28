import { NextResponse } from "next/server";
import { getAdminSessionDetail } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const { sessionId } = await params;
    const payload = await getAdminSessionDetail({
      walletAddress: wallet,
      sessionId,
    });
    if (!payload) {
      return NextResponse.json(
        { error: "Session not found." },
        { status: 404 }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load session.",
      },
      { status }
    );
  }
}
