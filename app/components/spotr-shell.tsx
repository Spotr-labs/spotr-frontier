"use client";

import Link from "next/link";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { WalletButton } from "./wallet-button";
import { useCluster } from "./cluster-context";
import { useWallet } from "../lib/wallet/context";
import { createSignedActionRequest } from "../lib/wallet/signed-request";
import { useBalance } from "../lib/hooks/use-balance";
import { submitJoinSessionOnChain } from "../lib/chain/spotr-join-session";
import { submitDeploySessionOnChain } from "../lib/chain/spotr-deploy-session";
import { ellipsify } from "../lib/explorer";
import type {
  SpotrDashboardPayload,
  SpotrPublicConfig,
  SpotrSide,
} from "../lib/spotr-types";
import type { SpotrSignedActionName } from "../lib/spotr-signed-action";

type SpotrShellProps = {
  config: SpotrPublicConfig;
  initialData: SpotrDashboardPayload;
};

type Notice =
  | {
      tone: "success" | "error" | "info";
      message: string;
    }
  | null;

type RewardFormState = {
  targetWalletAddress: string;
  title: string;
  subtitle: string;
  kind: "nft" | "merch" | "gift-card" | "voucher";
};

type PairImportFormState = {
  csv: string;
};

type SessionDeployFormState = {
  title: string;
  pairIds: string[];
};

type PlayerScreen =
  | "splash"
  | "howto"
  | "entry"
  | "checking"
  | "topup"
  | "confirming"
  | "live"
  | "pnl"
  | "season";

function lamportsToSol(lamports: number, decimals = 3) {
  const sol = lamports / 1_000_000_000;
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function formatBps(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function formatUtc(iso: string | null) {
  if (!iso) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function formatSignedLamports(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${lamportsToSol(Math.abs(value))} SOL`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

function useSpotrDashboard(config: SpotrPublicConfig, initialData: SpotrDashboardPayload) {
  const { wallet, status, signer } = useWallet();
  const { cluster } = useCluster();
  const [data, setData] = useState(initialData);
  const [flipState, setFlipState] = useState(() => ({
    roundId: initialData.session.currentRoundId,
    flipped: false,
  }));
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [notice, setNotice] = useState<Notice>(null);
  const [rewardForm, setRewardForm] = useState<RewardFormState>(() => ({
    targetWalletAddress: initialData.admin.participants[0]?.walletAddress ?? "",
    title: "",
    subtitle: "",
    kind: "nft",
  }));
  const [pairImportForm, setPairImportForm] = useState<PairImportFormState>({
    csv: "",
  });
  const [sessionDeployForm, setSessionDeployForm] = useState<SessionDeployFormState>(
    () => ({
      title: "",
      pairIds: initialData.admin.pairLibrary
        .filter((pair) => pair.active && !pair.assigned)
        .slice(0, config.roundCount)
        .map((pair) => pair.id),
    })
  );
  const [isPending, startTransition] = useTransition();

  const walletAddress = wallet?.account.address ?? null;
  const canSignActions = Boolean(wallet?.signMessage);
  const { session, profile, admin, faultLines } = data;
  const deployablePairs = useMemo(
    () => admin.pairLibrary.filter((pair) => pair.active && !pair.assigned),
    [admin.pairLibrary]
  );
  const selectedDeployPairIds = useMemo(() => {
    const deployablePairIds = new Set(deployablePairs.map((pair) => pair.id));
    return sessionDeployForm.pairIds.filter((pairId) => deployablePairIds.has(pairId));
  }, [deployablePairs, sessionDeployForm.pairIds]);

  const activeRound =
    session.rounds.find((round) => round.status === "open") ??
    session.rounds.find((round) => round.status === "upcoming") ??
    session.rounds.at(-1) ??
    null;
  const activeFaultLine =
    faultLines.find((pair) => pair.roundId === activeRound?.id) ?? faultLines[0] ?? null;
  const activeRoundId = activeRound?.id ?? null;
  const flipped = flipState.roundId === activeRoundId ? flipState.flipped : false;

  const refreshDashboard = useEffectEvent(async (nextWalletAddress?: string | null) => {
    const query = nextWalletAddress
      ? `?wallet=${encodeURIComponent(nextWalletAddress)}`
      : "";
    const response = await fetch(`/api/bootstrap${query}`, {
      cache: "no-store",
    });
    const payload = await readJson<SpotrDashboardPayload>(response);
    setData(payload);
    if (!rewardForm.targetWalletAddress && payload.admin.participants.length > 0) {
      setRewardForm((current) => ({
        ...current,
        targetWalletAddress: payload.admin.participants[0]?.walletAddress ?? "",
      }));
    }
  });

  useEffect(() => {
    startTransition(() => {
      void refreshDashboard(walletAddress).catch((error) => {
        const message =
          error instanceof Error ? error.message : "Failed to refresh SPOTR.";
        setNotice({ tone: "error", message });
      });
    });
  }, [walletAddress]);

  useEffect(() => {
    const closesAtIso = activeRound?.closesAtIso;
    if (!closesAtIso || activeRound?.status !== "open") {
      return;
    }

    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeRound?.closesAtIso, activeRound?.status]);

  const countdown = useMemo(() => {
    const closesAtIso = activeRound?.closesAtIso;
    if (!closesAtIso || activeRound?.status !== "open") {
      return null;
    }

    return Math.max(
      0,
      Math.ceil((new Date(closesAtIso).getTime() - clockMs) / 1000)
    );
  }, [activeRound?.closesAtIso, activeRound?.status, clockMs]);

  const sessionProgress = useMemo(() => {
    return session.totalEscrowLamports / config.sessionMinTotalLamports;
  }, [config.sessionMinTotalLamports, session.totalEscrowLamports]);

  const activeDisplay = useMemo(() => {
    if (!activeFaultLine || !activeRound) return null;
    return {
      side: flipped ? "B" : "A",
      copy: flipped ? activeFaultLine.sideB : activeFaultLine.sideA,
      pct: flipped
        ? activeRound.sideBProbabilityPct
        : activeRound.sideAProbabilityPct,
      opposingPct: flipped
        ? activeRound.sideAProbabilityPct
        : activeRound.sideBProbabilityPct,
      totalEntries: flipped
        ? activeRound.sideBTotalEntries
        : activeRound.sideATotalEntries,
      opposingEntries: flipped
        ? activeRound.sideATotalEntries
        : activeRound.sideBTotalEntries,
    };
  }, [activeFaultLine, activeRound, flipped]);

  async function submitSignedAction<TPayload>(
    url: string,
    action: SpotrSignedActionName,
    payload: TPayload
  ) {
    if (!walletAddress || !wallet) {
      throw new Error("Connect a wallet before submitting this action.");
    }
    if (!wallet.signMessage) {
      throw new Error("This wallet cannot sign SPOTR requests.");
    }

    const signedRequest = await createSignedActionRequest(wallet, action, payload);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    return readJson<SpotrDashboardPayload>(response);
  }

  function runSignedAction<TPayload>(
    url: string,
    action: SpotrSignedActionName,
    payload: TPayload,
    successMessage: string,
    onSuccess?: (nextData: SpotrDashboardPayload) => void
  ) {
    startTransition(() => {
      void (async () => {
        try {
          const nextData = await submitSignedAction(url, action, payload);
          setData(nextData);
          onSuccess?.(nextData);
          setNotice({ tone: "success", message: successMessage });
          toast.success(successMessage);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "SPOTR action failed.";
          setNotice({ tone: "error", message });
          toast.error(message);
        }
      })();
    });
  }

  const handleJoin = () => {
    if (!walletAddress) {
      setNotice({ tone: "error", message: "Connect a wallet before joining the session." });
      return;
    }
    if (!signer) {
      setNotice({
        tone: "error",
        message: "This wallet cannot sign transactions.",
      });
      return;
    }
    if (!data.session.chainSessionNumber) {
      setNotice({
        tone: "error",
        message: "This session has not been deployed on-chain yet.",
      });
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          setNotice({
            tone: "info",
            message: "Sign the transaction in your wallet to pay the buy-in…",
          });
          const { signature } = await submitJoinSessionOnChain({
            cluster,
            sessionNumber: BigInt(data.session.chainSessionNumber!),
            player: signer,
          });
          setNotice({
            tone: "info",
            message: "Transaction confirmed on-chain. Finalising your seat…",
          });
          const nextData = await submitSignedAction(
            "/api/session/join",
            "join-session",
            { walletAddress, chainTxSignature: signature }
          );
          setData(nextData);
          setNotice({ tone: "success", message: "Session joined." });
          toast.success("Session joined.");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not join session.";
          setNotice({ tone: "error", message });
          toast.error(message);
        }
      })();
    });
  };

  const handleEnter = () => {
    if (!walletAddress) {
      setNotice({ tone: "error", message: "Connect a wallet before entering a round." });
      return;
    }
    if (!activeRound || !activeDisplay) {
      setNotice({ tone: "error", message: "There is no active round to enter." });
      return;
    }

    runSignedAction(
      "/api/rounds/enter",
      "enter-round",
      {
        walletAddress,
        roundId: activeRound.id,
        side: activeDisplay.side as SpotrSide,
      },
      `Position locked on side ${activeDisplay.side}.`
    );
  };

  const handleClaimRounds = () => {
    if (!walletAddress) return;
    runSignedAction(
      "/api/claims/rounds",
      "claim-round-proceeds",
      { walletAddress },
      "Round proceeds claimed."
    );
  };

  const handleClaimSessionBalance = () => {
    if (!walletAddress) return;
    runSignedAction(
      "/api/claims/session-balance",
      "claim-session-balance",
      { walletAddress },
      "Returned escrow claimed."
    );
  };

  const handleAssignReward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!walletAddress) return;

    runSignedAction(
      "/api/admin/rewards/assign",
      "admin-assign-reward",
      {
        adminWalletAddress: walletAddress,
        targetWalletAddress: rewardForm.targetWalletAddress,
        title: rewardForm.title,
        subtitle: rewardForm.subtitle,
        kind: rewardForm.kind,
        sessionId: session.id,
      },
      "Reward assigned."
    );

    setRewardForm((current) => ({
      ...current,
      title: "",
      subtitle: "",
    }));
  };

  const handleRewardStatusUpdate = (
    rewardId: string,
    nextStatus: "assigned" | "claimable" | "claimed"
  ) => {
    if (!walletAddress) return;
    runSignedAction(
      "/api/admin/rewards/status",
      "admin-update-reward-status",
      {
        adminWalletAddress: walletAddress,
        rewardId,
        status: nextStatus,
      },
      "Reward status updated."
    );
  };

  const handleImportPairs = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!walletAddress) return;

    runSignedAction(
      "/api/admin/pairs/import",
      "admin-import-pairs",
      {
        adminWalletAddress: walletAddress,
        csv: pairImportForm.csv,
      },
      "Pair library imported.",
      () => {
        setPairImportForm({ csv: "" });
      }
    );
  };

  const handleTogglePair = (pairId: string, active: boolean) => {
    if (!walletAddress) return;

    runSignedAction(
      "/api/admin/pairs/toggle",
      "admin-toggle-pair",
      {
        adminWalletAddress: walletAddress,
        pairId,
        active,
      },
      active ? "Pair activated." : "Pair deactivated."
    );
  };

  const handleDeploySession = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!walletAddress) return;

    runSignedAction(
      "/api/admin/sessions/deploy",
      "admin-deploy-session",
      {
        adminWalletAddress: walletAddress,
        title: sessionDeployForm.title || null,
        pairIds: selectedDeployPairIds,
      },
      "Session deployed.",
      (nextData) => {
        setSessionDeployForm({
          title: "",
          pairIds: nextData.admin.pairLibrary
            .filter((pair) => pair.active && !pair.assigned)
            .slice(0, config.roundCount)
            .map((pair) => pair.id),
        });
      }
    );
  };

  const handleChainDeploy = (session: {
    id: string;
    title: string;
    startsAtIso: string;
    endsAtIso: string;
    createdAtIso: string;
  }) => {
    if (!walletAddress || !signer) {
      setNotice({
        tone: "error",
        message: "Connect your admin wallet to deploy on-chain.",
      });
      return;
    }

    const chainSessionNumber = BigInt(new Date(session.createdAtIso).getTime());
    const startTsSeconds = BigInt(
      Math.floor(new Date(session.startsAtIso).getTime() / 1000)
    );
    const endTsSeconds = BigInt(
      Math.floor(new Date(session.endsAtIso).getTime() / 1000)
    );

    startTransition(() => {
      void (async () => {
        try {
          setNotice({
            tone: "info",
            message: `Sign the deploy tx for "${session.title}" in your wallet…`,
          });
          const { signature } = await submitDeploySessionOnChain({
            cluster,
            admin: signer,
            sessionNumber: chainSessionNumber,
            startTsSeconds,
            endTsSeconds,
          });
          setNotice({
            tone: "info",
            message: "Deploy confirmed on-chain. Finalising record…",
          });
          const nextData = await submitSignedAction(
            "/api/admin/sessions/chain-deploy",
            "admin-chain-deploy-session",
            {
              adminWalletAddress: walletAddress,
              sessionId: session.id,
              chainTxSignature: signature,
              chainSessionNumber: chainSessionNumber.toString(),
            }
          );
          setData(nextData);
          setNotice({ tone: "success", message: "Session deployed on-chain." });
          toast.success("Session deployed on-chain.");
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not deploy session on-chain.";
          setNotice({ tone: "error", message });
          toast.error(message);
        }
      })();
    });
  };

  const handlePayReferral = (referrerWallet: string) => {
    if (!walletAddress) return;

    runSignedAction(
      "/api/admin/referrals/payout",
      "admin-payout-referrals",
      {
        adminWalletAddress: walletAddress,
        referrerWallet,
      },
      "Referral payout batch recorded."
    );
  };

  return {
    walletAddress,
    canSignActions,
    status,
    wallet,
    data,
    session,
    profile,
    admin,
    faultLines,
    activeRound,
    activeFaultLine,
    activeDisplay,
    sessionProgress,
    countdown,
    notice,
    setNotice,
    isPending,
    flipped,
    setFlipState,
    rewardForm,
    setRewardForm,
    pairImportForm,
    setPairImportForm,
    sessionDeployForm,
    setSessionDeployForm,
    deployablePairs,
    selectedDeployPairIds,
    handleJoin,
    handleEnter,
    handleClaimRounds,
    handleClaimSessionBalance,
    handleAssignReward,
    handleRewardStatusUpdate,
    handleImportPairs,
    handleTogglePair,
    handleDeploySession,
    handleChainDeploy,
    handlePayReferral,
  };
}

function triggerUnavailable(message: string) {
  toast.error(message);
}

function SpotrLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        {[18, 36, 54, 72, 108, 126, 144, 162, 198, 216, 234, 252, 288, 306, 324, 342].map(
          (angle) => {
            const rad = (angle * Math.PI) / 180;
            const x1 = 24 + Math.cos(rad) * 15;
            const y1 = 24 + Math.sin(rad) * 15;
            const x2 = 24 + Math.cos(rad) * 20;
            const y2 = 24 + Math.sin(rad) * 20;
            return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2" />;
          }
        )}
        <ellipse cx="24" cy="24" rx="13" ry="8.5" strokeWidth="2.8" />
      </g>
      <circle cx="24" cy="24" r="5" fill="currentColor" />
    </svg>
  );
}

function PageShell({
  title,
  eyebrow,
  children,
  notice,
  variant = "panel",
  hideHeader = false,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  notice: Notice;
  variant?: "player" | "panel";
  hideHeader?: boolean;
}) {
  if (variant === "player") {
    if (hideHeader) {
      return (
        <div className="relative min-h-screen w-full overflow-hidden bg-[#1B4F8C]">
          <main className="relative flex min-h-screen w-full flex-col">
            {children}
          </main>
        </div>
      );
    }

    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: [
              "radial-gradient(circle at 20% 0%, rgba(245,200,0,0.12), transparent 22%)",
              "radial-gradient(circle at 78% 10%, rgba(27,79,140,0.18), transparent 22%)",
              "linear-gradient(180deg, rgba(255,255,255,0.02), transparent 24%)",
            ].join(", "),
          }}
        />

        <div className="relative mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-4 pb-8 pt-4 sm:px-6">
          <header className="mb-4 flex items-center justify-between gap-3 rounded-[1.35rem] border border-white/8 bg-black/18 px-4 py-3 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <span className="text-primary">
                <SpotrLogo size={20} />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                  {eyebrow}
                </p>
                <p className="text-sm font-semibold text-foreground">{title}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 md:flex">
                <NavLink href="/">Play</NavLink>
                <NavLink href="/profile">Profile</NavLink>
                <NavLink href="/admin">Admin</NavLink>
                <NavLink href="/airdrop">Faucet</NavLink>
              </div>
              <WalletButton />
            </div>
          </header>

          {notice && (
            <section
              className={`mx-auto mb-4 w-full max-w-[30rem] rounded-[1.2rem] border px-4 py-3 ${
                notice.tone === "success"
                  ? "border-primary/30 bg-primary/10"
                  : notice.tone === "info"
                    ? "border-muted/30 bg-secondary"
                    : "border-destructive/25 bg-destructive/10"
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  notice.tone === "error" ? "text-destructive" : "text-foreground"
                }`}
              >
                {notice.message}
              </p>
            </section>
          )}

          <main className="mx-auto flex w-full max-w-[1100px] flex-1 items-stretch justify-center">
            <div className="w-full">{children}</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-100"
        style={{
          background: [
            "radial-gradient(circle at 12% 8%, rgba(245,200,0,0.14), transparent 18%)",
            "radial-gradient(circle at 82% 14%, rgba(27,79,140,0.32), transparent 24%)",
            "linear-gradient(180deg, rgba(255,241,228,0.035), transparent 28%)",
          ].join(", "),
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-60"
        style={{
          background:
            "linear-gradient(180deg, rgba(245,200,0,0.12), rgba(245,200,0,0))",
          filter: "blur(72px)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[88rem] flex-col px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <header className="panel-shell mb-8 rounded-[2rem] border border-luxe bg-card/80 p-5 backdrop-blur-xl">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
                <span className="text-primary">
                  <SpotrLogo size={14} />
                </span>
                {eyebrow}
              </div>
              <div className="max-w-4xl">
                <h1 className="display-face text-[2.9rem] text-foreground sm:text-[4.2rem] lg:text-[5.2rem]">
                  {title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
                  Real session state, real wallet-signed actions, and env-backed launch
                  rules only.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 lg:items-end">
              <div className="hidden max-w-sm text-right text-xs uppercase tracking-[0.24em] text-muted md:block">
                Solana opinion markets shaped like a collectible ritual, not a plain
                dashboard.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <NavLink href="/">Play</NavLink>
                <NavLink href="/profile">Profile</NavLink>
                <NavLink href="/admin">Admin</NavLink>
                <NavLink href="/airdrop">Faucet</NavLink>
              </div>
              <WalletButton />
            </div>
          </div>
        </header>

        {notice && (
          <section
            className={`mb-6 rounded-[1.5rem] border px-5 py-4 ${
              notice.tone === "success"
                ? "border-primary/30 bg-primary/10"
                : "border-destructive/25 bg-destructive/10"
            }`}
          >
            <p
              className={`text-sm font-medium ${
                notice.tone === "success" ? "text-foreground" : "text-destructive"
              }`}
            >
              {notice.message}
            </p>
          </section>
        )}

        {children}
      </div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-11 items-center rounded-full border border-luxe bg-secondary/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-foreground transition-[background-color,transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-secondary/80"
    >
      {children}
    </Link>
  );
}

function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`panel-shell rounded-[1.75rem] border border-luxe bg-card/80 p-4 sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
        {eyebrow}
      </p>
      <h2 className="display-face mt-2 text-[2.1rem] text-foreground sm:text-[2.6rem]">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
    </div>
  );
}

function MetricTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-[1.4rem] border px-4 py-4 ${
        accent
          ? "border-primary/35 bg-[linear-gradient(180deg,rgba(245,200,0,0.14),rgba(245,200,0,0.05))]"
          : "border-border-low bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))]"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted">
        {label}
      </p>
      <p className="mt-3 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border-low bg-secondary/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "accent" | "success" | "danger";
}) {
  const className =
    tone === "accent"
      ? "border-primary/30 bg-primary/10 text-primary"
      : tone === "success"
        ? "border-success/30 bg-success/10 text-success"
        : tone === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border-low bg-card text-muted";

  return (
    <span
      className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${className}`}
    >
      {label}
    </span>
  );
}

function GoldButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`focus-ring min-h-14 rounded-[14px] border border-primary/50 bg-primary px-6 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-primary-foreground shadow-[0_2px_0_rgba(0,0,0,0.2),0_12px_28px_rgba(245,200,0,0.22)] transition-[transform,background-color,filter,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-primary/92 hover:shadow-[0_2px_0_rgba(0,0,0,0.2),0_18px_34px_rgba(245,200,0,0.3)] active:scale-[0.985] disabled:cursor-not-allowed disabled:grayscale-[0.5] disabled:opacity-50 ${
        props.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

function OutlineButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`focus-ring min-h-14 rounded-xl border border-white/70 bg-transparent px-6 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-foreground transition-[background-color,transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary/55 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${
        props.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

function WalletBalanceChip({
  balanceLamports,
}: {
  balanceLamports: bigint | number | null;
}) {
  return (
    <div className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-foreground backdrop-blur">
      <span className="text-primary">◎</span>
      <span className="font-mono tabular-nums">
        {balanceLamports == null ? "0.000" : lamportsToSol(Number(balanceLamports))}
      </span>
      <span className="text-xs font-normal uppercase tracking-[0.18em] text-muted">
        SOL
      </span>
    </div>
  );
}

function FaultLineCard({
  category,
  side,
  copy,
  pct,
  opposingPct,
  crowdLabel,
  flipped,
  onFlip,
  locked,
  pulseKey,
}: {
  category: string;
  side: SpotrSide;
  copy: string;
  pct: number;
  opposingPct: number;
  crowdLabel: string;
  entries: number;
  opposingEntries: number;
  flipped: boolean;
  onFlip: () => void;
  locked: boolean;
  pulseKey?: number;
}) {
  return (
    <button
      type="button"
      onClick={onFlip}
      className={`focus-ring relative w-full overflow-hidden rounded-[1.9rem] border bg-white p-6 text-left text-[#1A1A1A] shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition-transform duration-200 hover:-translate-y-1 ${
        locked ? "border-success ring-2 ring-success/40" : "border-white/25"
      }`}
      style={{ minHeight: "28rem", fontFamily: "Arial, sans-serif" }}
      aria-label={`Flip fault line card. Currently showing side ${side}.`}
    >
      {pulseKey !== undefined && (
        <div
          key={pulseKey}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: 30,
            pointerEvents: "none",
            animation: "spotr-momentum-pulse 420ms ease-out forwards",
            opacity: 0,
          }}
        />
      )}
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              style={{
                borderRadius: 999,
                background: "#1B4F8C",
                padding: "3px 12px",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "#fff",
              }}
            >
              {category}
            </span>
            <span
              style={{
                borderRadius: 999,
                background: "rgba(0,0,0,0.05)",
                padding: "3px 12px",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "rgba(26,26,26,0.8)",
              }}
            >
              Side {side}
            </span>
            {locked && (
              <span
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(34,197,94,0.4)",
                  background: "rgba(34,197,94,0.1)",
                  padding: "3px 12px",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  color: "#22C55E",
                }}
              >
                Token bought
              </span>
            )}
          </div>
          <div
            style={{
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.1)",
              background: "rgba(0,0,0,0.05)",
              padding: "4px 12px",
              fontSize: 14,
              fontWeight: 700,
              color: "#1A1A1A",
            }}
          >
            {pct}%
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontWeight: 700,
              fontSize: "clamp(20px, 5.5vw, 26px)",
              lineHeight: 1.22,
              textAlign: "center",
              textWrap: "balance",
              maxWidth: "100%",
            }}
          >
            {copy}
          </p>
        </div>

        <div style={{ marginTop: "auto" }}>
          <div
            style={{
              overflow: "hidden",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.1)",
              background: "#eee",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", height: 32, fontSize: 13, fontWeight: 700, color: "#fff" }}>
              <div
                style={{
                  width: `${pct}%`,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 12,
                  background: flipped ? "#F5C800" : "#1B4F8C",
                  color: flipped ? "#18130b" : "#fff",
                }}
              >
                {pct}%
              </div>
              <div
                style={{
                  width: `${opposingPct}%`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 12,
                  background: flipped ? "#1B4F8C" : "#F5C800",
                  color: flipped ? "#fff" : "#18130b",
                }}
              >
                {opposingPct}%
              </div>
            </div>
          </div>
          <p style={{ textAlign: "center", fontSize: 13, color: "#6B6B6B" }}>
            {pct}% of players spotted this take
          </p>
        </div>
      </div>
    </button>
  );
}

function InfoTone({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/95 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#6B6B6B]">
        {label}
      </p>
      <p className="mt-2 text-sm font-bold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function ClaimRow({
  label,
  value,
  buttonLabel,
  disabled,
  onClick,
}: {
  label: string;
  value: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.4rem] border border-border-low bg-secondary/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
          {label}
        </p>
        <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
      </div>
      <GoldButton type="button" disabled={disabled} onClick={onClick} className="sm:min-w-44">
        {buttonLabel}
      </GoldButton>
    </div>
  );
}

function LabeledInput({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function LedgerPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className={`rounded-full border px-4 py-3 ${
        tone === "accent"
          ? "border-primary/35 bg-primary/10"
          : "border-border-low bg-secondary/45"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function WalletDataRow({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <div className="grid gap-2 border-t border-white/10 py-4 sm:grid-cols-[0.9fr_1.1fr] sm:items-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
        {label}
      </p>
      <div className="sm:text-right">
        <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
        {subvalue ? <p className="mt-1 text-xs text-muted">{subvalue}</p> : null}
      </div>
    </div>
  );
}

export function SpotrShell({ config, initialData }: SpotrShellProps) {
  const state = useSpotrDashboard(config, initialData);
  const balance = useBalance(state.walletAddress ?? undefined);
  const [introSeen, setIntroSeen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("spotr-player-intro-v1") === "seen";
  });
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("spotr-player-intro-v1") !== "seen";
  });
  const [settledRound, setSettledRound] = useState<typeof state.activeRound>(null);
  const [showPnl, setShowPnl] = useState(false);

  useEffect(() => {
    if (!showSplash) return;
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  useEffect(() => {
    if (
      state.countdown === 0 &&
      state.activeRound?.status === "open" &&
      !showPnl
    ) {
      setSettledRound(state.activeRound);
      setShowPnl(true);
      const t = window.setTimeout(() => setShowPnl(false), 5000);
      return () => window.clearTimeout(t);
    }
  }, [state.countdown, state.activeRound, showPnl]);

  const rewardList = state.profile?.rewards ?? [];
  let screen: PlayerScreen =
    state.session.status === "completed"
      ? "season"
      : state.session.joined
        ? "live"
        : !introSeen && showSplash
          ? "splash"
          : !introSeen
            ? "howto"
            : !state.walletAddress
              ? "entry"
              : balance.isLoading
                ? "checking"
                : balance.error
                  ? "entry"
                  : (balance.lamports ?? 0n) < BigInt(config.sessionBuyInLamports)
                    ? "topup"
                    : "confirming";

  if (showPnl && settledRound) screen = "pnl";

  // Only hide the header for full-screen experiences that own the whole viewport.
  // Entry, topup, confirming, etc. all need navigation + the wallet button.
  const hideHeader = screen === "splash" || screen === "howto" || screen === "pnl";

  return (
    <PageShell
      title={config.appName}
      eyebrow={`${config.seasonLabel} · Player Surface`}
      notice={state.notice}
      variant="player"
      hideHeader={hideHeader}
    >
      {screen === "splash" ? (
        <SplashScreen />
      ) : screen === "howto" ? (
        <HowItWorksScreen
          onContinue={() => {
            if (typeof window !== "undefined") {
              window.localStorage.setItem("spotr-player-intro-v1", "seen");
            }
            setIntroSeen(true);
            setShowSplash(false);
          }}
        />
      ) : screen === "entry" ? (
        <EntryScreen />
      ) : screen === "checking" ? (
        <BalanceCheckScreen
          buyInLamports={config.sessionBuyInLamports}
          balanceLamports={balance.lamports}
          isLoading={balance.isLoading}
        />
      ) : screen === "topup" ? (
        <TopUpScreen
          config={config}
          balanceLamports={balance.lamports}
        />
      ) : screen === "confirming" ? (
        <ConfirmSessionScreen
          state={state}
        />
      ) : screen === "pnl" && settledRound ? (
        <PnlScreen
          round={settledRound}
          totalRounds={config.roundCount}
          activeFaultLine={state.activeFaultLine}
          onContinue={() => setShowPnl(false)}
        />
      ) : screen === "season" ? (
        <SeasonScreen
          profile={state.profile}
          rewards={rewardList}
          onUnavailable={triggerUnavailable}
        />
      ) : (
        <LiveGameScreen config={config} state={state} balanceLamports={balance.lamports} />
      )}
    </PageShell>
  );
}

function SplashScreen() {
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center"
      style={{ background: "#1B4F8C" }}
    >
      <div className="motion-splash-pulse text-primary">
        <SpotrLogo size={96} />
      </div>
      <p
        style={{
          color: "rgba(255,255,255,0.85)",
          fontFamily: "Arial, sans-serif",
          fontSize: 16,
          marginTop: 20,
          fontWeight: 400,
        }}
      >
        Backed by belief
      </p>
    </div>
  );
}

function HowItWorksScreen({ onContinue }: { onContinue: () => void }) {
  const steps = [
    {
      glyph: "🎯",
      title: "Spot the take the crowd moves toward",
      body: "Each card shows a cultural fault line. Back the side you think wins.",
    },
    {
      glyph: "⚡",
      title: "30 seconds. Then the round closes.",
      body: "The momentum bar shows live pressure. The round settles when the timer runs out — not when you pick.",
    },
    {
      glyph: "🎁",
      title: "Earn your Conviction Card",
      body: "Complete the season to unlock a Conviction Card. Real rewards inside.",
    },
  ];

  return (
    <div
      className="flex min-h-screen w-full flex-col"
      style={{
        background: "#1B4F8C",
        padding: "56px 24px 28px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div className="mb-8 flex items-center gap-3">
        <span className="text-primary">
          <SpotrLogo size={32} />
        </span>
        <span style={{ color: "#F5C800", fontWeight: 700, fontSize: 16 }}>SPOTR.TV</span>
      </div>

      <h1
        style={{
          color: "#fff",
          fontWeight: 700,
          fontSize: 34,
          lineHeight: 1.1,
          marginBottom: 12,
        }}
      >
        How it works
      </h1>
      <p
        style={{
          color: "rgba(255,255,255,0.65)",
          fontSize: 16,
          marginBottom: 40,
          lineHeight: 1.5,
        }}
      >
        Seven rounds. Real culture. No wrong answers, only early ones.
      </p>

      <div className="flex flex-col gap-0">
        {steps.map((step, i) => (
          <div key={i}>
            <div className="flex items-start gap-4 py-5">
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "rgba(245,200,0,0.15)",
                  border: "1.5px solid rgba(245,200,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                {step.glyph}
              </div>
              <div>
                <p style={{ color: "#fff", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                  {step.title}
                </p>
                <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 1.5 }}>
                  {step.body}
                </p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 1, background: "rgba(255,255,255,0.12)" }} />
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-10">
        <GoldButton type="button" onClick={onContinue} className="w-full">
          Continue
        </GoldButton>
      </div>
    </div>
  );
}

function EntryScreen() {
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center"
      style={{
        background: "#1B4F8C",
        padding: "56px 24px 32px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div className="mb-8 text-primary">
        <SpotrLogo size={40} />
      </div>

      <h1
        style={{
          color: "#fff",
          fontWeight: 700,
          fontSize: 40,
          lineHeight: 1.1,
          textAlign: "center",
          textWrap: "balance",
          marginBottom: 16,
          maxWidth: 340,
        }}
      >
        What do you actually think?
      </h1>

      <p
        style={{
          color: "rgba(255,255,255,0.6)",
          fontSize: 16,
          textAlign: "center",
          maxWidth: 320,
          lineHeight: 1.55,
          marginBottom: 40,
        }}
      >
        Connect a Solana wallet with at least 0.035 SOL to start a session.
      </p>

      <div className="w-full max-w-[340px]">
        <WalletButton />
      </div>

      <p
        style={{
          color: "rgba(255,255,255,0.5)",
          fontSize: 13,
          textAlign: "center",
          marginTop: 32,
          maxWidth: 300,
          lineHeight: 1.5,
        }}
      >
        All positions settle on Solana mainnet. · SPOTR.TV never has custody of your funds.
      </p>
    </div>
  );
}

function BalanceCheckScreen({
  buyInLamports,
  balanceLamports,
  isLoading,
}: {
  buyInLamports: number;
  balanceLamports: bigint | number | null;
  isLoading: boolean;
}) {
  const [phase, setPhase] = useState<"checking" | "success" | "low">("checking");

  useEffect(() => {
    if (isLoading) {
      setPhase("checking");
      return;
    }
    const t = window.setTimeout(() => {
      if (balanceLamports == null) {
        setPhase("checking");
        return;
      }
      const bal = Number(balanceLamports);
      setPhase(bal >= buyInLamports ? "success" : "low");
    }, 1600);
    return () => window.clearTimeout(t);
  }, [isLoading, balanceLamports, buyInLamports]);

  const balSol = balanceLamports != null ? lamportsToSol(Number(balanceLamports)) : "0";
  const minSol = lamportsToSol(buyInLamports);

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center"
      style={{ background: "#0D1B2E", padding: "56px 24px", fontFamily: "Arial, sans-serif" }}
    >
      <div className="mb-8 text-primary">
        <SpotrLogo size={40} />
      </div>

      {phase === "checking" && (
        <>
          <div
            className="motion-spin mb-6"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: "4px solid rgba(245,200,0,0.2)",
              borderTopColor: "#F5C800",
            }}
          />
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 20, textAlign: "center", marginBottom: 8 }}>
            Checking your wallet balance…
          </p>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14 }}>
            Minimum entry: {minSol} SOL
          </p>
        </>
      )}

      {phase === "success" && (
        <>
          <div
            className="motion-check-pop mb-6 flex items-center justify-center"
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "rgba(34,197,94,0.15)",
              border: "2px solid #22C55E",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 20, textAlign: "center", marginBottom: 8 }}>
            Balance: {balSol} SOL
          </p>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 15 }}>You're cleared to play.</p>
        </>
      )}

      {phase === "low" && (
        <>
          <div
            className="motion-check-pop mb-6 flex items-center justify-center"
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "rgba(239,68,68,0.15)",
              border: "2px solid #ef4444",
            }}
          >
            <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 26 }}>!</span>
          </div>
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 20, textAlign: "center", marginBottom: 8 }}>
            Balance too low
          </p>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 15, textAlign: "center" }}>
            You have {balSol} SOL. Top up to at least {minSol} SOL to play.
          </p>
        </>
      )}
    </div>
  );
}

function TopUpScreen({
  config,
  balanceLamports,
}: {
  config: SpotrPublicConfig;
  balanceLamports: bigint | number | null;
}) {
  const balSol = Number(balanceLamports ?? 0n) / 1_000_000_000;
  const minSol = config.sessionBuyInLamports / 1_000_000_000;
  const shortfall = Math.max(0, minSol - balSol);
  const [amount, setAmount] = useState(
    parseFloat(shortfall.toFixed(3)) || 0.05
  );
  const presets = [0.05, 0.1, 0.25];

  return (
    <div
      className="flex min-h-screen w-full flex-col"
      style={{
        background: "#1B4F8C",
        padding: "40px 24px 24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div className="mb-6 text-primary">
        <SpotrLogo size={32} />
      </div>

      <h2 style={{ color: "#fff", fontWeight: 700, fontSize: 28, marginBottom: 12 }}>
        Top up to play.
      </h2>
      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 15, marginBottom: 24, lineHeight: 1.5 }}>
        Your wallet has {balSol.toFixed(3)} SOL. You need at least {minSol.toFixed(3)} SOL to start a session.
      </p>

      <div
        style={{
          background: "rgba(0,0,0,0.25)",
          borderRadius: 16,
          padding: "16px 20px",
          marginBottom: 20,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>Current</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>{balSol.toFixed(3)} SOL</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" }}>Short by</span>
          <span style={{ color: "#ef4444", fontWeight: 600, fontSize: 15 }}>{shortfall.toFixed(3)} SOL</span>
        </div>
      </div>

      <div
        className="flex items-center gap-2 mb-4"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "10px 14px",
        }}
      >
        <button
          type="button"
          onClick={() => setAmount((v) => Math.max(0.001, parseFloat((v - 0.01).toFixed(3))))}
          style={{ color: "#1B4F8C", fontWeight: 700, fontSize: 20, lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}
        >
          −
        </button>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
          step="0.01"
          min="0"
          style={{
            flex: 1,
            textAlign: "center",
            color: "#1A1A1A",
            fontWeight: 700,
            fontSize: 18,
            border: "none",
            outline: "none",
            background: "none",
          }}
        />
        <span style={{ color: "#666", fontSize: 14, fontWeight: 600 }}>SOL</span>
        <button
          type="button"
          onClick={() => setAmount((v) => parseFloat((v + 0.01).toFixed(3)))}
          style={{ color: "#1B4F8C", fontWeight: 700, fontSize: 20, lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}
        >
          +
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(p)}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: 10,
              border: amount === p ? "2px solid #F5C800" : "1.5px solid rgba(255,255,255,0.3)",
              background: amount === p ? "rgba(245,200,0,0.15)" : "transparent",
              color: amount === p ? "#F5C800" : "rgba(255,255,255,0.8)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {p} SOL
          </button>
        ))}
      </div>

      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 20 }}>
        New balance: {(balSol + amount).toFixed(3)} SOL
      </p>

      <GoldButton
        type="button"
        disabled={amount < shortfall}
        onClick={() => toast.error("Top-up requires external wallet flow")}
        className="w-full"
      >
        Add {amount.toFixed(3)} SOL to Wallet
      </GoldButton>

      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, textAlign: "center", marginTop: 16 }}>
        Funds stay in your wallet. SPOTR never has custody.
      </p>
    </div>
  );
}

function ConfirmSessionScreen({
  state,
}: {
  state: ReturnType<typeof useSpotrDashboard>;
}) {
  const [joinCalled, setJoinCalled] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);

  useEffect(() => {
    if (!joinCalled && !state.session.joined && !state.isPending && state.canSignActions) {
      setJoinCalled(true);
      try {
        state.handleJoin();
      } catch {
        setJoinFailed(true);
      }
    }
  }, [joinCalled, state]);

  const done = state.session.joined;

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center"
      style={{ background: "#0D1B2E", padding: "56px 24px", fontFamily: "Arial, sans-serif" }}
    >
      <div className="mb-8 text-primary">
        <SpotrLogo size={44} />
      </div>

      {!joinFailed ? (
        <>
          {!done ? (
            <>
              <div
                className="motion-spin mb-6"
                style={{
                  width: 64, height: 64, borderRadius: "50%",
                  border: "4px solid rgba(245,200,0,0.2)",
                  borderTopColor: "#F5C800",
                }}
              />
              <p style={{ color: "#fff", fontWeight: 700, fontSize: 20, textAlign: "center" }}>
                Confirming on Solana…
              </p>
            </>
          ) : (
            <>
              <div
                className="motion-check-pop mb-6 flex items-center justify-center"
                style={{
                  width: 64, height: 64, borderRadius: "50%",
                  background: "rgba(34,197,94,0.15)",
                  border: "2px solid #22C55E",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p style={{ color: "#fff", fontWeight: 700, fontSize: 20, textAlign: "center" }}>
                You're in. Session starts now.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <p style={{ color: "#ef4444", fontSize: 16, marginBottom: 20 }}>Join failed. Please try again.</p>
          <GoldButton type="button" onClick={() => { setJoinCalled(false); setJoinFailed(false); }}>
            Try again
          </GoldButton>
        </>
      )}
    </div>
  );
}

function LockedInBar({ copy, countdown }: { copy: string; countdown: number | null }) {
  return (
    <div
      style={{
        height: 56,
        borderRadius: 14,
        background: "rgba(34,197,94,0.12)",
        border: "1.5px solid #22C55E",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 16px",
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#22C55E",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          "{copy}"
        </p>
        <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
          Token bought · settles in {countdown ?? "—"}s
        </p>
      </div>
    </div>
  );
}

function LiveGameScreen({
  config,
  state,
  balanceLamports,
}: {
  config: SpotrPublicConfig;
  state: ReturnType<typeof useSpotrDashboard>;
  balanceLamports: bigint | number | null;
}) {
  const [pulseKey, setPulseKey] = useState(0);
  const [buyFlash, setBuyFlash] = useState(false);

  useEffect(() => {
    let running = true;
    function schedulePulse() {
      if (!running) return;
      const delay = 600 + Math.random() * 1800;
      window.setTimeout(() => {
        if (!running) return;
        setPulseKey((k) => k + 1);
        schedulePulse();
      }, delay);
    }
    schedulePulse();
    return () => { running = false; };
  }, []);

  const roundProgress =
    state.countdown == null
      ? 0
      : Math.max(0, Math.min(100, (state.countdown / config.roundDurationSeconds) * 100));

  const isLocked = Boolean(state.activeRound?.lockedSide);

  function handleBuy() {
    setBuyFlash(true);
    window.setTimeout(() => setBuyFlash(false), 260);
    state.handleEnter();
  }

  return (
    <div
      className="flex min-h-screen w-full flex-col"
      style={{ background: "#0D1B2E", fontFamily: "Arial, sans-serif" }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 0",
        }}
      >
        <span className="text-primary">
          <SpotrLogo size={28} />
        </span>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
          Round {state.activeRound?.index ?? config.roundCount} of {config.roundCount}
        </span>
        <WalletBalanceChip balanceLamports={balanceLamports} />
      </div>

      {/* Timer bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.1)", margin: "12px 0 0" }}>
        <div
          style={{
            height: "100%",
            width: `${roundProgress}%`,
            background: state.countdown != null && state.countdown <= 10 ? "#ef4444" : "#F5C800",
            transition: "none",
          }}
        />
      </div>

      {/* Card */}
      <div style={{ padding: "16px 16px 0", flex: 1, display: "flex", flexDirection: "column" }}>
        {state.activeFaultLine && state.activeRound && state.activeDisplay ? (
          <FaultLineCard
            category={state.activeFaultLine.category}
            side={state.activeDisplay.side as SpotrSide}
            copy={state.activeDisplay.copy}
            pct={state.activeDisplay.pct}
            opposingPct={state.activeDisplay.opposingPct}
            crowdLabel={state.activeFaultLine.crowdLabel}
            entries={state.activeDisplay.totalEntries}
            opposingEntries={state.activeDisplay.opposingEntries}
            flipped={state.flipped}
            onFlip={() =>
              state.setFlipState((current) => ({
                roundId: state.activeRound?.id ?? current.roundId,
                flipped:
                  current.roundId === state.activeRound?.id ? !current.flipped : true,
              }))
            }
            locked={isLocked}
            pulseKey={pulseKey}
          />
        ) : (
          <div
            style={{
              borderRadius: 24,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              padding: 24,
              color: "rgba(255,255,255,0.5)",
              fontSize: 14,
            }}
          >
            No deployed session data is available yet.
          </div>
        )}

        {/* Helper text */}
        <p
          style={{
            color: "rgba(255,255,255,0.4)",
            fontSize: 13,
            textAlign: "center",
            marginTop: 14,
            marginBottom: 12,
          }}
        >
          {isLocked
            ? `Position locked · settles in ${state.countdown ?? "—"}s`
            : "Tap card to flip · buy either side"}
        </p>

        {/* Buy / Locked */}
        {isLocked ? (
          <LockedInBar
            copy={state.activeDisplay?.copy ?? ""}
            countdown={state.countdown}
          />
        ) : (
          <GoldButton
            type="button"
            onClick={handleBuy}
            disabled={
              state.isPending ||
              !state.session.joined ||
              !state.canSignActions ||
              state.activeRound?.status !== "open" ||
              state.activeRound == null
            }
            style={
              buyFlash
                ? { background: "#22C55E", transition: "none" }
                : undefined
            }
          >
            {buyFlash
              ? "Locked in ✓"
              : state.isPending
                ? "Locking position..."
                : `Buy side ${state.activeDisplay?.side ?? "A"} · ${state.activeDisplay?.pct ?? 0}% →`}
          </GoldButton>
        )}

        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, textAlign: "center", marginTop: 10, marginBottom: 20 }}>
          No mock fills. Positions settle on Solana.
        </p>
      </div>
    </div>
  );
}

function CountUp({
  value,
  duration = 800,
  format,
}: {
  value: number;
  duration?: number;
  format: (v: number) => string;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    function tick() {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <>{format(display)}</>;
}

function ConvictionCard({ size = 180, bounce = false }: { size?: number; bounce?: boolean }) {
  const w = Math.round(size * (5 / 7));
  const h = size;
  return (
    <div
      style={{
        width: w,
        height: h,
        position: "relative",
        animation: bounce ? "spotr-conv-bounce 2s ease-in-out infinite" : "none",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(155deg, #0F2A4A 0%, #1B4F8C 45%, #0D1B2E 100%)",
          borderRadius: 16,
          border: "2px solid #F5C800",
          boxShadow: "0 18px 48px rgba(0,0,0,0.55), 0 0 40px rgba(245,200,0,0.15)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Corner braces */}
        {([
          { top: 8, left: 8, borderTop: "2px solid #F5C800", borderLeft: "2px solid #F5C800" },
          { top: 8, right: 8, borderTop: "2px solid #F5C800", borderRight: "2px solid #F5C800" },
          { bottom: 8, left: 8, borderBottom: "2px solid #F5C800", borderLeft: "2px solid #F5C800" },
          { bottom: 8, right: 8, borderBottom: "2px solid #F5C800", borderRight: "2px solid #F5C800" },
        ] as React.CSSProperties[]).map((s, i) => (
          <div key={i} style={{ ...s, width: 22, height: 22, position: "absolute" }} />
        ))}

        <p style={{ color: "#F5C800", fontSize: 10, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 }}>
          CONVICTION
        </p>
        <div style={{ color: "#F5C800" }}>
          <SpotrLogo size={Math.round(size * 0.55)} />
        </div>
        <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", marginTop: 8 }}>
          SEALED · SEASON 1
        </p>

        {/* S1 sigil */}
        <div
          style={{
            position: "absolute",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "1.5px solid #F5C800",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: "#F5C800", fontSize: 11, fontWeight: 700 }}>S1</span>
        </div>

        {/* Shimmer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(115deg, transparent 30%, rgba(245,200,0,0.25) 50%, transparent 70%)",
            animation: "spotr-conv-shimmer 3.5s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

function PnlScreen({
  round,
  totalRounds,
  activeFaultLine,
  onContinue,
}: {
  round: NonNullable<ReturnType<typeof useSpotrDashboard>["activeRound"]>;
  totalRounds: number;
  activeFaultLine: ReturnType<typeof useSpotrDashboard>["activeFaultLine"];
  onContinue: () => void;
}) {
  const [secLeft, setSecLeft] = useState(5);

  useEffect(() => {
    const t = window.setInterval(() => {
      setSecLeft((s) => {
        if (s <= 1) { window.clearInterval(t); onContinue(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [onContinue]);

  const pnl = round.claimableLamports - (round.stakeLamports ?? 0);
  const faultLine = activeFaultLine;
  const isSkip = !round.lockedSide;
  const isWin = !isSkip && pnl > 0;
  const isLoss = !isSkip && pnl <= 0;

  const resultCopy = isSkip
    ? "You sat this one out."
    : isWin
      ? "The crowd moved your way. You spotted it early."
      : "The crowd didn't follow. Better read, next round.";

  const pnlColor = isWin ? "#22C55E" : isLoss ? "#ef4444" : "rgba(255,255,255,0.7)";

  const finalPct = round.lockedSide === "A"
    ? round.sideAProbabilityPct
    : round.lockedSide === "B"
      ? round.sideBProbabilityPct
      : null;

  const lockedCopy = round.lockedSide === "A"
    ? faultLine?.sideA
    : round.lockedSide === "B"
      ? faultLine?.sideB
      : null;

  return (
    <div
      className="motion-slide-up-full flex min-h-screen w-full flex-col overflow-y-auto"
      style={{ background: "#0D1B2E", padding: "40px 24px 28px", fontFamily: "Arial, sans-serif" }}
    >
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="text-primary"><SpotrLogo size={44} /></div>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
          Round {round.index} of {totalRounds}
        </p>
      </div>

      {lockedCopy && (
        <div
          style={{
            border: "1px solid rgba(245,200,0,0.3)",
            borderRadius: 16,
            padding: "16px 20px",
            marginBottom: 20,
            background: "rgba(245,200,0,0.06)",
          }}
        >
          <p style={{ color: "#F5C800", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 8 }}>
            YOUR POSITION
          </p>
          <p style={{ color: "#fff", fontSize: 15, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>
            "{lockedCopy}"
          </p>
          {finalPct !== null && (
            <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13 }}>
              Final crowd share: {finalPct}%
            </p>
          )}
        </div>
      )}

      <div
        style={{
          borderRadius: 16,
          padding: "20px 20px",
          marginBottom: 24,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <p style={{ color: "#F5C800", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 12 }}>
          PNL
        </p>
        <p style={{ color: pnlColor, fontSize: 38, fontWeight: 700, marginBottom: 8 }}>
          {isSkip ? "—" : (
            <CountUp
              value={pnl / 1_000_000_000}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(4)} SOL`}
            />
          )}
        </p>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 1.5 }}>
          {resultCopy}
        </p>
      </div>

      <div className="mt-auto">
        <GoldButton type="button" onClick={onContinue} className="w-full mb-2">
          Next Round → ({secLeft}s)
        </GoldButton>
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: "rgba(245,200,0,0.2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              background: "#F5C800",
              width: `${(secLeft / 5) * 100}%`,
              transition: "width 1s linear",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SeasonScreen({
  profile,
  rewards,
  onUnavailable,
}: {
  profile: SpotrDashboardPayload["profile"];
  rewards: NonNullable<SpotrDashboardPayload["profile"]>["rewards"];
  onUnavailable: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"arrive" | "hold" | "tearing" | "revealed">("arrive");
  const holdTimer = useRef<number | null>(null);

  const mockPrizes = [
    { id: "mock-1", kind: "nft" as const, title: "SPOTR Genesis NFT", subtitle: "Season 1 · Limited edition", status: "claimable" as const },
    { id: "mock-2", kind: "merch" as const, title: "SPOTR Drop Kit", subtitle: "Physical merch · Ships Q2", status: "claimable" as const },
    { id: "mock-3", kind: "gift-card" as const, title: "$50 Gift Card", subtitle: "Digital delivery", status: "claimable" as const },
  ];
  const prizeList = (rewards.length > 0 ? rewards : mockPrizes) as typeof mockPrizes;

  const cumPnl = profile?.cumulativePnlLamports ?? 0;
  const roundsSettled = profile?.paidSessions ?? 0;

  function handleCardPress() {
    if (phase !== "arrive") return;
    setPhase("hold");
    holdTimer.current = window.setTimeout(() => {
      setPhase("tearing");
      window.setTimeout(() => setPhase("revealed"), 700);
    }, 600);
  }

  function handleCardRelease() {
    if (phase === "hold" && holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      setPhase("arrive");
    }
  }

  const pnlColor = cumPnl >= 0 ? "#22C55E" : "#ef4444";

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center overflow-hidden"
      style={{ background: "#1B4F8C", padding: "36px 24px 24px", fontFamily: "Arial, sans-serif" }}
    >
      <div className="mb-6 text-primary"><SpotrLogo size={40} /></div>

      <p style={{ color: pnlColor, fontSize: 36, fontWeight: 700, marginBottom: 4 }}>
        <CountUp value={cumPnl / 1_000_000_000} format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} SOL`} />
      </p>
      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 32 }}>
        Season 1 · {roundsSettled} round{roundsSettled !== 1 ? "s" : ""} settled
      </p>

      {phase === "arrive" && (
        <>
          <h2 style={{ color: "#fff", fontWeight: 700, fontSize: 26, marginBottom: 24, textAlign: "center" }}>
            Tear it open.
          </h2>
          <div
            onMouseDown={handleCardPress}
            onMouseUp={handleCardRelease}
            onTouchStart={handleCardPress}
            onTouchEnd={handleCardRelease}
            style={{ cursor: "pointer" }}
          >
            <ConvictionCard size={220} bounce={true} />
          </div>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 16 }}>
            Hold to reveal
          </p>
        </>
      )}

      {phase === "hold" && (
        <>
          <h2 style={{ color: "#fff", fontWeight: 700, fontSize: 26, marginBottom: 24, textAlign: "center" }}>
            Hold…
          </h2>
          <ConvictionCard size={220} bounce={false} />
        </>
      )}

      {phase === "tearing" && (
        <div style={{ opacity: 0, transform: "scale(1.15)", transition: "all 0.7s", animation: "spotr-flash-burst 500ms ease-out forwards" }}>
          <ConvictionCard size={220} />
        </div>
      )}

      {phase === "revealed" && (
        <div className="w-full max-w-sm">
          <h2 style={{ color: "#fff", fontWeight: 700, fontSize: 22, marginBottom: 20, textAlign: "center" }}>
            Your haul
          </h2>
          <div className="flex flex-col gap-3 mb-8">
            {prizeList.map((prize, i) => (
              <div
                key={prize.id}
                className="motion-prize-in"
                style={{
                  animationDelay: `${i * 150}ms`,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 16,
                  padding: "12px 16px",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 58,
                    borderRadius: 8,
                    background: "linear-gradient(135deg, #1B4F8C, #0D1B2E)",
                    border: "1.5px solid #F5C800",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <p style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{prize.title}</p>
                  <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{prize.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onUnavailable("Reward claim flow is not implemented in SPOTR yet.")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    background: "#F5C800",
                    color: "#18130b",
                    fontWeight: 700,
                    fontSize: 13,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Claim
                </button>
              </div>
            ))}
          </div>
          <GoldButton type="button" className="w-full mb-3">
            Play Next Session
          </GoldButton>
          <button
            type="button"
            onClick={() => onUnavailable("Sharing haul is not implemented yet.")}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: 14,
              border: "1.5px solid rgba(255,255,255,0.4)",
              background: "transparent",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Share my haul
          </button>
        </div>
      )}
    </div>
  );
}

export function SpotrProfileShell({ config, initialData }: SpotrShellProps) {
  const state = useSpotrDashboard(config, initialData);

  return (
    <PageShell
      title="Wallet profile"
      eyebrow={`${config.seasonLabel} · Profile`}
      notice={state.notice}
    >
      {!state.walletAddress ? (
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <SectionCard className="overflow-hidden bg-[var(--gradient-accent)] text-accent-foreground">
            <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-primary">
                  Wallet dossier
                </p>
                <h2 className="display-face max-w-xl text-[3.4rem] leading-[0.92] text-balance text-accent-foreground sm:text-[4.5rem]">
                  Connect a wallet to open your SPOTR ledger.
                </h2>
                <p className="max-w-lg text-sm leading-relaxed text-accent-foreground/74">
                  Claims, referral balances, assigned rewards, and paid-session history
                  are wallet-scoped and read from persisted backend state.
                </p>
              </div>
              <div className="rounded-[1.8rem] border border-white/10 bg-white/10 p-5 backdrop-blur">
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
                  What unlocks
                </p>
                <div className="mt-4 space-y-4">
                  <WalletDataRow
                    label="Claims"
                    value="Round proceeds and returned escrow"
                  />
                  <WalletDataRow
                    label="Referrals"
                    value="Pending balances and payout history"
                  />
                  <WalletDataRow
                    label="Rewards"
                    value="Assigned inventory only"
                    subvalue="Unimplemented claim execution remains unavailable."
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard className="bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.02))]">
            <SectionHeading
              eyebrow="Access"
              title="Wallet-gated view"
              description="This route stays empty until a connected wallet resolves to a persisted SPOTR profile."
            />
            <div className="mt-6 flex flex-wrap gap-3">
              <LedgerPill label="Profile source" value="Connected wallet address" tone="accent" />
              <LedgerPill label="Claims mode" value="Signed requests only" />
              <LedgerPill label="Rewards mode" value="Read-only if unimplemented" />
            </div>
          </SectionCard>
        </div>
      ) : !state.profile ? (
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <SectionCard className="overflow-hidden bg-[linear-gradient(155deg,#10243d_0%,#0d1b2e_54%,#07111d_100%)] text-foreground">
            <SectionHeading
              eyebrow="Wallet dossier"
              title="No SPOTR profile has been written for this wallet yet."
              description="The wallet is connected, but there is no persisted profile record to read from sessions, referrals, rewards, or claims."
            />
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <MetricTile label="Wallet" value="Connected" accent />
              <MetricTile label="Profile" value="Missing" />
              <MetricTile label="Claims" value="Unavailable" />
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeading
              eyebrow="Why this happens"
              title="No paid-session footprint"
              description="This route will populate after the wallet joins a session or receives persisted referral or reward state."
            />
          </SectionCard>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <SectionCard className="overflow-hidden bg-[linear-gradient(180deg,rgba(16,36,61,0.96),rgba(7,17,29,0.98))] text-foreground">
            <div className="grid gap-8">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                  Wallet dossier
                </div>
                <h2 className="display-face max-w-xl text-[3rem] leading-[0.92] text-balance text-foreground sm:text-[4rem]">
                  {state.profile.walletAddress}
                </h2>
                <p className="max-w-lg text-sm leading-relaxed text-muted">
                  Referral balances, claimable value, and reward inventory are read from
                  the persisted SPOTR backend for this wallet.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <LedgerPill label="Paid sessions" value={String(state.profile.paidSessions)} />
                <LedgerPill
                  label="Cumulative PnL"
                  value={formatSignedLamports(state.profile.cumulativePnlLamports)}
                  tone="accent"
                />
                <LedgerPill
                  label="Referred wallets"
                  value={String(state.profile.referredWallets)}
                />
                <LedgerPill
                  label="Referral pending"
                  value={`${lamportsToSol(state.profile.referralPendingLamports)} SOL`}
                />
              </div>

              <div className="rounded-[1.8rem] border border-white/10 bg-white/10 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                  Claim window
                </p>
                <div className="mt-4">
                  <WalletDataRow
                    label="Round proceeds"
                    value={`${lamportsToSol(state.profile.claimableRoundLamports)} SOL`}
                  />
                  <WalletDataRow
                    label="Returned escrow"
                    value={`${lamportsToSol(state.profile.claimableSessionBalanceLamports)} SOL`}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <ClaimRow
                  label="Round proceeds"
                  value={`${lamportsToSol(state.profile.claimableRoundLamports)} SOL`}
                  buttonLabel={state.isPending ? "Working..." : "Claim rounds"}
                  disabled={
                    !state.canSignActions ||
                    state.isPending ||
                    state.profile.claimableRoundLamports <= 0
                  }
                  onClick={state.handleClaimRounds}
                />
                <ClaimRow
                  label="Returned escrow"
                  value={`${lamportsToSol(state.profile.claimableSessionBalanceLamports)} SOL`}
                  buttonLabel={state.isPending ? "Working..." : "Claim escrow"}
                  disabled={
                    !state.canSignActions ||
                    state.isPending ||
                    state.profile.claimableSessionBalanceLamports <= 0
                  }
                  onClick={state.handleClaimSessionBalance}
                />
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-6">
            <SectionCard className="bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))]">
              <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
                <div>
                  <SectionHeading
                    eyebrow="Referral ledger"
                    title="Wallet breakdown"
                    description="Admin payout batches settle referral balances; this view shows what is still due by referred wallet."
                  />
                </div>
                <div className="rounded-[1.6rem] border border-primary/20 bg-primary/10 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-primary">
                    Pending total
                  </p>
                  <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                    {lamportsToSol(state.profile.referralPendingLamports)} SOL
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {state.profile.referredWalletBreakdown.length === 0 ? (
                  <p className="rounded-[1.4rem] border border-border-low bg-secondary/60 px-4 py-4 text-sm text-muted">
                    No referral relationships have generated fees yet.
                  </p>
                ) : (
                  state.profile.referredWalletBreakdown.map((wallet) => (
                    <div
                      key={wallet.walletAddress}
                      className="rounded-[1.6rem] border border-border-low bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.02))] px-4 py-4"
                    >
                      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                        <div>
                          <p className="text-sm font-bold text-foreground">{wallet.walletAddress}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted">
                            Referral relationship
                          </p>
                        </div>
                        <div className="grid gap-2 text-xs text-muted sm:grid-cols-3 lg:grid-cols-1">
                          <div>Due: {lamportsToSol(wallet.balanceDueLamports)} SOL</div>
                          <div>Earned: {lamportsToSol(wallet.totalEarnedLamports)} SOL</div>
                          <div>Paid: {lamportsToSol(wallet.paidOutLamports)} SOL</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard className="overflow-hidden bg-[linear-gradient(135deg,rgba(245,200,0,0.12),rgba(7,17,29,0.2)_48%,rgba(255,241,228,0.05))]">
              <SectionHeading
                eyebrow="Rewards"
                title="Assigned inventory"
                description="Wallet-visible reward state only. Claim execution remains unavailable until implemented."
              />
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {state.profile.rewards.length === 0 ? (
                  <p className="rounded-[1.4rem] border border-border-low bg-secondary/60 px-4 py-4 text-sm text-muted md:col-span-2">
                    No rewards assigned yet.
                  </p>
                ) : (
                  state.profile.rewards.map((reward) => (
                    <div
                      key={reward.id}
                      className="rounded-[1.7rem] border border-primary/20 bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))] p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-bold text-foreground">{reward.title}</p>
                          <p className="mt-2 text-sm leading-relaxed text-muted">
                            {reward.subtitle}
                          </p>
                        </div>
                        <StatusBadge label={reward.status} tone="accent" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </PageShell>
  );
}

export function SpotrAdminShell({ config, initialData }: SpotrShellProps) {
  const state = useSpotrDashboard(config, initialData);
  const canWrite = state.admin.authorized && state.canSignActions;

  return (
    <PageShell
      title="Admin operations"
      eyebrow={`${config.seasonLabel} · Admin`}
      notice={state.notice}
    >
      <div className="space-y-6">
        <SectionCard className="overflow-hidden bg-[linear-gradient(125deg,rgba(245,200,0,0.08),rgba(7,17,29,0.12)_32%,rgba(10,34,58,0.7)_100%)]">
          <div className="grid gap-8 xl:grid-cols-[0.88fr_1.12fr] xl:items-end">
            <div className="space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-primary">
                Control room
              </p>
              <h2 className="display-face max-w-xl text-[3.2rem] leading-[0.92] text-balance text-foreground sm:text-[4.4rem]">
                Operator surfaces with real writes, not decorative admin UI.
              </h2>
              <p className="max-w-lg text-sm leading-relaxed text-muted">
                Pair library, reward inventory, referral payout batches, and session
                deployment all hit real Prisma-backed route handlers.
              </p>
              <div className="flex flex-wrap gap-3">
                <LedgerPill label="Write access" value={canWrite ? "Enabled" : "Restricted"} tone="accent" />
                <LedgerPill label="Low-pair threshold" value={String(config.lowPairAlertThreshold)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Live sessions" value={String(state.admin.liveSessions)} />
              <MetricTile label="Pending sessions" value={String(state.admin.pendingSessions)} />
              <MetricTile label="Active pairs" value={String(state.admin.activePairs)} />
              <MetricTile label="Available pairs" value={String(state.admin.availablePairs)} />
              <MetricTile
                label="Protocol fees"
                value={`${lamportsToSol(state.admin.protocolFeesLamports)} SOL`}
              />
              <MetricTile
                label="Referral pending"
                value={`${lamportsToSol(state.admin.pendingReferralLamports)} SOL`}
              />
              <MetricTile
                label="Assigned rewards"
                value={String(state.admin.assignedRewards)}
              />
              <MetricTile
                label="Claimable rewards"
                value={String(state.admin.claimableRewards)}
              />
            </div>
          </div>

          {state.admin.lowPairAlert ? (
            <div className="mt-6 rounded-[1.5rem] border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
              Active pair inventory is below the env threshold of{" "}
              {config.lowPairAlertThreshold}.
            </div>
          ) : null}
        </SectionCard>

        {!state.admin.authorized ? (
          <SectionCard>
            <SectionHeading
              eyebrow="Write access"
              title="This wallet is read-only"
              description="Admin write actions remain locked unless the connected wallet is listed in SPOTR_ADMIN_WALLETS."
            />
          </SectionCard>
        ) : !state.canSignActions ? (
          <SectionCard>
            <SectionHeading
              eyebrow="Write access"
              title="This wallet cannot sign admin requests"
              description="Use a wallet that supports message signing."
            />
          </SectionCard>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard className="bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))]">
            <SectionHeading
              eyebrow="Deploy session"
              title="Publish a live fault-line set"
              description="Session economics remain env-driven. Admin only chooses the pair set and optional title."
            />
            <form onSubmit={state.handleDeploySession} className="mt-6 space-y-4">
              <LabeledInput label="Session title">
                <input
                  value={state.sessionDeployForm.title}
                  onChange={(event) =>
                    state.setSessionDeployForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  autoComplete="off"
                  className="focus-ring min-h-11 w-full rounded-2xl border border-border-low bg-secondary px-4 py-3 text-sm text-foreground"
                />
              </LabeledInput>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    Pair selection
                  </span>
                  <span className="text-xs text-muted">
                    {state.selectedDeployPairIds.length}/{config.roundCount}
                  </span>
                </div>

                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {state.deployablePairs.map((pair) => {
                    const checked = state.selectedDeployPairIds.includes(pair.id);
                    return (
                      <label
                        key={pair.id}
                        className="flex cursor-pointer items-start gap-3 rounded-[1.4rem] border border-border-low bg-[linear-gradient(180deg,rgba(255,241,228,0.07),rgba(255,241,228,0.03))] px-4 py-4"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            state.setSessionDeployForm((current) => ({
                              ...current,
                              pairIds: checked
                                ? current.pairIds.filter((pairId) => pairId !== pair.id)
                                : [...current.pairIds, pair.id].slice(0, config.roundCount),
                            }))
                          }
                          className="mt-1 h-4 w-4 rounded border-border"
                        />
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            {pair.category}
                          </p>
                          <p className="mt-1 text-sm text-foreground">{pair.sideA}</p>
                          <p className="mt-1 text-sm text-muted">{pair.sideB}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <GoldButton
                type="submit"
                disabled={state.isPending || state.selectedDeployPairIds.length !== config.roundCount || !canWrite}
                className="w-full"
              >
                {state.isPending ? "Deploying..." : "Deploy session"}
              </GoldButton>
            </form>
          </SectionCard>

          <SectionCard className="bg-[linear-gradient(180deg,rgba(16,36,61,0.92),rgba(7,17,29,0.96))] text-foreground">
            <SectionHeading
              eyebrow="On-chain"
              title="Deploy sessions on-chain"
              description="Each Postgres session must be bound to an on-chain session account before players can join. This tx pays the rent for the Session + SessionTreasury PDAs, and initializes the Config PDA once per program."
            />
            <div className="mt-5 space-y-3">
              {state.admin.sessionHistory.length === 0 ? (
                <p className="text-sm text-muted">No sessions created yet.</p>
              ) : (
                state.admin.sessionHistory.map((sessionCard) => {
                  const deployed = sessionCard.chainSessionNumber != null;
                  return (
                    <div
                      key={sessionCard.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-low bg-card/60 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {sessionCard.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {new Date(sessionCard.startsAtIso).toLocaleString()} →
                          {" "}
                          {new Date(sessionCard.endsAtIso).toLocaleString()}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-muted">
                          {deployed ? (
                            <>
                              <span className="text-success">on-chain</span>
                              {" · #"}
                              {sessionCard.chainSessionNumber}
                              {" · "}
                              {ellipsify(sessionCard.chainSessionAddress ?? "", 6)}
                            </>
                          ) : (
                            <span className="text-destructive">
                              not deployed on-chain
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={deployed || state.isPending || !canWrite}
                        onClick={() => state.handleChainDeploy(sessionCard)}
                        className="focus-ring cursor-pointer rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {deployed ? "Deployed" : state.isPending ? "Working…" : "Deploy on-chain"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </SectionCard>

          <SectionCard className="overflow-hidden bg-[linear-gradient(135deg,rgba(245,200,0,0.1),rgba(7,17,29,0.18)_46%,rgba(255,241,228,0.04))]">
            <SectionHeading
              eyebrow="Rewards"
              title="Assign and update inventory"
              description="Rewards are persisted backend records, not prototype-only reveal cards."
            />
            <form onSubmit={state.handleAssignReward} className="mt-6 space-y-4">
              <LabeledInput label="Target wallet">
                <input
                  value={state.rewardForm.targetWalletAddress}
                  onChange={(event) =>
                    state.setRewardForm((current) => ({
                      ...current,
                      targetWalletAddress: event.target.value,
                    }))
                  }
                  autoComplete="off"
                  className="focus-ring min-h-11 w-full rounded-2xl border border-border-low bg-secondary px-4 py-3 text-sm text-foreground"
                />
              </LabeledInput>
              <LabeledInput label="Reward title">
                <input
                  value={state.rewardForm.title}
                  onChange={(event) =>
                    state.setRewardForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  autoComplete="off"
                  className="focus-ring min-h-11 w-full rounded-2xl border border-border-low bg-secondary px-4 py-3 text-sm text-foreground"
                />
              </LabeledInput>
              <LabeledInput label="Reward subtitle">
                <input
                  value={state.rewardForm.subtitle}
                  onChange={(event) =>
                    state.setRewardForm((current) => ({
                      ...current,
                      subtitle: event.target.value,
                    }))
                  }
                  autoComplete="off"
                  className="focus-ring min-h-11 w-full rounded-2xl border border-border-low bg-secondary px-4 py-3 text-sm text-foreground"
                />
              </LabeledInput>
              <LabeledInput label="Reward kind">
                <select
                  value={state.rewardForm.kind}
                  onChange={(event) =>
                    state.setRewardForm((current) => ({
                      ...current,
                      kind: event.target.value as RewardFormState["kind"],
                    }))
                  }
                  className="focus-ring min-h-11 w-full rounded-2xl border border-border-low bg-secondary px-4 py-3 text-sm text-foreground"
                >
                  <option value="nft">NFT</option>
                  <option value="merch">Merch</option>
                  <option value="gift-card">Gift card</option>
                  <option value="voucher">Voucher</option>
                </select>
              </LabeledInput>
              <GoldButton type="submit" disabled={state.isPending || !canWrite} className="w-full">
                {state.isPending ? "Saving..." : "Assign reward"}
              </GoldButton>
            </form>
          </SectionCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard className="bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))]">
            <SectionHeading
              eyebrow="Import pairs"
              title="CSV ingestion"
              description="Use the persisted pair library import route. No in-memory pair catalog."
            />
            <form onSubmit={state.handleImportPairs} className="mt-6 space-y-4">
              <textarea
                value={state.pairImportForm.csv}
                onChange={(event) =>
                  state.setPairImportForm({
                    csv: event.target.value,
                  })
                }
                rows={7}
                className="focus-ring w-full rounded-[1.5rem] border border-border-low bg-secondary px-4 py-3 text-sm text-foreground"
              />
              <GoldButton
                type="submit"
                disabled={state.isPending || state.pairImportForm.csv.trim().length === 0 || !canWrite}
                className="w-full"
              >
                {state.isPending ? "Importing..." : "Import pairs"}
              </GoldButton>
            </form>
          </SectionCard>

          <SectionCard className="overflow-hidden bg-[linear-gradient(180deg,rgba(16,36,61,0.82),rgba(7,17,29,0.96))]">
            <SectionHeading
              eyebrow="Referral payouts"
              title="Outstanding balances"
              description="Payout batches are recorded through the admin route."
            />
            <div className="mt-6 space-y-3">
              {state.admin.referralBalances.length === 0 ? (
                <p className="rounded-[1.4rem] border border-border-low bg-secondary/60 px-4 py-4 text-sm text-muted">
                  No referral balances recorded yet.
                </p>
              ) : (
                state.admin.referralBalances.map((referral) => (
                  <div
                    key={referral.referrerWallet}
                    className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {referral.referrerWallet}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {referral.referredWallets} referred wallets
                        </p>
                      </div>
                      <p className="font-mono text-xs text-muted">
                        {lamportsToSol(referral.balanceDueLamports)} SOL due
                      </p>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
                      <div>Accrued: {lamportsToSol(referral.totalAccruedLamports)} SOL</div>
                      <div>Paid: {lamportsToSol(referral.paidOutLamports)} SOL</div>
                      <div>Due: {lamportsToSol(referral.balanceDueLamports)} SOL</div>
                    </div>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => state.handlePayReferral(referral.referrerWallet)}
                        disabled={state.isPending || referral.balanceDueLamports <= 0}
                        className="focus-ring mt-4 inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mark payout paid
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard className="bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))]">
            <SectionHeading
              eyebrow="Recent rewards"
              title="Inventory state changes"
            />
            <div className="mt-6 space-y-3">
              {state.admin.recentRewards.length === 0 ? (
                <p className="rounded-[1.4rem] border border-border-low bg-secondary/60 px-4 py-4 text-sm text-muted">
                  No rewards recorded yet.
                </p>
              ) : (
                state.admin.recentRewards.map((reward) => (
                  <div
                    key={reward.id}
                    className="rounded-[1.6rem] border border-border-low bg-[linear-gradient(180deg,rgba(255,241,228,0.08),rgba(255,241,228,0.03))] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">{reward.title}</p>
                        <p className="mt-1 text-xs text-muted">{reward.walletAddress}</p>
                      </div>
                      <StatusBadge label={reward.status} tone="accent" />
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Assigned {formatUtc(reward.assignedAtIso)}
                    </p>
                    {canWrite ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => state.handleRewardStatusUpdate(reward.id, "claimable")}
                          disabled={state.isPending || reward.status !== "assigned"}
                          className="focus-ring inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Mark claimable
                        </button>
                        <button
                          type="button"
                          onClick={() => state.handleRewardStatusUpdate(reward.id, "claimed")}
                          disabled={state.isPending || reward.status === "claimed"}
                          className="focus-ring inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Mark claimed
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard className="overflow-hidden bg-[linear-gradient(180deg,rgba(16,36,61,0.78),rgba(7,17,29,0.98))]">
            <SectionHeading
              eyebrow="Pair library"
              title="Toggle active inventory"
            />
            <div className="mt-6 space-y-3">
              {state.admin.pairLibrary.length === 0 ? (
                <p className="rounded-[1.4rem] border border-border-low bg-secondary/60 px-4 py-4 text-sm text-muted">
                  No pairs in the library yet.
                </p>
              ) : (
                state.admin.pairLibrary.map((pair) => (
                  <div
                    key={pair.id}
                    className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                          {pair.category}
                        </p>
                        <p className="mt-1 text-sm text-foreground">{pair.sideA}</p>
                        <p className="mt-1 text-sm text-muted">{pair.sideB}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted">
                          {pair.active ? "active" : "inactive"}
                          {pair.assigned ? " · assigned" : ""}
                        </p>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => state.handleTogglePair(pair.id, !pair.active)}
                            disabled={state.isPending}
                            className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {pair.active ? "Deactivate" : "Activate"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}
