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
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import type {
  AdminAuditEntry,
  AdminAuditListResponse,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminAuditPage() {
  const { walletAddress } = useAdminDashboard();
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });

  const swrKey = walletAddress
    ? buildKey(walletAddress, { actor, kind, range })
    : null;
  const { data, isLoading, mutate } = useSWR<AdminAuditListResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const items = data?.items ?? [];

  const columns: ColumnDef<AdminAuditEntry>[] = useMemo(
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
          <span className="font-mono text-xs text-primary">
            {row.original.kind}
          </span>
        ),
      },
      {
        id: "actor",
        header: "Actor",
        cell: ({ row }) =>
          row.original.actor ? (
            <span className="font-mono text-xs">
              {shortenAddress(row.original.actor, 6)}
            </span>
          ) : (
            "system"
          ),
      },
      {
        id: "session",
        header: "Session",
        cell: ({ row }) =>
          row.original.sessionId ? (
            <span className="font-mono text-[11px]">
              {shortenAddress(row.original.sessionId, 5)}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "metadata",
        header: "Metadata",
        cell: ({ row }) =>
          row.original.metadataJson ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted">
                view
              </summary>
              <pre className="mt-2 max-h-60 max-w-[420px] overflow-auto whitespace-pre-wrap rounded-[0.7rem] border border-white/10 bg-black/40 p-2 text-[10px]">
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
        eyebrow="Audit"
        title="Admin write log"
        description="Filtered to TransactionLog entries with kind starting `admin_`. Polls every 30s."
        actions={
          <ExportCsvButton
            href={`/api/admin/audit/export?${buildSearchParams({
              actor,
              kind,
              range,
            }).toString()}`}
          />
        }
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[260px_180px_auto]">
        <Input
          placeholder="Filter by actor wallet"
          value={actor}
          onChange={(event) => setActor(event.target.value)}
        />
        <Input
          placeholder="Filter by kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        />
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>

      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.id}
        isLoading={!data && isLoading}
        empty="No audit entries yet."
        loadMore={
          data?.nextCursor
            ? () => {
                if (!swrKey) return;
                fetch(`${swrKey}&cursor=${encodeURIComponent(data.nextCursor!)}`, {
                  cache: "no-store",
                })
                  .then((r) => r.json())
                  .then((next: AdminAuditListResponse) => {
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
        estimatedRowHeight={64}
      />
    </div>
  );
}

function buildSearchParams(filters: {
  actor: string;
  kind: string;
  range: { from: string; to: string };
}) {
  const params = new URLSearchParams();
  if (filters.actor.trim()) params.set("actor", filters.actor.trim());
  if (filters.kind.trim()) params.set("kind", filters.kind.trim());
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
  filters: { actor: string; kind: string; range: { from: string; to: string } }
) {
  const params = buildSearchParams(filters);
  params.set("wallet", wallet);
  return `/api/admin/audit/list?${params.toString()}`;
}
