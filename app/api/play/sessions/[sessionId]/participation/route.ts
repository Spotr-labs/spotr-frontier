import { type NextRequest, NextResponse } from "next/server";
import { getSpotrSessionParticipation } from "../../../../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const walletAddress = request.nextUrl.searchParams.get("wallet");
    const result = await getSpotrSessionParticipation({
      sessionId,
      walletAddress,
    });
    if (!result) {
      return NextResponse.json(
        { error: "Session not found." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check participation.",
      },
      { status: 500 }
    );
  }
}
