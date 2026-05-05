import { NextResponse } from "next/server";
import { getSessionPublicResults } from "../../../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const results = await getSessionPublicResults(sessionId);
    if (!results) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load session results.",
      },
      { status: 500 }
    );
  }
}
