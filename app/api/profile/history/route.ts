import { NextResponse } from "next/server";
import { listProfileSessionHistory } from "../../../lib/server/spotr-store";
import type { ProfileSessionHistoryResponse } from "../../../lib/spotr-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get("wallet");
    if (!walletAddress) {
      return NextResponse.json({ items: [] } satisfies ProfileSessionHistoryResponse);
    }
    const items = await listProfileSessionHistory(walletAddress);
    return NextResponse.json({ items } satisfies ProfileSessionHistoryResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load profile history.",
      },
      { status: 500 }
    );
  }
}
