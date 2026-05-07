"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { AdminSectionHeader } from "../../../components/admin/section-header";
import { Button } from "../../../components/ui/button";
import { DataTable } from "../../../components/admin/data-table";
import { useAdminDashboard } from "../../../components/admin/use-admin-dashboard";
import { StatusBadge } from "../../../components/admin/filters";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../../components/admin/format";
import type {
  AdminPlayerDetail,
  AdminPlayerPositionRow,
  AdminPlayerReward,
  AdminPlayerSessionRow,
} from "../../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminPlayerDetailPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet: targetWallet } = use(params);
  const { walletAddress } = useAdminDashboard();
  const swrKey = walletAddress
    ? `/api/admin/players/${targetWallet}?wallet=${encodeURIComponent(walletAddress)}`
    : null;
  const { data, isLoading } = useSWR<AdminPlayerDetail>(swrKey, fetcher, {
    refreshInterval: 30_000,
  });

  const sessionsCols: ColumnDef<AdminPlayerSessionRow>[] = useMemo(
    () => [
      {
        id: "title",
        header: "Session",
        cell: ({ row }) => (
          <Link
            href={`/admin/sessions/${row.original.sessionId}`}
            className="font-medium text-foreground hover:text-primary"
          >
            {row.original.sessionTitle}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge label={row.original.status} />,
      },
      {
        id: "joined",
        header: "Joined",
        cell: ({ row }) => formatUtc(row.original.joinedAtIso),
      },
      {
        id: "escrow",
        header: "Escrow",
        cell: ({ row }) => formatUsdc(row.original.totalEscrowLamports),
      },
      {
        id: "remaining",
        header: "Remaining",
        cell: ({ row }) => formatUsdc(row.original.remainingEscrowLamports),
      },
      {
        id: "positions",
        header: "Positions",
        cell: ({ row }) => row.original.positionsEntered,
      },
    ],
    []
  );
  const positionsCols: ColumnDef<AdminPlayerPositionRow>[] = useMemo(
    () => [
      {
        id: "session",
        header: "Session",
        cell: ({ row }) => (
          <Link
            href={`/admin/sessions/${row.original.sessionId}`}
            className="hover:text-primary"
          >
            {row.original.sessionTitle}
          </Link>
        ),
      },
      {
        id: "round",
        header: "Round",
        cell: ({ row }) => row.original.roundIndex + 1,
      },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => row.original.category,
      },
      {
        id: "side",
        header: "Side",
        cell: ({ row }) => (
          <StatusBadge
            label={`Side ${row.original.side}`}
            tone={row.original.side === "A" ? "primary" : "warning"}
          />
        ),
      },
      {
        id: "stake",
        header: "Stake",
        cell: ({ row }) => formatUsdc(row.original.stakeLamports),
      },
      {
        id: "claimed",
        header: "Claimed",
        cell: ({ row }) => formatUsdc(row.original.claimedLamports),
      },
      {
        id: "submitted",
        header: "Submitted",
        cell: ({ row }) => formatUtc(row.original.submittedAtIso),
      },
    ],
    []
  );
  const rewardsCols: ColumnDef<AdminPlayerReward>[] = useMemo(
    () => [
      { id: "kind", header: "Kind", cell: ({ row }) => row.original.kind },
      {
        id: "title",
        header: "Title",
        cell: ({ row }) => row.original.title,
      },
      {
        id: "subtitle",
        header: "Subtitle",
        cell: ({ row }) => row.original.subtitle,
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
    ],
    []
  );

  if (!data && !isLoading) {
    return (
      <div>
        <AdminSectionHeader eyebrow="Player" title="Not found" />
        <Button asChild variant="secondary">
          <Link href="/admin/players">
            <ArrowLeft className="h-4 w-4" /> All players
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Player"
        title={shortenAddress(targetWallet, 8)}
        description={data ? targetWallet : "Loading…"}
        actions={
          <Button asChild variant="secondary">
            <Link href="/admin/players">
              <ArrowLeft className="h-4 w-4" /> All players
            </Link>
          </Button>
        }
      />
      {data ? (
        <>
          <div className="mb-6 grid gap-3 rounded-[1.1rem] border border-white/10 bg-black/22 p-4 lg:grid-cols-4">
            <Stat
              label="Sessions joined"
              value={data.sessions.length.toString()}
            />
            <Stat
              label="Positions entered"
              value={data.positions.length.toString()}
            />
            <Stat
              label="First joined"
              value={data.firstJoinedAtIso ? `${formatUtc(data.firstJoinedAtIso)} · ${formatRelative(data.firstJoinedAtIso)}` : "—"}
            />
            <Stat
              label="Last joined"
              value={data.lastJoinedAtIso ? `${formatUtc(data.lastJoinedAtIso)} · ${formatRelative(data.lastJoinedAtIso)}` : "—"}
            />
            <Stat
              label="Referred by"
              value={
                data.referralPanel.referredByWallet ? (
                  <Link
                    href={`/admin/referrals/${data.referralPanel.referredByWallet}`}
                    className="font-mono text-xs hover:text-primary"
                  >
                    {shortenAddress(
                      data.referralPanel.referredByWallet,
                      6
                    )}
                  </Link>
                ) : (
                  <span className="text-muted">none</span>
                )
              }
            />
            <Stat
              label="Referees"
              value={data.referralPanel.referredCount.toString()}
            />
            <Stat
              label="Referral accrued"
              value={formatUsdc(data.referralPanel.totalAccruedLamports)}
            />
            <Stat
              label="Referral due"
              value={formatUsdc(data.referralPanel.balanceDueLamports)}
            />
          </div>

          <Section title={`Sessions (${data.sessions.length})`}>
            <DataTable
              columns={sessionsCols}
              data={data.sessions}
              rowKey={(row) => row.participantId}
              empty="Has not joined any sessions."
            />
          </Section>
          <Section title={`Positions (${data.positions.length})`}>
            <DataTable
              columns={positionsCols}
              data={data.positions}
              rowKey={(row) => row.id}
              empty="No positions yet."
            />
          </Section>
          <Section title={`Rewards (${data.rewards.length})`}>
            <DataTable
              columns={rewardsCols}
              data={data.rewards}
              rowKey={(row) => row.id}
              empty="No rewards assigned."
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}
