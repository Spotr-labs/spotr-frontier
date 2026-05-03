"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import { getNextDeployWindow } from "../../lib/spotr-config/session-window";

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
  const { walletAddress, deploySessionOnChain } = useAdminDashboard();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [pairIds, setPairIds] = useState<string[]>([]);
  const [overrideStarts, setOverrideStarts] = useState("");
  const [overrideEnds, setOverrideEnds] = useState("");
  const [showStartCustom, setShowStartCustom] = useState(false);
  const [showEndCustom, setShowEndCustom] = useState(false);
  const [isFree, setIsFree] = useState(false);
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

  // datetime-local expects YYYY-MM-DDTHH:MM in *local* time. The naive
  // `toISOString` is UTC, so we offset before slicing.
  function toDatetimeLocalValue(date: Date) {
    const tzOffsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  }

  function setStartIn(minutes: number) {
    setOverrideStarts(toDatetimeLocalValue(new Date(Date.now() + minutes * 60_000)));
  }

  function setEndAfterStart(minutes: number) {
    const base = overrideStarts ? new Date(overrideStarts) : new Date();
    setOverrideEnds(toDatetimeLocalValue(new Date(base.getTime() + minutes * 60_000)));
  }

  function formatResolved(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function reset() {
    setTitle("");
    setPairIds([]);
    setOverrideStarts("");
    setOverrideEnds("");
    setShowStartCustom(false);
    setShowEndCustom(false);
    setIsFree(false);
    setCardPackItems([]);
    setSearch("");
    setDebouncedSearch("");
    setAllPairs([]);
    setNextCursor(null);
  }

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
      const buyInLamports = isFree ? 0 : undefined;

      // Resolve session window client-side so we can build the on-chain tx
      // before any backend round-trip — that way the admin signs only once.
      const defaultWindow = getNextDeployWindow(config);
      const startsAt = overrideStarts
        ? new Date(overrideStarts)
        : defaultWindow.startsAt;
      const endsAt = overrideEnds
        ? new Date(overrideEnds)
        : defaultWindow.endsAt;
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        toast.error("Invalid start/end timestamp.");
        return;
      }
      if (endsAt <= startsAt) {
        toast.error("End time must be after start time.");
        return;
      }

      // Microsecond timestamp gives a u64 session number that's unique per
      // tab; collisions only matter if two admins click Deploy in the same
      // microsecond, which is fine.
      const sessionNumber = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

      toast.info("Sign the deploy transaction…");
      const { signature } = await deploySessionOnChain({
        sessionNumber,
        startTsSeconds: BigInt(Math.floor(startsAt.getTime() / 1000)),
        endTsSeconds: BigInt(Math.floor(endsAt.getTime() / 1000)),
        pairIds,
        buyInUsdcUnits: isFree ? 0n : undefined,
      });

      const response = await fetch("/api/admin/sessions/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminWalletAddress: walletAddress,
          title: title.trim() || null,
          pairIds,
          startsAtIso: startsAt.toISOString(),
          endsAtIso: endsAt.toISOString(),
          buyInLamports,
          cardPackItems:
            cardPackItems.length === 0
              ? undefined
              : cardPackItems.map((item) => ({
                  kind: uiKindToServer(item.kind),
                  title: item.title,
                  subtitle: item.subtitle,
                })),
          chainTxSignature: signature,
          chainSessionNumber: sessionNumber.toString(),
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error.error ?? `Deploy failed: HTTP ${response.status}`);
      }

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
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isFree}
                onChange={(e) => setIsFree(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 accent-primary"
              />
              <span className="text-muted">Free session (no buy-in)</span>
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Override start (local)</Label>
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "Now", minutes: 0 },
                  { label: "+5 min", minutes: 5 },
                  { label: "+30 min", minutes: 30 },
                ].map(({ label, minutes }) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setStartIn(minutes)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={showStartCustom ? "secondary" : "ghost"}
                  onClick={() => setShowStartCustom((v) => !v)}
                >
                  Custom…
                </Button>
                {overrideStarts ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setOverrideStarts("")}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              {showStartCustom ? (
                <Input
                  id="override-starts"
                  type="datetime-local"
                  value={overrideStarts}
                  onChange={(event) => setOverrideStarts(event.target.value)}
                />
              ) : null}
              <p className="text-[11px] text-muted">
                {formatResolved(overrideStarts) ?? "Uses default launch window."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Override end (local)</Label>
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "+15 min", minutes: 15 },
                  { label: "+1 hour", minutes: 60 },
                  { label: "+6 hours", minutes: 360 },
                  { label: "+24 hours", minutes: 1440 },
                ].map(({ label, minutes }) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setEndAfterStart(minutes)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={showEndCustom ? "secondary" : "ghost"}
                  onClick={() => setShowEndCustom((v) => !v)}
                >
                  Custom…
                </Button>
                {overrideEnds ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setOverrideEnds("")}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              {showEndCustom ? (
                <Input
                  id="override-ends"
                  type="datetime-local"
                  value={overrideEnds}
                  onChange={(event) => setOverrideEnds(event.target.value)}
                />
              ) : null}
              <p className="text-[11px] text-muted">
                {formatResolved(overrideEnds) ?? "Uses default launch window."}
              </p>
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
