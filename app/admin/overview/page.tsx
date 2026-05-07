"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowUpRight,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import { Sparkline } from "../../components/admin/sparkline";
import { Button } from "../../components/ui/button";
import { StatusBadge } from "../../components/admin/filters";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../components/admin/format";
import { publicSpotrConfig } from "../../lib/spotr-config/public";
import type { AdminOverviewResponse } from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminOverviewPage() {
  const { walletAddress } = useAdminDashboard();
  const swrKey = walletAddress
    ? `/api/admin/overview?wallet=${encodeURIComponent(walletAddress)}`
    : null;
  const { data, mutate, isLoading } = useSWR<AdminOverviewResponse>(swrKey, fetcher, {
    refreshInterval: 30_000,
  });
  const summary = data?.summary;

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Overview"
        title="Protocol-wide health"
        description="KPIs, sparklines, and recent ledger activity. Polls every 15s."
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={isLoading}
            onClick={() => mutate()}
          >
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {summary?.lowPairAlert ? (
        <div className="mb-5 flex items-center gap-3 rounded-[1rem] border border-destructive/30 bg-destructive/10 p-3 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <p className="text-sm">
            Active pair inventory is below the configured threshold of{" "}
            {publicSpotrConfig.lowPairAlertThreshold}. Import more pairs.
          </p>
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <Link href="/admin/pairs">Open pairs</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-4">
        <Kpi label="Live sessions" value={String(summary?.liveSessions ?? 0)} />
        <Kpi label="Pending sessions" value={String(summary?.pendingSessions ?? 0)} />
        <Kpi label="Active pairs" value={String(summary?.activePairs ?? 0)} />
        <Kpi label="Available pairs" value={String(summary?.availablePairs ?? 0)} />
        <Kpi
          label="Protocol fees"
          value={formatUsdc(summary?.protocolFeesLamports ?? 0)}
        />
        <Kpi
          label="Pending referral $"
          value={formatUsdc(summary?.pendingReferralLamports ?? 0)}
        />
        <Kpi
          label="Assigned rewards"
          value={String(summary?.assignedRewards ?? 0)}
        />
        <Kpi
          label="Claimable rewards"
          value={String(summary?.claimableRewards ?? 0)}
        />
        <Kpi
          label="Active referrers"
          value={String(summary?.referralBalances.length ?? 0)}
        />
        <Kpi
          label="Recent participants"
          value={String(summary?.participants.length ?? 0)}
        />
        <Kpi
          label="Pair library"
          value={String(summary?.pairLibrary.length ?? 0)}
        />
        <Kpi
          label="Sessions seen"
          value={String(summary?.sessionHistory.length ?? 0)}
        />
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <SparkPanel
          label="Volume · 14d"
          color="#f5c800"
          data={data?.sparklines.volumeByDay ?? []}
          format={(value) => formatUsdc(value)}
        />
        <SparkPanel
          label="Fees · 14d"
          color="#fb923c"
          data={data?.sparklines.feesByDay ?? []}
          format={(value) => formatUsdc(value)}
        />
        <SparkPanel
          label="Joins · 14d"
          color="#34d399"
          data={data?.sparklines.joinsByDay ?? []}
          format={(value) => `${value} wallets`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-[1.1rem] border border-white/10 bg-black/22 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-extrabold text-foreground">
              Recent activity
            </h2>
            <Link
              href="/admin/transactions"
              className="text-xs font-semibold uppercase tracking-[0.22em] text-primary hover:underline"
            >
              All
            </Link>
          </div>
          <div className="space-y-1.5">
            {(data?.recentTransactions ?? []).slice(0, 12).map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 rounded-[0.9rem] border border-white/8 bg-black/16 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{tx.kind}</p>
                  <p className="text-muted">
                    {formatRelative(tx.createdAtIso)} ·{" "}
                    {tx.walletAddress
                      ? shortenAddress(tx.walletAddress, 4)
                      : "—"}
                  </p>
                </div>
                {tx.amountLamports != null ? (
                  <span className="font-mono text-foreground">
                    {formatUsdc(tx.amountLamports)}
                  </span>
                ) : null}
              </div>
            ))}
            {data?.recentTransactions.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-[1.1rem] border border-white/10 bg-black/22 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-extrabold text-foreground">
              Live sessions
            </h2>
            <Link
              href="/admin/sessions"
              className="text-xs font-semibold uppercase tracking-[0.22em] text-primary hover:underline"
            >
              Manage
            </Link>
          </div>
          <div className="space-y-2">
            {(data?.liveSessionTitles ?? []).map((title, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-[0.9rem] border border-success/20 bg-success/5 px-3 py-2 text-xs"
              >
                <span className="font-medium text-foreground">{title}</span>
                <StatusBadge label="live" tone="success" />
              </div>
            ))}
            {data?.liveSessionTitles.length === 0 ? (
              <p className="text-sm text-muted">No sessions are live right now.</p>
            ) : null}
          </div>

          {summary?.recentRewards.length ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-3 w-3 text-primary" />
                <h3 className="font-display text-sm font-extrabold text-foreground">
                  Latest rewards
                </h3>
              </div>
              <ul className="space-y-1.5">
                {summary.recentRewards.slice(0, 5).map((reward) => (
                  <li
                    key={reward.id}
                    className="flex items-center justify-between rounded-[0.8rem] border border-white/8 bg-black/16 px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {reward.title}
                      </p>
                      <p className="text-muted">
                        {shortenAddress(reward.walletAddress, 4)} ·{" "}
                        {formatUtc(reward.assignedAtIso)}
                      </p>
                    </div>
                    <StatusBadge label={reward.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-[1rem] border border-white/10 bg-black/22 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="mt-2 font-display text-[1.4rem] font-extrabold tracking-[-0.04em] text-foreground">
        {value}
      </p>
      {helper ? <p className="mt-1 text-[11px] text-muted">{helper}</p> : null}
    </div>
  );
}

function SparkPanel({
  label,
  color,
  data,
  format,
}: {
  label: string;
  color: string;
  data: Array<{ dateIso: string; value: number }>;
  format: (value: number) => string;
}) {
  const total = data.reduce((sum, point) => sum + point.value, 0);
  return (
    <div className="rounded-[1.1rem] border border-white/10 bg-black/22 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
          {label}
        </p>
        <ArrowUpRight className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-2 font-display text-[1.4rem] font-extrabold tracking-[-0.04em] text-foreground">
        {format(total)}
      </p>
      <div className="mt-2">
        <Sparkline data={data} color={color} format={format} />
      </div>
    </div>
  );
}
