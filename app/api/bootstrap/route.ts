import { NextResponse } from "next/server";
import { getSpotrDashboardPayload } from "../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("wallet");
    const sessionId = searchParams.get("session");
    const payload = await getSpotrDashboardPayload(walletAddress, sessionId ?? undefined);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load SPOTR state.",
      },
      { status: 500 }
    );
  }
}

