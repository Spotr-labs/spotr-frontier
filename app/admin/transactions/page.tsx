"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { DataTable } from "../../components/admin/data-table";
import { Input } from "../../components/ui/input";
import { ExportCsvButton } from "../../components/admin/export-csv-button";
import { DateRangePicker } from "../../components/admin/date-range-picker";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import type {
  AdminTransactionDetail,
  AdminTransactionListResponse,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminTransactionsPage() {
  const { walletAddress } = useAdminDashboard();
  const [kind, setKind] = useState("");
  const [walletFilter, setWalletFilter] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });

  const swrKey = walletAddress
    ? buildKey(walletAddress, { kind, walletFilter, sessionId, range })
    : null;
  const { data, isLoading, mutate } = useSWR<AdminTransactionListResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const items = data?.items ?? [];

  const columns: ColumnDef<AdminTransactionDetail>[] = useMemo(
    () => [
      {
        id: "createdAt",
        header: "Time",
        cell: ({ row }) => (
          <div className="text-xs text-muted">
            <div>{formatUtc(row.original.createdAtIso)}</div>
            <div>{formatRelative(row.original.createdAtIso)}</div>
          </div>
        ),
      },
      {
        id: "kind",
        header: "Kind",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.kind}</span>
        ),
      },
      {
        id: "wallet",
        header: "Wallet",
        cell: ({ row }) =>
          row.original.walletAddress ? (
            <span className="font-mono text-xs">
              {shortenAddress(row.original.walletAddress, 6)}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "sessionId",
        header: "Session",
        cell: ({ row }) =>
          row.original.sessionId ? (
            <span className="font-mono text-xs">
              {shortenAddress(row.original.sessionId, 5)}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          row.original.amountLamports != null
            ? formatUsdc(row.original.amountLamports)
            : "—",
      },
      {
        id: "metadata",
        header: "Meta",
        cell: ({ row }) =>
          row.original.metadataJson ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted">
                view
              </summary>
              <pre className="mt-2 max-h-48 max-w-[420px] overflow-auto whitespace-pre-wrap rounded-[0.7rem] border border-white/10 bg-black/40 p-2 text-[10px]">
                {row.original.metadataJson}
              </pre>
            </details>
          ) : (
            "—"
          ),
      },
    ],
    []
  );

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Transactions"
        title="Full ledger"
        description="Every write across the protocol — joins, enters, claims, payouts, admin actions."
        actions={
          <ExportCsvButton
            href={`/api/admin/transactions/export?${buildSearchParams({
              kind,
              walletFilter,
              sessionId,
              range,
            }).toString()}`}
          />
        }
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[180px_220px_220px_auto]">
        <Input
          placeholder="Filter kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        />
        <Input
          placeholder="Wallet address"
          value={walletFilter}
          onChange={(event) => setWalletFilter(event.target.value)}
        />
        <Input
          placeholder="Session id"
          value={sessionId}
          onChange={(event) => setSessionId(event.target.value)}
        />
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>
      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.id}
        isLoading={!data && isLoading}
        empty="No transactions match the current filters."
        loadMore={
          data?.nextCursor
            ? () => {
                if (!walletAddress) return;
                fetch(
                  `${swrKey}&cursor=${encodeURIComponent(data.nextCursor!)}`,
                  { cache: "no-store" }
                )
                  .then((r) => r.json())
                  .then((next: AdminTransactionListResponse) => {
                    mutate(
                      {
                        items: [...items, ...next.items],
                        nextCursor: next.nextCursor,
                      },
                      false
                    );
                  });
              }
            : undefined
        }
        hasMore={Boolean(data?.nextCursor)}
        virtualize={items.length > 60}
        estimatedRowHeight={60}
      />
    </div>
  );
}

function buildSearchParams(filters: {
  kind: string;
  walletFilter: string;
  sessionId: string;
  range: { from: string; to: string };
}) {
  const params = new URLSearchParams();
  if (filters.kind.trim()) params.set("kind", filters.kind.trim());
  if (filters.walletFilter.trim()) params.set("walletFilter", filters.walletFilter.trim());
  if (filters.sessionId.trim()) params.set("sessionId", filters.sessionId.trim());
  if (filters.range.from) params.set("dateFrom", new Date(filters.range.from).toISOString());
  if (filters.range.to) {
    const end = new Date(filters.range.to);
    end.setUTCHours(23, 59, 59, 999);
    params.set("dateTo", end.toISOString());
  }
  return params;
}

function buildKey(
  wallet: string,
  filters: {
    kind: string;
    walletFilter: string;
    sessionId: string;
    range: { from: string; to: string };
  }
) {
  const params = buildSearchParams(filters);
  params.set("wallet", wallet);
  return `/api/admin/transactions/list?${params.toString()}`;
}
