import { NextResponse } from "next/server";
import { prisma } from "../../../lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roundId = searchParams.get("roundId");
  if (!roundId) {
    return NextResponse.json({ error: "Missing roundId." }, { status: 400 });
  }

  try {
    const round = await prisma.sessionRound.findUnique({
      where: { id: roundId },
      select: { depositsCount: true, status: true },
    });
    if (!round) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }
    return NextResponse.json({
      depositsCount: round.depositsCount,
      status: round.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load round heartbeat.",
      },
      { status: 500 }
    );
  }
}
