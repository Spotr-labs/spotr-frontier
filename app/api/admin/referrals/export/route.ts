import { listAdminReferralBalances } from "../../../../lib/server/spotr-store";
import { AdminAuthError, requireAdminWalletFromUrl } from "../../_lib/auth";
import { csvResponse, rowsToCsv } from "../../_lib/csv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const wallet = requireAdminWalletFromUrl(request);
    const allRows: unknown[][] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await listAdminReferralBalances({
        walletAddress: wallet,
        cursor,
        pageSize: 500,
      });
      for (const row of page.items) {
        allRows.push([
          row.referrerWallet,
          row.referredWallets,
          row.totalAccruedLamports,
          row.paidOutLamports,
          row.balanceDueLamports,
        ]);
      }
      if (!page.nextCursor || allRows.length >= 25000) break;
      cursor = page.nextCursor;
    }
    const csv = rowsToCsv(
      [
        "referrerWallet",
        "referredWallets",
        "totalAccruedLamports",
        "paidOutLamports",
        "balanceDueLamports",
      ],
      allRows
    );
    return csvResponse(
      csv,
      `spotr-referrals-${new Date().toISOString().slice(0, 10)}.csv`
    );
  } catch (error) {
    const status = error instanceof AdminAuthError ? 401 : 500;
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to export referrals.",
      }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
