"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { DataTable } from "../../components/admin/data-table";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  FilterSegment,
  StatusBadge,
} from "../../components/admin/filters";
import { ExportCsvButton } from "../../components/admin/export-csv-button";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import {
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import type {
  AdminRewardItem,
  AdminRewardListResponse,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

type StatusFilter = "all" | "assigned" | "claimable" | "claimed";
type KindFilter = "all" | "nft" | "merch" | "gift-card" | "voucher";

export default function AdminRewardsPage() {
  const { walletAddress, runAction } = useAdminDashboard();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [walletFilter, setWalletFilter] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  const swrKey = walletAddress
    ? buildKey(walletAddress, { status, kind, walletFilter })
    : null;
  const { data, isLoading, mutate } = useSWR<AdminRewardListResponse>(
    swrKey,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const items = data?.items ?? [];

  const columns: ColumnDef<AdminRewardItem>[] = useMemo(
    () => [
      {
        id: "title",
        header: "Title",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-foreground">{row.original.title}</p>
            <p className="text-xs text-muted">{row.original.subtitle}</p>
          </div>
        ),
      },
      {
        id: "kind",
        header: "Kind",
        cell: ({ row }) => row.original.kind,
      },
      {
        id: "wallet",
        header: "Wallet",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {shortenAddress(row.original.walletAddress, 6)}
          </span>
        ),
      },
      {
        id: "session",
        header: "Session",
        cell: ({ row }) => row.original.sessionTitle ?? "—",
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge label={row.original.status} />,
      },
      {
        id: "assigned",
        header: "Assigned",
        cell: ({ row }) => formatUtc(row.original.assignedAtIso),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.status !== "claimable" ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  changeStatus(row.original.id, "claimable")
                }
              >
                Mark claimable
              </Button>
            ) : null}
            {row.original.status !== "claimed" ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => changeStatus(row.original.id, "claimed")}
              >
                Mark claimed
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    []
  );

  function changeStatus(
    rewardId: string,
    next: "assigned" | "claimable" | "claimed"
  ) {
    if (!walletAddress) {
      toast.error("Connect an admin wallet first.");
      return;
    }
    runAction(
      "/api/admin/rewards/status",
      "admin-update-reward-status",
      {
        adminWalletAddress: walletAddress,
        rewardId,
        status: next,
      },
      { successMessage: "Reward status updated.", onSuccess: () => mutate() }
    );
  }

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Rewards"
        title="Inventory + bulk assign"
        description="Track NFT/merch/gift-card/voucher inventory and shuffle status."
        actions={
          <>
            <ExportCsvButton href="/api/admin/rewards/export" />
            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4" /> Bulk assign
                </Button>
              </DialogTrigger>
              <BulkAssignDialogContent
                onClose={() => setBulkOpen(false)}
                onAssigned={() => {
                  setBulkOpen(false);
                  mutate();
                }}
              />
            </Dialog>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSegment
          label="Status"
          options={[
            { value: "all", label: "All" },
            { value: "assigned", label: "Assigned" },
            { value: "claimable", label: "Claimable" },
            { value: "claimed", label: "Claimed" },
          ]}
          value={status}
          onChange={setStatus}
        />
        <FilterSegment
          label="Kind"
          options={[
            { value: "all", label: "All" },
            { value: "nft", label: "NFT" },
            { value: "merch", label: "Merch" },
            { value: "gift-card", label: "Gift" },
            { value: "voucher", label: "Voucher" },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Input
          placeholder="Wallet address"
          value={walletFilter}
          onChange={(event) => setWalletFilter(event.target.value)}
          className="h-9 w-[260px]"
        />
      </div>

      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.id}
        isLoading={!data && isLoading}
        empty="No rewards match the current filters."
      />
    </div>
  );
}

function buildKey(
  wallet: string,
  filters: {
    status: StatusFilter;
    kind: KindFilter;
    walletFilter: string;
  }
) {
  const params = new URLSearchParams();
  params.set("wallet", wallet);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.walletFilter.trim())
    params.set("walletFilter", filters.walletFilter.trim());
  return `/api/admin/rewards/list?${params.toString()}`;
}

function BulkAssignDialogContent({
  onClose,
  onAssigned,
}: {
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { walletAddress, runAction } = useAdminDashboard();
  const [csv, setCsv] = useState("");
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Bulk assign rewards (CSV)</DialogTitle>
      </DialogHeader>
      <p className="text-xs text-muted">
        Columns: <code className="font-mono">wallet,kind,title,subtitle,sessionId</code>.
        Header optional. <code className="font-mono">sessionId</code> blank → uses primary session.
      </p>
      <Textarea
        rows={10}
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
        placeholder="wallet,kind,title,subtitle,sessionId"
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            if (!walletAddress) {
              toast.error("Connect an admin wallet first.");
              return;
            }
            const items = parseRewardCsv(csv);
            if (items.length === 0) {
              toast.error("Provide at least one reward row.");
              return;
            }
            runAction(
              "/api/admin/rewards/assign-bulk",
              "admin-assign-reward-bulk",
              {
                adminWalletAddress: walletAddress,
                items,
              },
              {
                successMessage: `${items.length} rewards assigned.`,
                onSuccess: onAssigned,
              }
            );
          }}
        >
          Assign
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function parseRewardCsv(csv: string) {
  const items: Array<{
    targetWalletAddress: string;
    kind: "nft" | "merch" | "gift-card" | "voucher";
    title: string;
    subtitle: string;
    sessionId: string | null;
  }> = [];
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length === 0) continue;
    if (
      cells[0]?.toLowerCase() === "wallet" ||
      cells[0]?.toLowerCase() === "wallets" ||
      cells[0]?.toLowerCase() === "walletaddress"
    ) {
      continue;
    }
    if (cells.length < 4) continue;
    const kind = (cells[1] ?? "nft") as
      | "nft"
      | "merch"
      | "gift-card"
      | "voucher";
    items.push({
      targetWalletAddress: cells[0] ?? "",
      kind,
      title: cells[2] ?? "",
      subtitle: cells[3] ?? "",
      sessionId: cells[4] ? cells[4] : null,
    });
  }
  return items;
}
