"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import useSWR from "swr";
import { ArrowLeft, FlagOff, Wallet, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AdminSectionHeader } from "../../../components/admin/section-header";
import { Button } from "../../../components/ui/button";
import { useAdminDashboard } from "../../../components/admin/use-admin-dashboard";
import { StatusBadge } from "../../../components/admin/filters";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
  shortenAddress,
} from "../../../components/admin/format";
import { DataTable } from "../../../components/admin/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  AdminSessionDetail,
  AdminSessionParticipantDetail,
  AdminSessionPositionDetail,
  AdminSessionReferralDetail,
  AdminCardPackTemplate,
  AdminTransactionDetail,
} from "../../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

type PageProps = {
  params: Promise<{ sessionId: string }>;
};

export default function AdminSessionDetailPage({ params }: PageProps) {
  const { sessionId } = use(params);
  const { walletAddress } = useAdminDashboard();
  const swrKey =
    walletAddress && sessionId
      ? `/api/admin/sessions/${sessionId}?wallet=${encodeURIComponent(walletAddress)}`
      : null;
  const { data, mutate, isLoading } = useSWR<AdminSessionDetail>(swrKey, fetcher, {
    refreshInterval: 15_000,
  });

  if (!data && !isLoading) {
    return (
      <div>
        <AdminSectionHeader
          eyebrow="Session"
          title="Not found"
          description="This session does not exist or you do not have access."
        />
        <Button asChild variant="secondary">
          <Link href="/admin/sessions">
            <ArrowLeft className="h-4 w-4" /> Back to sessions
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Session"
        title={data?.title ?? "Loading…"}
        description={data?.slug}
        actions={
          <Button asChild variant="secondary">
            <Link href="/admin/sessions">
              <ArrowLeft className="h-4 w-4" /> All sessions
            </Link>
          </Button>
        }
      />
      {data ? (
        <>
          <SessionHeader detail={data} onRefresh={() => mutate()} />
          <RoundsPanel detail={data} onRefresh={() => mutate()} />
          <ParticipantsTable detail={data} />
          <PositionsTable detail={data} />
          <ReferralsTable detail={data} />
          <CardPackPanel detail={data} onRefresh={() => mutate()} />
          <SessionTransactionsList detail={data} />
        </>
      ) : null}
    </div>
  );
}

function SessionHeader({
  detail,
  onRefresh,
}: {
  detail: AdminSessionDetail;
  onRefresh: () => void;
}) {
  const { walletAddress, runAction, finalizeSessionOnChain, withdrawProtocolFeesOnChain } =
    useAdminDashboard();
  return (
    <div className="mb-6 grid gap-3 rounded-[1.1rem] border border-white/10 bg-black/22 p-4 lg:grid-cols-4">
      <Stat label="Status" value={<StatusBadge label={detail.status} tone={detail.status === "live" ? "success" : detail.status === "completed" ? "primary" : detail.status === "expired" ? "danger" : "warning"} />} />
      <Stat label="Wallets joined" value={detail.joinedWallets} />
      <Stat label="Escrow" value={formatUsdc(detail.totalEscrowLamports)} />
      <Stat label="Protocol fees" value={formatUsdc(detail.protocolFeeAccruedLamports)} />
      <Stat label="Starts" value={`${formatUtc(detail.startsAtIso)} · ${formatRelative(detail.startsAtIso)}`} />
      <Stat label="Ends" value={`${formatUtc(detail.endsAtIso)} · ${formatRelative(detail.endsAtIso)}`} />
      <Stat
        label="Chain session"
        value={
          detail.chainSessionNumber ? (
            <span className="font-mono text-xs">
              #{detail.chainSessionNumber} · {shortenAddress(detail.chainSessionAddress)}
            </span>
          ) : (
            <span className="text-xs text-muted">not deployed</span>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {detail.chainSessionNumber && detail.status === "live" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (!walletAddress) {
                toast.error("Connect an admin wallet first.");
                return;
              }
              try {
                toast.info("Sign finalize_session in your wallet…");
                const { signature } = await finalizeSessionOnChain({
                  sessionNumber: BigInt(detail.chainSessionNumber!),
                });
                runAction(
                  "/api/admin/sessions/finalize-chain",
                  "admin-finalize-session",
                  {
                    adminWalletAddress: walletAddress,
                    sessionId: detail.id,
                    chainTxSignature: signature,
                  },
                  {
                    successMessage: "Session finalized on-chain.",
                    onSuccess: onRefresh,
                  }
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Finalize failed."
                );
              }
            }}
          >
            <FlagOff className="h-3 w-3" /> Finalize chain
          </Button>
        ) : null}
        {detail.chainSessionNumber && detail.protocolFeeAccruedLamports > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (!walletAddress) {
                toast.error("Connect an admin wallet first.");
                return;
              }
              try {
                toast.info("Sign withdraw_protocol_fees in your wallet…");
                const { signature } = await withdrawProtocolFeesOnChain({
                  sessionNumber: BigInt(detail.chainSessionNumber!),
                });
                runAction(
                  "/api/admin/sessions/withdraw-fees",
                  "admin-withdraw-protocol-fees",
                  {
                    adminWalletAddress: walletAddress,
                    sessionId: detail.id,
                    chainTxSignature: signature,
                  },
                  {
                    successMessage: "Protocol fees withdrawn.",
                    onSuccess: onRefresh,
                  }
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Withdraw failed."
                );
              }
            }}
          >
            <Wallet className="h-3 w-3" /> Withdraw fees
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        {label}
      </p>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function RoundsPanel({
  detail,
  onRefresh,
}: {
  detail: AdminSessionDetail;
  onRefresh: () => void;
}) {
  const { walletAddress, runAction, createRoundOnChain, closeRoundOnChain, sweepOrphansOnChain } =
    useAdminDashboard();

  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        Rounds
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {detail.rounds.map((round) => (
          <div
            key={round.id}
            className="rounded-[1.1rem] border border-white/10 bg-black/22 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                  Round {round.index + 1} · {round.category}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {round.sideA} <span className="text-muted">vs</span> {round.sideB}
                </p>
              </div>
              <StatusBadge
                label={round.status}
                tone={
                  round.status === "open"
                    ? "success"
                    : round.status === "closed"
                      ? "primary"
                      : round.status === "skipped"
                        ? "danger"
                        : "warning"
                }
              />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted lg:grid-cols-3">
              <div>
                Side A:{" "}
                <span className="text-foreground">
                  {round.sideAProbabilityPct}% ·{" "}
                  {round.sideATotalEntries} entries
                </span>
              </div>
              <div>
                Side B:{" "}
                <span className="text-foreground">
                  {round.sideBProbabilityPct}% ·{" "}
                  {round.sideBTotalEntries} entries
                </span>
              </div>
              <div>
                Volume:{" "}
                <span className="text-foreground">
                  {formatUsdc(round.totalVolumeLamports)}
                </span>
              </div>
              <div>Closes: {formatUtc(round.closesAtIso)}</div>
              <div>Settled: {formatUtc(round.settledAtIso)}</div>
              <div>Positions: {round.positionsCount}</div>
            </div>
            {detail.chainSessionNumber ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={round.status === "closed" || round.status === "skipped"}
                  onClick={async () => {
                    if (!walletAddress) {
                      toast.error("Connect an admin wallet first.");
                      return;
                    }
                    try {
                      toast.info("Sign create_round in your wallet…");
                      await createRoundOnChain({
                        sessionNumber: BigInt(detail.chainSessionNumber!),
                        roundIndex: round.index,
                        pairId: round.pairId,
                      });
                      toast.success(`Round ${round.index} created on-chain.`);
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Create round failed."
                      );
                    }
                  }}
                >
                  Create round
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={round.status === "closed" || round.status === "skipped"}
                  onClick={async () => {
                    if (!walletAddress) {
                      toast.error("Connect an admin wallet first.");
                      return;
                    }
                    try {
                      toast.info("Sign close_round in your wallet…");
                      const { signature } = await closeRoundOnChain({
                        sessionNumber: BigInt(detail.chainSessionNumber!),
                        roundIndex: round.index,
                      });
                      runAction(
                        "/api/admin/sessions/close-round",
                        "admin-close-round",
                        {
                          adminWalletAddress: walletAddress,
                          sessionId: detail.id,
                          roundId: round.id,
                          chainTxSignature: signature,
                        },
                        {
                          successMessage: "Round closed on-chain.",
                          onSuccess: onRefresh,
                        }
                      );
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Close round failed."
                      );
                    }
                  }}
                >
                  Close round
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={round.status !== "closed"}
                  onClick={async () => {
                    if (!walletAddress) {
                      toast.error("Connect an admin wallet first.");
                      return;
                    }
                    try {
                      toast.info("Sign sweep_orphans in your wallet…");
                      const { signature } = await sweepOrphansOnChain({
                        sessionNumber: BigInt(detail.chainSessionNumber!),
                        roundIndex: round.index,
                      });
                      runAction(
                        "/api/admin/sessions/sweep-orphans",
                        "admin-sweep-orphans",
                        {
                          adminWalletAddress: walletAddress,
                          sessionId: detail.id,
                          roundId: round.id,
                          chainTxSignature: signature,
                        },
                        {
                          successMessage: "Orphans swept.",
                          onSuccess: onRefresh,
                        }
                      );
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Sweep failed."
                      );
                    }
                  }}
                >
                  Sweep orphans
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ParticipantsTable({ detail }: { detail: AdminSessionDetail }) {
  const columns: ColumnDef<AdminSessionParticipantDetail>[] = useMemo(
    () => [
      {
        id: "wallet",
        header: "Wallet",
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
      {
        id: "referrer",
        header: "Referrer",
        cell: ({ row }) =>
          row.original.referredByWallet ? (
            <Link
              href={`/admin/referrals/${row.original.referredByWallet}`}
              className="font-mono text-[11px] hover:text-primary"
            >
              {shortenAddress(row.original.referredByWallet, 4)}
            </Link>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
    ],
    []
  );
  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        Participants ({detail.participants.length})
      </h2>
      <DataTable
        columns={columns}
        data={detail.participants}
        rowKey={(row) => row.id}
        empty="No wallets have joined yet."
      />
    </div>
  );
}

function PositionsTable({ detail }: { detail: AdminSessionDetail }) {
  const columns: ColumnDef<AdminSessionPositionDetail>[] = useMemo(
    () => [
      {
        id: "round",
        header: "Round",
        cell: ({ row }) => row.original.roundIndex + 1,
      },
      {
        id: "wallet",
        header: "Wallet",
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
        id: "fee",
        header: "Fee",
        cell: ({ row }) => formatUsdc(row.original.feeLamports),
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
  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        Positions ({detail.positions.length})
      </h2>
      <DataTable
        columns={columns}
        data={detail.positions}
        rowKey={(row) => row.id}
        empty="No positions yet."
      />
    </div>
  );
}

function ReferralsTable({ detail }: { detail: AdminSessionDetail }) {
  const columns: ColumnDef<AdminSessionReferralDetail>[] = useMemo(
    () => [
      {
        id: "referrer",
        header: "Referrer",
        cell: ({ row }) => (
          <Link
            href={`/admin/referrals/${row.original.referrerWallet}`}
            className="font-mono text-xs hover:text-primary"
          >
            {shortenAddress(row.original.referrerWallet, 6)}
          </Link>
        ),
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
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            label={row.original.status}
            tone={
              row.original.status === "claimed"
                ? "success"
                : row.original.status === "claimable"
                  ? "primary"
                  : "warning"
            }
          />
        ),
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) => formatUsdc(row.original.amountLamports),
      },
      {
        id: "created",
        header: "Created",
        cell: ({ row }) => formatUtc(row.original.createdAtIso),
      },
    ],
    []
  );
  return (
    <div className="mb-8">
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        Referrals ({detail.referrals.length})
      </h2>
      <DataTable
        columns={columns}
        data={detail.referrals}
        rowKey={(row) => row.id}
        empty="No referrals tied to this session yet."
      />
    </div>
  );
}

function CardPackPanel({
  detail,
  onRefresh,
}: {
  detail: AdminSessionDetail;
  onRefresh: () => void;
}) {
  const columns: ColumnDef<AdminCardPackTemplate>[] = useMemo(
    () => [
      { id: "kind", header: "Kind", cell: ({ row }) => row.original.kind },
      { id: "title", header: "Title", cell: ({ row }) => row.original.title },
      {
        id: "subtitle",
        header: "Subtitle",
        cell: ({ row }) => row.original.subtitle,
      },
      {
        id: "createdAt",
        header: "Added",
        cell: ({ row }) => formatUtc(row.original.createdAtIso),
      },
    ],
    []
  );
  const { walletAddress, runAction } = useAdminDashboard();

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-extrabold text-foreground">
          Card-pack templates ({detail.cardPackTemplates.length})
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!walletAddress) {
              toast.error("Connect an admin wallet first.");
              return;
            }
            const title = window.prompt("Template title?");
            if (!title) return;
            const subtitle = window.prompt("Template subtitle?") ?? "";
            if (!subtitle) {
              toast.error("Subtitle required.");
              return;
            }
            const kind = window.prompt(
              "Kind: nft, merch, gift-card, voucher",
              "nft"
            );
            if (!kind) return;
            runAction(
              "/api/admin/sessions/assign-card-pack",
              "admin-assign-card-pack",
              {
                adminWalletAddress: walletAddress,
                sessionId: detail.id,
                items: [{ kind, title, subtitle }],
              },
              {
                successMessage: "Card-pack template added.",
                onSuccess: onRefresh,
              }
            );
          }}
        >
          <Wand2 className="h-3 w-3" /> Add template
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={detail.cardPackTemplates}
        rowKey={(row) => row.id}
        empty="No card-pack templates assigned."
      />
    </div>
  );
}

function SessionTransactionsList({ detail }: { detail: AdminSessionDetail }) {
  const columns: ColumnDef<AdminTransactionDetail>[] = useMemo(
    () => [
      {
        id: "createdAt",
        header: "Time",
        cell: ({ row }) => formatUtc(row.original.createdAtIso),
      },
      { id: "kind", header: "Kind", cell: ({ row }) => row.original.kind },
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
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          row.original.amountLamports != null
            ? formatUsdc(row.original.amountLamports)
            : "—",
      },
    ],
    []
  );
  return (
    <div>
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        Transactions ({detail.transactions.length})
      </h2>
      <DataTable
        columns={columns}
        data={detail.transactions}
        rowKey={(row) => row.id}
        empty="No transactions logged for this session."
      />
    </div>
  );
}
