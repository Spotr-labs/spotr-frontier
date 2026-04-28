import { listAdminAudit } from "../../../../lib/server/spotr-store";
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
      const page = await listAdminAudit({
        walletAddress: wallet,
        actor: searchParams.get("actor"),
        kind: searchParams.get("kind"),
        dateFrom: searchParams.get("dateFrom"),
        dateTo: searchParams.get("dateTo"),
        cursor,
        pageSize: 500,
      });
      for (const row of page.items) {
        allRows.push([
          row.id,
          row.createdAtIso,
          row.kind,
          row.actor ?? "",
          row.sessionId ?? "",
          row.amountLamports ?? "",
          row.metadataJson ?? "",
        ]);
      }
      if (!page.nextCursor || allRows.length >= 25000) break;
      cursor = page.nextCursor;
    }
    const csv = rowsToCsv(
      [
        "id",
        "createdAtIso",
        "kind",
        "actor",
        "sessionId",
        "amountLamports",
        "metadataJson",
      ],
      allRows
    );
    return csvResponse(
      csv,
      `spotr-audit-${new Date().toISOString().slice(0, 10)}.csv`
    );
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to export audit.",
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
