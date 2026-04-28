"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { DataTable } from "../../components/admin/data-table";
import { Input } from "../../components/ui/input";
import { ExportCsvButton } from "../../components/admin/export-csv-button";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import type {
  AdminPlayerListItem,
  AdminPlayerListResponse,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminPlayersPage() {
  const { walletAddress } = useAdminDashboard();
  const [search, setSearch] = useState("");
  const swrKey = walletAddress
    ? `/api/admin/players/list?wallet=${encodeURIComponent(walletAddress)}${
        search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""
      }`
    : null;
  const { data, isLoading } = useSWR<AdminPlayerListResponse>(swrKey, fetcher, {
    refreshInterval: 30_000,
  });
  const items = data?.items ?? [];
  const columns: ColumnDef<AdminPlayerListItem>[] = useMemo(
    () => [
      {
        id: "wallet",
        header: "Wallet",
        cell: ({ row }) => (
          <Link
            href={`/admin/players/${row.original.walletAddress}`}
            className="font-mono text-xs hover:text-primary"
          >
            {shortenAddress(row.original.walletAddress, 6)}
          </Link>
        ),
      },
      {
        id: "sessions",
        header: "Sessions",
        cell: ({ row }) => row.original.sessionsJoined,
      },
      {
        id: "positions",
        header: "Positions",
        cell: ({ row }) => row.original.positionsEntered,
      },
      {
        id: "staked",
        header: "Staked",
        cell: ({ row }) => formatUsdc(row.original.totalStakedLamports),
      },
      {
        id: "remaining",
        header: "Remaining",
        cell: ({ row }) => formatUsdc(row.original.remainingEscrowLamports),
      },
      {
        id: "rewards",
        header: "Rewards",
        cell: ({ row }) => row.original.rewardsAssigned,
      },
      {
        id: "referrer",
        header: "Referrer",
        cell: ({ row }) =>
          row.original.referredByWallet ? (
            <Link
              href={`/admin/referrals/${row.original.referredByWallet}`}
              className="font-mono text-[11px] hover:text-primary"
            >
              {shortenAddress(row.original.referredByWallet, 4)}
            </Link>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        id: "lastJoined",
        header: "Last joined",
        cell: ({ row }) => (
          <div className="text-xs text-muted">
            <div>{formatUtc(row.original.lastJoinedAtIso)}</div>
            <div>{formatRelative(row.original.lastJoinedAtIso)}</div>
          </div>
        ),
      },
    ],
    []
  );
  return (
    <div>
      <AdminSectionHeader
        eyebrow="Players"
        title="Wallets across sessions"
        description="Aggregated session, position, and reward state per wallet."
        actions={<ExportCsvButton href="/api/admin/players/export" />}
      />
      <div className="mb-4 flex items-center gap-2 rounded-[1rem] border border-white/12 bg-black/22 px-3 py-1.5">
        <Search className="h-4 w-4 text-muted" />
        <Input
          placeholder="Search wallet…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 w-[260px] border-0 bg-transparent text-sm focus-visible:ring-0"
        />
      </div>
      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.walletAddress}
        isLoading={!data && isLoading}
        empty="No players have joined yet."
      />
    </div>
  );
}
