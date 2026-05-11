import { NextResponse } from "next/server";
import { processDueAutoFillForSession } from "../../../../lib/server/auto-fill-bots";

export const dynamic = "force-dynamic";

// Internal diagnostic endpoint. Production auto-fill runs from active heartbeat traffic.
type ProcessBody = {
  sessionId?: string | null;
  maxRounds?: number | string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ProcessBody;
    const sessionId = body.sessionId?.trim();
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required." },
        { status: 400 }
      );
    }

    const maxRoundsRaw = body.maxRounds ?? 1;
    const maxRounds = Number(maxRoundsRaw);
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) {
      return NextResponse.json(
        { error: "maxRounds must be an integer between 1 and 10." },
        { status: 400 }
      );
    }

    const result = await processDueAutoFillForSession(sessionId, { maxRounds });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process due auto-fill.",
      },
      { status: 500 }
    );
  }
}
