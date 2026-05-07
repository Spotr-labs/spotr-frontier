import { NextResponse } from "next/server";
import { getProfileSessionRounds } from "../../../../../lib/server/spotr-store";
import type { ProfileSessionRoundsResponse } from "../../../../../lib/spotr-types";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("wallet");
    if (!walletAddress) {
      return NextResponse.json({ rounds: [] } satisfies ProfileSessionRoundsResponse);
    }
    const rounds = await getProfileSessionRounds(walletAddress, sessionId);
    return NextResponse.json({ rounds } satisfies ProfileSessionRoundsResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load session rounds.",
      },
      { status: 500 },
    );
  }
}
