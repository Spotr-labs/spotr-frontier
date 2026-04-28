import { type NextRequest, NextResponse } from "next/server";
import { listJoinableSessions } from "../../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cursor = request.nextUrl.searchParams.get("cursor") ?? null;
    const result = await listJoinableSessions({ cursor });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sessions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
