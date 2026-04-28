import { listAdminPlayers } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";
import { csvResponse, rowsToCsv } from "../../_lib/csv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const allRows: unknown[][] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await listAdminPlayers({
        walletAddress: wallet,
        cursor,
        pageSize: 200,
      });
      for (const row of page.items) {
        allRows.push([
          row.walletAddress,
          row.displayName ?? "",
          row.sessionsJoined,
          row.totalStakedLamports,
          row.totalEscrowLamports,
          row.remainingEscrowLamports,
          row.positionsEntered,
          row.rewardsAssigned,
          row.referredByWallet ?? "",
          row.firstJoinedAtIso ?? "",
          row.lastJoinedAtIso ?? "",
        ]);
      }
      if (!page.nextCursor || allRows.length >= 10000) break;
      cursor = page.nextCursor;
    }
    const csv = rowsToCsv(
      [
        "walletAddress",
        "displayName",
        "sessionsJoined",
        "totalStakedLamports",
        "totalEscrowLamports",
        "remainingEscrowLamports",
        "positionsEntered",
        "rewardsAssigned",
        "referredByWallet",
        "firstJoinedAtIso",
        "lastJoinedAtIso",
      ],
      allRows
    );
    return csvResponse(
      csv,
      `spotr-players-${new Date().toISOString().slice(0, 10)}.csv`
    );
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to export players.",
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
