"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import type {
  AdminPairListResponse,
  AdminPairTableRow,
  RewardKind,
  SpotrPublicConfig,
} from "../../lib/spotr-types";
import { useAdminDashboard } from "./use-admin-dashboard";

type CardPackItem = {
  kind: "nft" | "merch" | "gift-card" | "voucher";
  title: string;
  subtitle: string;
};

type DeploySessionDialogProps = {
  config: SpotrPublicConfig;
  trigger: React.ReactNode;
  onDeployed?: () => void;
};

const KINDS: Array<CardPackItem["kind"]> = [
  "nft",
  "merch",
  "gift-card",
  "voucher",
];

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

function uiKindToServer(value: CardPackItem["kind"]): RewardKind {
  return value;
}

export function DeploySessionDialog({
  config,
  trigger,
  onDeployed,
}: DeploySessionDialogProps) {
  const { walletAddress, submitSignedAction, deploySessionOnChain } = useAdminDashboard();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [pairIds, setPairIds] = useState<string[]>([]);
  const [overrideStarts, setOverrideStarts] = useState("");
  const [overrideEnds, setOverrideEnds] = useState("");
  const [cardPackItems, setCardPackItems] = useState<CardPackItem[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allPairs, setAllPairs] = useState<AdminPairTableRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const baseSwrKey = open && walletAddress
    ? `/api/admin/pairs/list?wallet=${encodeURIComponent(walletAddress)}&active=true&assigned=false${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ""}`
    : null;
  const { data } = useSWR<AdminPairListResponse>(baseSwrKey, fetcher);

  useEffect(() => {
    if (!data) return;
    setAllPairs(data.items);
    setNextCursor(data.nextCursor ?? null);
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || !baseSwrKey || isFetchingMore) return;
    setIsFetchingMore(true);
    try {
      const resp = await fetch(`${baseSwrKey}&cursor=${encodeURIComponent(nextCursor)}`, { cache: "no-store" });
      const page: AdminPairListResponse = await resp.json();
      setAllPairs((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      toast.error("Failed to load more pairs.");
    } finally {
      setIsFetchingMore(false);
    }
  }, [nextCursor, baseSwrKey, isFetchingMore]);

  const seededRef = useRef(false);

  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    if (pairIds.length !== 0) return;
    if (allPairs.length === 0) return;
    seededRef.current = true;
    const next = allPairs
      .slice(0, config.roundCount)
      .map((pair) => pair.id);
    queueMicrotask(() => setPairIds(next));
  }, [allPairs, config.roundCount, open, pairIds.length]);

  const togglePair = (id: string) => {
    setPairIds((current) => {
      if (current.includes(id)) {
        return current.filter((entry) => entry !== id);
      }
      if (current.length >= config.roundCount) {
        toast.error(`Pick exactly ${config.roundCount} pairs.`);
        return current;
      }
      return [...current, id];
    });
  };

  function reset() {
    setTitle("");
    setPairIds([]);
    setOverrideStarts("");
    setOverrideEnds("");
    setCardPackItems([]);
    setSearch("");
    setDebouncedSearch("");
    setAllPairs([]);
    setNextCursor(null);
  }

  type DeployResult = {
    sessionId: string;
    createdAtIso: string;
    startsAtIso: string;
    endsAtIso: string;
  };

  async function submit() {
    if (!walletAddress) {
      toast.error("Connect an admin wallet first.");
      return;
    }
    if (pairIds.length !== config.roundCount) {
      toast.error(`Pick exactly ${config.roundCount} pairs.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const dbResult = await submitSignedAction<unknown, DeployResult>(
        "/api/admin/sessions/deploy",
        "admin-deploy-session",
        {
          adminWalletAddress: walletAddress,
          title: title.trim() || null,
          pairIds,
          overrideStartsAtIso: overrideStarts
            ? new Date(overrideStarts).toISOString()
            : null,
          overrideEndsAtIso: overrideEnds
            ? new Date(overrideEnds).toISOString()
            : null,
          cardPackItems: cardPackItems.length === 0
            ? undefined
            : cardPackItems.map((item) => ({
                kind: uiKindToServer(item.kind),
                title: item.title,
                subtitle: item.subtitle,
              })),
        }
      );

      toast.info("Session created — sign the transaction to deploy on-chain…");

      const sessionNumber = BigInt(new Date(dbResult.createdAtIso).getTime());
      const { signature } = await deploySessionOnChain({
        sessionNumber,
        startTsSeconds: BigInt(
          Math.floor(new Date(dbResult.startsAtIso).getTime() / 1000)
        ),
        endTsSeconds: BigInt(
          Math.floor(new Date(dbResult.endsAtIso).getTime() / 1000)
        ),
      });

      await submitSignedAction(
        "/api/admin/sessions/chain-deploy",
        "admin-chain-deploy-session",
        {
          adminWalletAddress: walletAddress,
          sessionId: dbResult.sessionId,
          chainTxSignature: signature,
          chainSessionNumber: sessionNumber.toString(),
        }
      );

      toast.success("Session deployed on-chain.");
      reset();
      setOpen(false);
      onDeployed?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Deploy failed."
      );
      onDeployed?.();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy session</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="session-title">Title (optional)</Label>
            <Input
              id="session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Auto-generated if empty"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="override-starts">Override start (UTC)</Label>
              <Input
                id="override-starts"
                type="datetime-local"
                value={overrideStarts}
                onChange={(event) => setOverrideStarts(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="override-ends">Override end (UTC)</Label>
              <Input
                id="override-ends"
                type="datetime-local"
                value={overrideEnds}
                onChange={(event) => setOverrideEnds(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Pairs · pick {config.roundCount} ({pairIds.length} selected)</Label>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search fault lines…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {allPairs.map((pair) => (
              <PairOption
                key={pair.id}
                pair={pair}
                selected={pairIds.includes(pair.id)}
                onToggle={() => togglePair(pair.id)}
              />
            ))}
            {allPairs.length === 0 ? (
              <p className="text-xs text-muted">
                {search
                  ? "No pairs match your search."
                  : "No active, unassigned pairs found. Import a CSV in the Pairs section first."}
              </p>
            ) : null}
          </div>
          {nextCursor ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={isFetchingMore}
              onClick={loadMore}
            >
              <ChevronDown className="h-3 w-3" />
              {isFetchingMore ? "Loading…" : "Load more pairs"}
            </Button>
          ) : null}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Card-pack templates (optional)</Label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                setCardPackItems((current) => [
                  ...current,
                  { kind: "nft", title: "", subtitle: "" },
                ])
              }
            >
              <Plus className="h-3 w-3" /> Add reward
            </Button>
          </div>
          {cardPackItems.length === 0 ? (
            <p className="text-xs text-muted">
              Card-pack templates are materialized into RewardInventory rows after the session ends.
            </p>
          ) : null}
          {cardPackItems.map((item, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-[1rem] border border-white/10 bg-black/16 p-3 lg:grid-cols-[100px_1fr_1fr_auto]"
            >
              <select
                value={item.kind}
                onChange={(event) =>
                  setCardPackItems((current) =>
                    current.map((entry, idx) =>
                      idx === index
                        ? {
                            ...entry,
                            kind: event.target.value as CardPackItem["kind"],
                          }
                        : entry
                    )
                  )
                }
                className="focus-ring h-9 rounded-[0.8rem] border border-white/12 bg-black/22 px-2 text-xs uppercase tracking-[0.16em]"
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Title"
                value={item.title}
                onChange={(event) =>
                  setCardPackItems((current) =>
                    current.map((entry, idx) =>
                      idx === index ? { ...entry, title: event.target.value } : entry
                    )
                  )
                }
              />
              <Textarea
                placeholder="Subtitle"
                value={item.subtitle}
                onChange={(event) =>
                  setCardPackItems((current) =>
                    current.map((entry, idx) =>
                      idx === index
                        ? { ...entry, subtitle: event.target.value }
                        : entry
                    )
                  )
                }
                className="min-h-[40px] py-2"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setCardPackItems((current) =>
                    current.filter((_, idx) => idx !== index)
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? "Deploying…" : "Deploy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PairOption({
  pair,
  selected,
  onToggle,
}: {
  pair: AdminPairTableRow;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`focus-ring rounded-[1rem] border p-3 text-left transition ${
        selected
          ? "border-primary/60 bg-primary/10"
          : "border-white/10 bg-black/16 hover:border-white/30"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
        {pair.category}
      </p>
      <p className="mt-1 text-sm text-foreground">{pair.sideA}</p>
      <p className="text-sm text-muted">vs {pair.sideB}</p>
    </button>
  );
}
