"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Plus, Rocket } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { DataTable } from "../../components/admin/data-table";
import { DeploySessionDialog } from "../../components/admin/deploy-session-dialog";
import { DateRangePicker } from "../../components/admin/date-range-picker";
import { ExportCsvButton } from "../../components/admin/export-csv-button";
import {
  FilterSegment,
  StatusBadge,
} from "../../components/admin/filters";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
} from "../../components/admin/format";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import { Button } from "../../components/ui/button";
import { publicSpotrConfig } from "../../lib/spotr-config/public";
import { toast } from "sonner";
import type {
  AdminSessionListItem,
  AdminSessionListResponse,
  SessionStatus,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

const STATUS_FILTERS: Array<{ value: "all" | SessionStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "live", label: "Live" },
  { value: "expired", label: "Expired" },
  { value: "completed", label: "Completed" },
];

export default function AdminSessionsPage() {
  const { walletAddress, isPending } = useAdminDashboard();
  const [statusFilter, setStatusFilter] = useState<"all" | SessionStatus>("all");
  const [range, setRange] = useState({ from: "", to: "" });

  const swrKey = walletAddress
    ? buildSessionsListKey(walletAddress, statusFilter, range)
    : null;
  const { data, mutate, isLoading } = useSWR<AdminSessionListResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const items = data?.items ?? [];

  const columns: ColumnDef<AdminSessionListItem>[] = useMemo(
    () => [
      {
        id: "title",
        header: "Title",
        cell: ({ row }) => (
          <Link
            href={`/admin/sessions/${row.original.id}`}
            className="font-medium text-foreground hover:text-primary"
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            label={row.original.status}
            tone={
              row.original.status === "live"
                ? "success"
                : row.original.status === "completed"
                  ? "primary"
                  : row.original.status === "expired"
                    ? "danger"
                    : "warning"
            }
          />
        ),
      },
      {
        id: "starts",
        header: "Starts",
        cell: ({ row }) => (
          <div className="text-xs text-muted">
            <div>{formatUtc(row.original.startsAtIso)}</div>
            <div>{formatRelative(row.original.startsAtIso)}</div>
          </div>
        ),
      },
      {
        id: "ends",
        header: "Ends",
        cell: ({ row }) => (
          <div className="text-xs text-muted">
            <div>{formatUtc(row.original.endsAtIso)}</div>
            <div>{formatRelative(row.original.endsAtIso)}</div>
          </div>
        ),
      },
      {
        id: "wallets",
        header: "Wallets",
        cell: ({ row }) => row.original.joinedWallets,
      },
      {
        id: "escrow",
        header: "Escrow",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {formatUsdc(row.original.totalEscrowLamports)}
          </span>
        ),
      },
      {
        id: "fees",
        header: "Fees",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {formatUsdc(row.original.protocolFeeAccruedLamports)}
          </span>
        ),
      },
      {
        id: "chain",
        header: "On-chain",
        cell: ({ row }) =>
          row.original.chainSessionNumber ? (
            <span className="font-mono text-[11px] text-success">
              #{row.original.chainSessionNumber}
            </span>
          ) : (
            <DeployOnChainButton
              session={row.original}
              onSuccess={() => mutate()}
              disabled={isPending}
            />
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/admin/sessions/${row.original.id}`}>Open</Link>
            </Button>
            {row.original.status !== "completed" ? (
              <ExpireSessionButton
                sessionId={row.original.id}
                onSuccess={() => mutate()}
              />
            ) : null}
          </div>
        ),
      },
    ],
    [isPending, mutate]
  );

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Sessions"
        title="Live + historical sessions"
        description="Drill down into rounds, participants, positions, and chain ops."
        actions={
          <>
            <ExportCsvButton href="/api/admin/transactions/export" label="Export tx" />
            <DeploySessionDialog
              config={publicSpotrConfig}
              onDeployed={() => mutate()}
              trigger={
                <Button>
                  <Plus className="h-4 w-4" /> Deploy session
                </Button>
              }
            />
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSegment
          label="Status"
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value)}
        />
        <DateRangePicker
          from={range.from}
          to={range.to}
          onChange={setRange}
        />
      </div>
      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.id}
        isLoading={!data && isLoading}
        empty={
          <div className="space-y-2">
            <p>No sessions yet.</p>
            <p className="text-xs">
              Use “Deploy session” above to launch the first one.
            </p>
          </div>
        }
        loadMore={
          data?.nextCursor
            ? () => {
                // simple "load more" replaces the page rather than infinite scroll
                if (!swrKey || !walletAddress) return;
                fetch(`${swrKey}&cursor=${encodeURIComponent(data.nextCursor!)}`, {
                  cache: "no-store",
                })
                  .then((r) => r.json())
                  .then((next: AdminSessionListResponse) =>
                    mutate(
                      {
                        items: [...items, ...next.items],
                        nextCursor: next.nextCursor,
                      },
                      false
                    )
                  )
                  .catch((error) => toast.error(String(error)));
              }
            : undefined
        }
        hasMore={Boolean(data?.nextCursor)}
      />
    </div>
  );
}

function buildSessionsListKey(
  wallet: string,
  status: "all" | SessionStatus,
  range: { from: string; to: string }
) {
  const params = new URLSearchParams();
  params.set("wallet", wallet);
  if (status !== "all") params.set("status", status);
  if (range.from) params.set("dateFrom", new Date(range.from).toISOString());
  if (range.to) {
    const end = new Date(range.to);
    end.setUTCHours(23, 59, 59, 999);
    params.set("dateTo", end.toISOString());
  }
  return `/api/admin/sessions/list?${params.toString()}`;
}

function DeployOnChainButton({
  session,
  onSuccess,
  disabled,
}: {
  session: AdminSessionListItem;
  onSuccess: () => void;
  disabled?: boolean;
}) {
  const { walletAddress, deploySessionOnChain, runAction } = useAdminDashboard();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={disabled}
      onClick={async () => {
        if (!walletAddress) {
          toast.error("Connect an admin wallet first.");
          return;
        }
        try {
          const sessionNumber = BigInt(new Date(session.createdAtIso).getTime());
          const startTsSeconds = BigInt(
            Math.floor(new Date(session.startsAtIso).getTime() / 1000)
          );
          const endTsSeconds = BigInt(
            Math.floor(new Date(session.endsAtIso).getTime() / 1000)
          );
          toast.info(`Sign deploy tx for "${session.title}"…`);
          const { signature } = await deploySessionOnChain({
            sessionNumber,
            startTsSeconds,
            endTsSeconds,
            pairIds: session.pairIds,
          });
          runAction(
            "/api/admin/sessions/chain-deploy",
            "admin-chain-deploy-session",
            {
              adminWalletAddress: walletAddress,
              sessionId: session.id,
              chainTxSignature: signature,
              chainSessionNumber: sessionNumber.toString(),
            },
            {
              successMessage: "Session deployed on-chain.",
              onSuccess,
            }
          );
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Deploy failed."
          );
        }
      }}
    >
      <Rocket className="h-3 w-3" /> Deploy chain
    </Button>
  );
}

function ExpireSessionButton({
  sessionId,
  onSuccess,
}: {
  sessionId: string;
  onSuccess: () => void;
}) {
  const { walletAddress, runAction } = useAdminDashboard();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        if (!walletAddress) {
          toast.error("Connect an admin wallet first.");
          return;
        }
        if (
          !window.confirm(
            "Mark this session as expired? Players will be flagged for refund."
          )
        ) {
          return;
        }
        runAction(
          "/api/admin/sessions/expire",
          "admin-expire-session",
          { adminWalletAddress: walletAddress, sessionId },
          {
            successMessage: "Session expired.",
            onSuccess,
          }
        );
      }}
    >
      Expire
    </Button>
  );
}
