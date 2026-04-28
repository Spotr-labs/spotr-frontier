"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { DataTable } from "../../components/admin/data-table";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ExportCsvButton } from "../../components/admin/export-csv-button";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import {
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import type {
  AdminReferralBalance,
  AdminReferralListResponse,
  AdminReferralBatch,
  AdminReferralBatchListResponse,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminReferralsPage() {
  const { walletAddress, runAction } = useAdminDashboard();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const balancesKey = walletAddress
    ? `/api/admin/referrals/list?wallet=${encodeURIComponent(walletAddress)}${
        search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""
      }`
    : null;
  const { data: balancesData, mutate: mutateBalances } =
    useSWR<AdminReferralListResponse>(balancesKey, fetcher, {
      refreshInterval: 30_000,
    });

  const batchesKey = walletAddress
    ? `/api/admin/referrals/batches?wallet=${encodeURIComponent(walletAddress)}`
    : null;
  const { data: batchesData } = useSWR<AdminReferralBatchListResponse>(
    batchesKey,
    fetcher,
    { refreshInterval: 60_000 }
  );

  const balances = balancesData?.items ?? [];
  const batches = batchesData?.items ?? [];

  const balancesCols: ColumnDef<AdminReferralBalance>[] = useMemo(
    () => [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            checked={
              balances.length > 0 && selected.size === balances.length
            }
            onChange={(event) => {
              if (event.target.checked) {
                setSelected(new Set(balances.map((b) => b.referrerWallet)));
              } else {
                setSelected(new Set());
              }
            }}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            disabled={row.original.balanceDueLamports <= 0}
            checked={selected.has(row.original.referrerWallet)}
            onChange={(event) => {
              setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(row.original.referrerWallet);
                else next.delete(row.original.referrerWallet);
                return next;
              });
            }}
          />
        ),
      },
      {
        id: "wallet",
        header: "Referrer",
        cell: ({ row }) => (
          <Link
            href={`/admin/referrals/${row.original.referrerWallet}`}
            className="font-mono text-xs hover:text-primary"
          >
            {shortenAddress(row.original.referrerWallet, 6)}
          </Link>
        ),
      },
      {
        id: "referees",
        header: "Referees",
        cell: ({ row }) => row.original.referredWallets,
      },
      {
        id: "total",
        header: "Total accrued",
        cell: ({ row }) => formatUsdc(row.original.totalAccruedLamports),
      },
      {
        id: "paid",
        header: "Paid",
        cell: ({ row }) => formatUsdc(row.original.paidOutLamports),
      },
      {
        id: "due",
        header: "Balance due",
        cell: ({ row }) => (
          <span className="font-mono text-foreground">
            {formatUsdc(row.original.balanceDueLamports)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="secondary"
            disabled={row.original.balanceDueLamports <= 0}
            onClick={() => {
              if (!walletAddress) return;
              runAction(
                "/api/admin/referrals/payout",
                "admin-payout-referrals",
                {
                  adminWalletAddress: walletAddress,
                  referrerWallet: row.original.referrerWallet,
                },
                {
                  successMessage: "Payout batch recorded.",
                  onSuccess: () => mutateBalances(),
                }
              );
            }}
          >
            Pay out
          </Button>
        ),
      },
    ],
    [balances, mutateBalances, runAction, selected, walletAddress]
  );

  const batchesCols: ColumnDef<AdminReferralBatch>[] = useMemo(
    () => [
      {
        id: "paid",
        header: "Paid at",
        cell: ({ row }) => formatUtc(row.original.paidAtIso),
      },
      {
        id: "wallet",
        header: "Referrer",
        cell: ({ row }) => (
          <Link
            href={`/admin/referrals/${row.original.referrerWallet}`}
            className="font-mono text-xs hover:text-primary"
          >
            {shortenAddress(row.original.referrerWallet, 6)}
          </Link>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) => formatUsdc(row.original.totalLamports),
      },
      {
        id: "count",
        header: "Referrals",
        cell: ({ row }) => row.original.referralCount,
      },
      {
        id: "admin",
        header: "Admin",
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted">
            {shortenAddress(row.original.adminWalletAddress, 6)}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Referrals"
        title="Balances + payout history"
        description="Track accruals across all sessions and pay out claimable balances."
        actions={<ExportCsvButton href="/api/admin/referrals/export" />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-[1rem] border border-white/12 bg-black/22 px-3 py-1.5">
          <Search className="h-4 w-4 text-muted" />
          <Input
            placeholder="Search wallet…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-[260px] border-0 bg-transparent text-sm focus-visible:ring-0"
          />
        </div>
        {selected.size > 0 ? (
          <div className="flex items-center gap-2 rounded-[1rem] border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
            <span>{selected.size} selected</span>
            <Button
              size="sm"
              onClick={() => {
                if (!walletAddress) return;
                runAction(
                  "/api/admin/referrals/payout-bulk",
                  "admin-payout-referrals-bulk",
                  {
                    adminWalletAddress: walletAddress,
                    referrerWallets: Array.from(selected),
                  },
                  {
                    successMessage: "Bulk payout recorded.",
                    onSuccess: () => {
                      setSelected(new Set());
                      mutateBalances();
                    },
                  }
                );
              }}
            >
              Bulk pay out
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        Balances ({balances.length})
      </h2>
      <DataTable
        columns={balancesCols}
        data={balances}
        rowKey={(row) => row.referrerWallet}
        empty="No referral accruals yet."
      />

      <h2 className="mb-3 mt-8 font-display text-base font-extrabold text-foreground">
        Batch history ({batches.length})
      </h2>
      <DataTable
        columns={batchesCols}
        data={batches}
        rowKey={(row) => row.id}
        empty="No payout batches recorded."
      />
    </div>
  );
}
