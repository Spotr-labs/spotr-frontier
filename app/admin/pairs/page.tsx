"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Pencil, Plus, Power, Search, Upload } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
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
  formatRelative,
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import type {
  AdminPairListResponse,
  AdminPairTableRow,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

type ActiveFilter = "all" | "active" | "inactive";
type AssignedFilter = "all" | "assigned" | "unassigned";

export default function AdminPairsPage() {
  const { walletAddress, runAction } = useAdminDashboard();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ActiveFilter>("all");
  const [assigned, setAssigned] = useState<AssignedFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminPairTableRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const swrKey = walletAddress
    ? buildPairsKey(walletAddress, { search, active, assigned })
    : null;
  const { data, mutate, isLoading } = useSWR<AdminPairListResponse>(swrKey, fetcher, {
    refreshInterval: 30_000,
  });

  const items = data?.items ?? [];

  const columns: ColumnDef<AdminPairTableRow>[] = useMemo(
    () => [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            checked={items.length > 0 && selected.size === items.length}
            onChange={(event) => {
              if (event.target.checked) {
                setSelected(new Set(items.map((row) => row.id)));
              } else {
                setSelected(new Set());
              }
            }}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.id)}
            onChange={(event) => {
              setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(row.original.id);
                else next.delete(row.original.id);
                return next;
              });
            }}
          />
        ),
      },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => row.original.category,
      },
      {
        id: "sideA",
        header: "Side A",
        cell: ({ row }) => row.original.sideA,
      },
      {
        id: "sideB",
        header: "Side B",
        cell: ({ row }) => row.original.sideB,
      },
      {
        id: "default",
        header: "Default",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted">
            {row.original.defaultSideAPct}/{row.original.defaultSideBPct}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <StatusBadge
              label={row.original.active ? "active" : "inactive"}
              tone={row.original.active ? "success" : "danger"}
            />
            {row.original.assigned ? <StatusBadge label="assigned" /> : null}
          </div>
        ),
      },
      {
        id: "created",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-xs text-muted">
            {formatUtc(row.original.createdAtIso)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(row.original)}
            >
              <Pencil className="h-3 w-3" /> Edit
            </Button>
            <Button
              size="sm"
              variant={row.original.active ? "destructive" : "secondary"}
              onClick={() => {
                if (!walletAddress) return;
                runAction(
                  "/api/admin/pairs/toggle",
                  "admin-toggle-pair",
                  {
                    adminWalletAddress: walletAddress,
                    pairId: row.original.id,
                    active: !row.original.active,
                  },
                  {
                    successMessage: row.original.active
                      ? "Pair deactivated."
                      : "Pair activated.",
                    onSuccess: () => mutate(),
                  }
                );
              }}
            >
              <Power className="h-3 w-3" />{" "}
              {row.original.active ? "Disable" : "Enable"}
            </Button>
          </div>
        ),
      },
    ],
    [items, mutate, runAction, selected, walletAddress]
  );

  const handleBulkToggle = (next: boolean) => {
    if (!walletAddress || selected.size === 0) return;
    runAction(
      "/api/admin/pairs/toggle-bulk",
      "admin-toggle-pair-bulk",
      {
        adminWalletAddress: walletAddress,
        pairIds: Array.from(selected),
        active: next,
      },
      {
        successMessage: next
          ? `${selected.size} pairs activated.`
          : `${selected.size} pairs deactivated.`,
        onSuccess: () => {
          setSelected(new Set());
          mutate();
        },
      }
    );
  };

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Pairs"
        title="Fault-line library"
        description="Toggle, edit, import, and assign pairs to sessions."
        actions={
          <>
            <ExportCsvButton href="/api/admin/pairs/export" />
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="h-4 w-4" /> Import CSV
                </Button>
              </DialogTrigger>
              <ImportPairsDialogContent
                onClose={() => setImportOpen(false)}
                onImported={() => {
                  setImportOpen(false);
                  mutate();
                }}
              />
            </Dialog>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-[1rem] border border-white/12 bg-black/22 px-3 py-1.5">
          <Search className="h-4 w-4 text-muted" />
          <Input
            placeholder="Search category, side A, side B…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-[260px] border-0 bg-transparent text-sm focus-visible:ring-0"
          />
        </div>
        <FilterSegment
          label="Active"
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "On" },
            { value: "inactive", label: "Off" },
          ]}
          value={active}
          onChange={(value) => setActive(value)}
        />
        <FilterSegment
          label="Assigned"
          options={[
            { value: "all", label: "All" },
            { value: "assigned", label: "Yes" },
            { value: "unassigned", label: "No" },
          ]}
          value={assigned}
          onChange={(value) => setAssigned(value)}
        />
      </div>

      {selected.size > 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-[1rem] border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
          <span>{selected.size} selected</span>
          <Button size="sm" onClick={() => handleBulkToggle(true)}>
            Activate
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleBulkToggle(false)}
          >
            Deactivate
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

      <DataTable
        columns={columns}
        data={items}
        rowKey={(row) => row.id}
        isLoading={!data && isLoading}
        empty="No pairs match the current filters."
      />

      {editing ? (
        <EditPairDialog
          pair={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
        />
      ) : null}
    </div>
  );
}

function buildPairsKey(
  wallet: string,
  filters: { search: string; active: ActiveFilter; assigned: AssignedFilter }
) {
  const params = new URLSearchParams();
  params.set("wallet", wallet);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.active === "active") params.set("active", "true");
  if (filters.active === "inactive") params.set("active", "false");
  if (filters.assigned === "assigned") params.set("assigned", "true");
  if (filters.assigned === "unassigned") params.set("assigned", "false");
  return `/api/admin/pairs/list?${params.toString()}`;
}

function EditPairDialog({
  pair,
  onClose,
  onSaved,
}: {
  pair: AdminPairTableRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { walletAddress, runAction } = useAdminDashboard();
  const [category, setCategory] = useState(pair.category);
  const [sideA, setSideA] = useState(pair.sideA);
  const [sideB, setSideB] = useState(pair.sideB);
  const [crowdLabel, setCrowdLabel] = useState(pair.crowdLabel);
  const [defaultSideAPct, setDefaultSideAPct] = useState(
    pair.defaultSideAPct.toString()
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit pair</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="edit-category">Category</Label>
          <Input
            id="edit-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
          <Label htmlFor="edit-sideA">Side A</Label>
          <Input
            id="edit-sideA"
            value={sideA}
            onChange={(event) => setSideA(event.target.value)}
          />
          <Label htmlFor="edit-sideB">Side B</Label>
          <Input
            id="edit-sideB"
            value={sideB}
            onChange={(event) => setSideB(event.target.value)}
          />
          <Label htmlFor="edit-label">Crowd label</Label>
          <Input
            id="edit-label"
            value={crowdLabel}
            onChange={(event) => setCrowdLabel(event.target.value)}
          />
          <Label htmlFor="edit-pct">Side A default %</Label>
          <Input
            id="edit-pct"
            type="number"
            min="0"
            max="100"
            value={defaultSideAPct}
            onChange={(event) => setDefaultSideAPct(event.target.value)}
          />
        </div>
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
              const pct = Number(defaultSideAPct);
              if (Number.isNaN(pct) || pct < 0 || pct > 100) {
                toast.error("Default % must be 0–100.");
                return;
              }
              runAction(
                "/api/admin/pairs/edit",
                "admin-edit-pair",
                {
                  adminWalletAddress: walletAddress,
                  id: pair.id,
                  category,
                  sideA,
                  sideB,
                  crowdLabel,
                  defaultSideAPct: pct,
                },
                {
                  successMessage: "Pair updated.",
                  onSuccess: onSaved,
                }
              );
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportPairsDialogContent({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { walletAddress, runAction } = useAdminDashboard();
  const [csv, setCsv] = useState("");
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Import pairs (CSV)</DialogTitle>
      </DialogHeader>
      <p className="text-xs text-muted">
        Required columns: <code className="font-mono">category,side_a,side_b</code>.
        Optional: <code className="font-mono">id,side_a_pct,side_b_pct,crowd_label</code>.
      </p>
      <Textarea
        rows={10}
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
        placeholder="category,side_a,side_b\nPolitics,Side A,Side B"
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
            if (csv.trim().length === 0) {
              toast.error("CSV cannot be empty.");
              return;
            }
            runAction(
              "/api/admin/pairs/import",
              "admin-import-pairs",
              {
                adminWalletAddress: walletAddress,
                csv,
              },
              { successMessage: "Pair library imported.", onSuccess: onImported }
            );
          }}
        >
          Import
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
