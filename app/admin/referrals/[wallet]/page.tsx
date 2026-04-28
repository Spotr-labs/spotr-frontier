"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { AdminSectionHeader } from "../../../components/admin/section-header";
import { Button } from "../../../components/ui/button";
import { DataTable } from "../../../components/admin/data-table";
import { useAdminDashboard } from "../../../components/admin/use-admin-dashboard";
import { StatusBadge } from "../../../components/admin/filters";
import {
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../../components/admin/format";
import type {
  AdminReferralBatch,
  AdminReferrerDetail,
  AdminSessionReferralDetail,
  ReferredWalletContribution,
} from "../../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminReferrerDetailPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet: targetWallet } = use(params);
  const { walletAddress, runAction } = useAdminDashboard();
  const swrKey = walletAddress
    ? `/api/admin/referrals/${targetWallet}?wallet=${encodeURIComponent(walletAddress)}`
    : null;
  const { data, isLoading, mutate } = useSWR<AdminReferrerDetail>(
    swrKey,
    fetcher,
    { refreshInterval: 30_000 }
  );

  const refereeCols: ColumnDef<ReferredWalletContribution>[] = useMemo(
    () => [
      {
        id: "wallet",
        header: "Referee",
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
        id: "earned",
        header: "Earned",
        cell: ({ row }) => formatUsdc(row.original.totalEarnedLamports),
      },
      {
        id: "paid",
        header: "Paid",
        cell: ({ row }) => formatUsdc(row.original.paidOutLamports),
      },
      {
        id: "due",
        header: "Due",
        cell: ({ row }) => formatUsdc(row.original.balanceDueLamports),
      },
    ],
    []
  );
  const batchCols: ColumnDef<AdminReferralBatch>[] = useMemo(
    () => [
      {
        id: "date",
        header: "Paid at",
        cell: ({ row }) => formatUtc(row.original.paidAtIso),
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) => formatUsdc(row.original.totalLamports),
      },
      {
        id: "count",
        header: "Referrals",
        cell: ({ row }) => row.original.referralCount,
      },
    ],
    []
  );
  const accrualCols: ColumnDef<AdminSessionReferralDetail>[] = useMemo(
    () => [
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge label={row.original.status} />,
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) => formatUsdc(row.original.amountLamports),
      },
      {
        id: "referee",
        header: "Referee",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {shortenAddress(row.original.refereeWallet, 6)}
          </span>
        ),
      },
      {
        id: "created",
        header: "Created",
        cell: ({ row }) => formatUtc(row.original.createdAtIso),
      },
    ],
    []
  );

  if (!data && !isLoading) {
    return (
      <div>
        <AdminSectionHeader eyebrow="Referrer" title="Not found" />
        <Button asChild variant="secondary">
          <Link href="/admin/referrals">
            <ArrowLeft className="h-4 w-4" /> All referrers
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Referrer"
        title={shortenAddress(targetWallet, 8)}
        description={data ? targetWallet : "Loading…"}
        actions={
          <Button asChild variant="secondary">
            <Link href="/admin/referrals">
              <ArrowLeft className="h-4 w-4" /> All referrers
            </Link>
          </Button>
        }
      />
      {data ? (
        <>
          <div className="mb-6 grid gap-3 rounded-[1.1rem] border border-white/10 bg-black/22 p-4 lg:grid-cols-4">
            <Stat label="Referees" value={data.referredWallets.toString()} />
            <Stat label="Total accrued" value={formatUsdc(data.totalAccruedLamports)} />
            <Stat label="Paid out" value={formatUsdc(data.paidOutLamports)} />
            <Stat label="Balance due" value={formatUsdc(data.balanceDueLamports)} />
          </div>
          <div className="mb-6 flex justify-end">
            <Button
              disabled={data.balanceDueLamports <= 0}
              onClick={() => {
                if (!walletAddress) return;
                runAction(
                  "/api/admin/referrals/payout",
                  "admin-payout-referrals",
                  {
                    adminWalletAddress: walletAddress,
                    referrerWallet: targetWallet,
                  },
                  {
                    successMessage: "Payout batch recorded.",
                    onSuccess: () => mutate(),
                  }
                );
              }}
            >
              Pay out balance
            </Button>
          </div>
          <Section title={`Referees (${data.refereeBreakdown.length})`}>
            <DataTable
              columns={refereeCols}
              data={data.refereeBreakdown}
              rowKey={(row) => row.walletAddress}
              empty="No referees recorded."
            />
          </Section>
          <Section title={`Active accruals (${data.activeAccruals.length})`}>
            <DataTable
              columns={accrualCols}
              data={data.activeAccruals}
              rowKey={(row) => row.id}
              empty="No active accruals."
            />
          </Section>
          <Section title={`Payout history (${data.batches.length})`}>
            <DataTable
              columns={batchCols}
              data={data.batches}
              rowKey={(row) => row.id}
              empty="No batches paid yet."
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-base font-semibold text-foreground">
        {value}
      </p>
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
