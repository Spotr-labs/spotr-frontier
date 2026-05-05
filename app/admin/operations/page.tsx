"use client";

import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ChevronsRight,
  Coins,
  FlagOff,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { Button } from "../../components/ui/button";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import {
  formatRelative,
  formatUsdc,
  formatUtc,
} from "../../components/admin/format";
import { StatusBadge } from "../../components/admin/filters";
import type {
  AdminOpsResponse,
  AdminOpsRoundRow,
  AdminOpsSessionRow,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

export default function AdminOperationsPage() {
  const { walletAddress } = useAdminDashboard();
  const swrKey = walletAddress
    ? `/api/admin/operations?wallet=${encodeURIComponent(walletAddress)}`
    : null;
  const { data, mutate, isLoading } = useSWR<AdminOpsResponse>(swrKey, fetcher, {
    refreshInterval: 15_000,
  });

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Operations"
        title="Launch-day cockpit"
        description="Permissionless on-chain ops. Each click signs a single tx with the connected admin wallet."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => mutate()}
            disabled={isLoading}
          >
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <StaleRoundsCard
          rounds={data?.staleRounds ?? []}
          onAction={() => mutate()}
        />
        <FinalizableSessionsCard
          sessions={data?.finalizableSessions ?? []}
          onAction={() => mutate()}
        />
        <UnsettledRoundsCard rounds={data?.sweepableRounds ?? []} />
        <WithdrawFeesCard
          sessions={data?.withdrawableSessions ?? []}
          onAction={() => mutate()}
        />
      </div>
      <SyncCard onAction={() => mutate()} />
    </div>
  );
}

function OpsCard({
  title,
  icon,
  children,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="rounded-[1.1rem] border border-white/10 bg-black/22 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-primary/15 p-1.5 text-primary">
          {icon}
        </span>
        <h2 className="font-display text-base font-extrabold tracking-[-0.02em] text-foreground">
          {title}
        </h2>
      </div>
      {empty ? (
        <p className="text-sm text-muted">All clear.</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function StaleRoundsCard({
  rounds,
  onAction,
}: {
  rounds: AdminOpsRoundRow[];
  onAction: () => void;
}) {
  const { walletAddress, runAction, closeRoundOnChain } = useAdminDashboard();
  return (
    <OpsCard
      title={`Stale rounds (${rounds.length})`}
      icon={<ChevronsRight className="h-4 w-4" />}
      empty={rounds.length === 0}
    >
      {rounds.map((round) => (
        <div
          key={round.roundId}
          className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/10 bg-black/16 p-3"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              <Link
                href={`/admin/sessions/${round.sessionId}`}
                className="hover:text-primary"
              >
                {round.sessionTitle}
              </Link>
              <span className="text-muted"> · round {round.roundIndex + 1}</span>
            </p>
            <p className="text-[11px] text-muted">
              Closes {formatUtc(round.closesAtIso)} ·{" "}
              {formatRelative(round.closesAtIso)} ·{" "}
              <StatusBadge label={round.status} />
            </p>
          </div>
          <Button
            size="sm"
            disabled={!round.chainSessionNumber}
            onClick={async () => {
              if (!walletAddress) {
                toast.error("Connect an admin wallet first.");
                return;
              }
              if (!round.chainSessionNumber) {
                toast.error("Round's session is not deployed on-chain.");
                return;
              }
              try {
                toast.info("Sign close_round in your wallet…");
                const { signature } = await closeRoundOnChain({
                  sessionNumber: BigInt(round.chainSessionNumber),
                  roundIndex: round.roundIndex,
                });
                runAction(
                  "/api/admin/sessions/close-round",
                  "admin-close-round",
                  {
                    adminWalletAddress: walletAddress,
                    sessionId: round.sessionId,
                    roundId: round.roundId,
                    chainTxSignature: signature,
                  },
                  {
                    successMessage: "Round closed on-chain.",
                    onSuccess: onAction,
                  }
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Close failed."
                );
              }
            }}
          >
            Close round
          </Button>
        </div>
      ))}
    </OpsCard>
  );
}

function FinalizableSessionsCard({
  sessions,
  onAction,
}: {
  sessions: AdminOpsSessionRow[];
  onAction: () => void;
}) {
  const { walletAddress, runAction, finalizeSessionOnChain } =
    useAdminDashboard();
  return (
    <OpsCard
      title={`Sessions ready to finalize (${sessions.length})`}
      icon={<FlagOff className="h-4 w-4" />}
      empty={sessions.length === 0}
    >
      {sessions.map((session) => (
        <div
          key={session.sessionId}
          className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/10 bg-black/16 p-3"
        >
          <div>
            <p className="text-xs font-semibold text-foreground">
              <Link
                href={`/admin/sessions/${session.sessionId}`}
                className="hover:text-primary"
              >
                {session.sessionTitle}
              </Link>
            </p>
            <p className="text-[11px] text-muted">
              Ends {formatUtc(session.endsAtIso)} ·{" "}
              {formatRelative(session.endsAtIso)} · {session.joinedWallets} wallets
            </p>
          </div>
          <Button
            size="sm"
            disabled={!session.chainSessionNumber}
            onClick={async () => {
              if (!walletAddress) {
                toast.error("Connect an admin wallet first.");
                return;
              }
              if (!session.chainSessionNumber) return;
              try {
                toast.info("Sign finalize_session in your wallet…");
                const { signature } = await finalizeSessionOnChain({
                  sessionNumber: BigInt(session.chainSessionNumber),
                });
                runAction(
                  "/api/admin/sessions/finalize-chain",
                  "admin-finalize-session",
                  {
                    adminWalletAddress: walletAddress,
                    sessionId: session.sessionId,
                    chainTxSignature: signature,
                  },
                  {
                    successMessage: "Session finalized on-chain.",
                    onSuccess: onAction,
                  }
                );
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Finalize failed."
                );
              }
            }}
          >
            Finalize
          </Button>
        </div>
      ))}
    </OpsCard>
  );
}

function UnsettledRoundsCard({
  rounds,
}: {
  rounds: AdminOpsRoundRow[];
}) {
  return (
    <OpsCard
      title={`Rounds awaiting settle (${rounds.length})`}
      icon={<Coins className="h-4 w-4" />}
      empty={rounds.length === 0}
    >
      {rounds.map((round) => (
        <div
          key={round.roundId}
          className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/10 bg-black/16 p-3"
        >
          <div>
            <p className="text-xs font-semibold text-foreground">
              <Link
                href={`/admin/sessions/${round.sessionId}`}
                className="hover:text-primary"
              >
                {round.sessionTitle}
              </Link>
              <span className="text-muted">
                {" "}
                · round {round.roundIndex + 1}
              </span>
            </p>
            <p className="text-[11px] text-muted">{round.category}</p>
          </div>
          <Link
            href={`/admin/sessions/${round.sessionId}`}
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            Resolve →
          </Link>
        </div>
      ))}
    </OpsCard>
  );
}

function WithdrawFeesCard({
  sessions,
  onAction,
}: {
  sessions: AdminOpsSessionRow[];
  onAction: () => void;
}) {
  const { walletAddress, runAction, withdrawProtocolFeesOnChain } =
    useAdminDashboard();
  return (
    <OpsCard
      title={`Protocol fee withdrawal (${sessions.length})`}
      icon={<Sparkles className="h-4 w-4" />}
      empty={sessions.length === 0}
    >
      {sessions.map((session) => (
        <div
          key={session.sessionId}
          className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/10 bg-black/16 p-3"
        >
          <div>
            <p className="text-xs font-semibold text-foreground">
              <Link
                href={`/admin/sessions/${session.sessionId}`}
                className="hover:text-primary"
              >
                {session.sessionTitle}
              </Link>
            </p>
            <p className="text-[11px] text-muted">
              Fee accrued: {formatUsdc(session.protocolFeeAccruedLamports)}
            </p>
          </div>
          <Button
            size="sm"
            disabled={!session.chainSessionNumber}
            onClick={async () => {
              if (!walletAddress) {
                toast.error("Connect an admin wallet first.");
                return;
              }
              if (!session.chainSessionNumber) return;
              try {
                toast.info("Sign withdraw_protocol_fees in your wallet…");
                const { signature } = await withdrawProtocolFeesOnChain({
                  sessionNumber: BigInt(session.chainSessionNumber),
                });
                runAction(
                  "/api/admin/sessions/withdraw-fees",
                  "admin-withdraw-protocol-fees",
                  {
                    adminWalletAddress: walletAddress,
                    sessionId: session.sessionId,
                    chainTxSignature: signature,
                  },
                  {
                    successMessage: "Protocol fees withdrawn.",
                    onSuccess: onAction,
                  }
                );
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Withdraw failed."
                );
              }
            }}
          >
            Withdraw fees
          </Button>
        </div>
      ))}
    </OpsCard>
  );
}

function SyncCard({ onAction }: { onAction: () => void }) {
  const { walletAddress, runAction } = useAdminDashboard();
  return (
    <div className="mt-6 rounded-[1.1rem] border border-white/10 bg-black/22 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-extrabold text-foreground">
            DB sync
          </h2>
          <p className="text-xs text-muted">
            Re-runs <code className="font-mono">syncSessionState</code> on every active
            session — useful when chain and DB drift.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (!walletAddress) {
              toast.error("Connect an admin wallet first.");
              return;
            }
            runAction(
              "/api/admin/sync",
              "admin-sync-sessions",
              { adminWalletAddress: walletAddress },
              { successMessage: "Sync triggered.", onSuccess: onAction }
            );
          }}
        >
          <RefreshCcw className="h-4 w-4" /> Run sync
        </Button>
      </div>
    </div>
  );
}
