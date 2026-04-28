import { listAdminRewards } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";
import { csvResponse, rowsToCsv } from "../../_lib/csv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const { searchParams } = new URL(request.url);
    const allRows: unknown[][] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await listAdminRewards({
        walletAddress: wallet,
        status: searchParams.get("status"),
        kind: searchParams.get("kind"),
        sessionId: searchParams.get("sessionId"),
        walletFilter: searchParams.get("walletFilter"),
        cursor,
        pageSize: 500,
      });
      for (const row of page.items) {
        allRows.push([
          row.id,
          row.walletAddress,
          row.sessionId ?? "",
          row.sessionTitle ?? "",
          row.kind,
          row.title,
          row.subtitle,
          row.status,
          row.assignedAtIso,
          row.claimedAtIso ?? "",
        ]);
      }
      if (!page.nextCursor || allRows.length >= 25000) break;
      cursor = page.nextCursor;
    }
    const csv = rowsToCsv(
      [
        "id",
        "walletAddress",
        "sessionId",
        "sessionTitle",
        "kind",
        "title",
        "subtitle",
        "status",
        "assignedAtIso",
        "claimedAtIso",
      ],
      allRows
    );
    return csvResponse(
      csv,
      `spotr-rewards-${new Date().toISOString().slice(0, 10)}.csv`
    );
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to export rewards.",
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
