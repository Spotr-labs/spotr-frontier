import { listAdminPairs } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";
import { csvResponse, rowsToCsv } from "../../_lib/csv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const all: ReturnType<typeof rowsToCsv> extends string ? string[] : never =
      [] as never;
    const allRows: unknown[][] = [];
    let cursor: string | null = null;
    // Cap at 5_000 rows for safety.
    while (true) {
      const page = await listAdminPairs({
        walletAddress: wallet,
        cursor,
        pageSize: 200,
      });
      for (const row of page.items) {
        allRows.push([
          row.id,
          row.slug,
          row.category,
          row.sideA,
          row.sideB,
          row.defaultSideAPct,
          row.defaultSideBPct,
          row.crowdLabel,
          row.active ? "true" : "false",
          row.assigned ? "true" : "false",
          row.createdAtIso,
        ]);
      }
      if (!page.nextCursor || allRows.length >= 5000) break;
      cursor = page.nextCursor;
    }
    const csv = rowsToCsv(
      [
        "id",
        "slug",
        "category",
        "sideA",
        "sideB",
        "defaultSideAPct",
        "defaultSideBPct",
        "crowdLabel",
        "active",
        "assigned",
        "createdAtIso",
      ],
      allRows
    );
    void all;
    return csvResponse(csv, `spotr-pairs-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to export pairs.",
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
