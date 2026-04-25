"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { Gift, Target, Zap } from "lucide-react";
import { toast } from "sonner";
import { WalletButton } from "./wallet-button";
import { useCluster } from "./cluster-context";
import { useWallet } from "../lib/wallet/context";
import { createSignedActionRequest } from "../lib/wallet/signed-request";
import { useBalance } from "../lib/hooks/use-balance";
import { submitJoinSessionOnChain } from "../lib/chain/spotr-join-session";
import { submitDeploySessionOnChain } from "../lib/chain/spotr-deploy-session";
import { ellipsify } from "../lib/explorer";
import { cn } from "../lib/utils";
import {
  lamportsToSol,
  formatSignedLamports,
  formatUtc,
} from "../lib/format";
import type {
  SpotrDashboardPayload,
  SpotrPublicConfig,
  SpotrSide,
} from "../lib/spotr-types";
import type { SpotrSignedActionName } from "../lib/spotr-signed-action";
import { Button } from "./ui/button";
import {
  AppHeader,
  AppPage,
  MetricCard,
  NoticeBanner,
  SpotrLogo,
  StageScaffold,
  StepList,
  SurfaceCard,
  BottomAction,
} from "./spotr-ui/system";
import {
  BalancePill,
  EyeBrand,
  LedgerPill,
  RoundLabel,
} from "./spotr-ui/atoms";
import {
  ConvictionCard,
  FaultLineCard,
  PositionSummaryCard,
  TokenConfirmationCard,
} from "./spotr-ui/cards";
import {
  AutoAdvanceFooter,
  OutcomeMessage,
  PnlNumber,
} from "./spotr-ui/results";
import {
  CenteredHero,
  OnboardingHero,
  StatusIcon,
} from "./spotr-ui/onboarding";
import {
  AmountStepper,
  BalanceStatusRow,
  ConversionLine,
  QuickAmountChips,
} from "./spotr-ui/topup";
import { WaitingRoom } from "./spotr-ui/waiting";

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

function PageShell({
  title,
  eyebrow,
  children,
  notice,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  notice: Notice;
}) {
  return (
    <AppPage header={<AppHeader title={title} eyebrow={eyebrow} />}>
      {notice ? (
        <NoticeBanner tone={notice.tone}>{notice.message}</NoticeBanner>
      ) : null}
      {children}
    </AppPage>
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
      <h2 className="font-display font-extrabold tracking-[-0.04em] mt-2 text-[1.4rem] sm:text-[1.6rem] text-foreground">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
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
          : "border-white/10 bg-card text-muted";

  return (
    <span
      className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${className}`}
    >
      {label}
    </span>
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
    <div className="flex items-center justify-between gap-4 rounded-[1rem] border border-white/12 bg-black/16 px-4 py-4">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
          {label}
        </p>
        <p className="mt-1 font-mono text-base font-semibold tabular-nums text-foreground">
          {value}
        </p>
      </div>
      <Button
        type="button"
        variant="gold"
        size="sm"
        disabled={disabled}
        onClick={onClick}
      >
        {buttonLabel}
      </Button>
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

  if (screen === "splash") return <SplashScreen />;
  if (screen === "howto") {
    return (
      <HowItWorksScreen
        onContinue={() => {
          if (typeof window !== "undefined") {
            window.localStorage.setItem("spotr-player-intro-v1", "seen");
          }
          setIntroSeen(true);
          setShowSplash(false);
        }}
      />
    );
  }
  if (screen === "entry") return <EntryScreen />;
  if (screen === "checking") {
    return (
      <BalanceCheckScreen
        buyInLamports={config.sessionBuyInLamports}
        balanceLamports={balance.lamports}
        isLoading={balance.isLoading}
      />
    );
  }
  if (screen === "topup") {
    return <TopUpScreen config={config} balanceLamports={balance.lamports} />;
  }
  if (screen === "confirming") {
    return <ConfirmSessionScreen state={state} />;
  }
  if (screen === "pnl" && settledRound) {
    return (
      <PnlScreen
        round={settledRound}
        totalRounds={config.roundCount}
        activeFaultLine={state.activeFaultLine}
        onContinue={() => setShowPnl(false)}
      />
    );
  }
  if (screen === "season") {
    return (
      <SeasonScreen
        profile={state.profile}
        rewards={rewardList}
        onUnavailable={triggerUnavailable}
      />
    );
  }
  return (
    <LiveGameScreen config={config} state={state} balanceLamports={balance.lamports} />
  );
}

function SplashScreen() {
  return (
    <StageScaffold surface="onboard">
      <div className="flex flex-1 flex-col items-center justify-center">
        <span className="text-primary">
          <SpotrLogo size={96} />
        </span>
        <p className="mt-5 text-base font-normal text-white/85">Backed by belief</p>
      </div>
    </StageScaffold>
  );
}

function HowItWorksScreen({ onContinue }: { onContinue: () => void }) {
  const steps = [
    {
      icon: <Target className="h-5 w-5" />,
      title: "Spot the take the crowd moves toward",
      body: "Each card shows a cultural fault line. Back the side you think wins.",
    },
    {
      icon: <Zap className="h-5 w-5" />,
      title: "30 seconds. Then the round closes.",
      body: "The momentum bar shows live pressure. The round settles when the timer runs out — not when you pick.",
    },
    {
      icon: <Gift className="h-5 w-5" />,
      title: "Earn your Conviction Card",
      body: "Complete the season to unlock a Conviction Card. Real rewards inside.",
    },
  ];

  return (
    <StageScaffold surface="onboard">
      <div className="flex flex-1 flex-col px-6 pb-7 pt-14">
        <div className="mb-8">
          <EyeBrand size={32} withWordmark />
        </div>
        <OnboardingHero
          title="How it works"
          body="Seven rounds. Real culture. No wrong answers, only early ones."
        />
        <div className="mt-8">
          <StepList items={steps} />
        </div>
        <BottomAction
          primary={
            <Button type="button" variant="gold" size="block" onClick={onContinue}>
              Continue
            </Button>
          }
        />
      </div>
    </StageScaffold>
  );
}

function EntryScreen() {
  return (
    <StageScaffold surface="onboard">
      <CenteredHero
        logo={<EyeBrand size={40} />}
        title="What do you actually think?"
        body="Connect a Solana wallet with at least 0.035 SOL to start a session."
        action={<WalletButton />}
        footer="All positions settle on Solana mainnet. · SPOTR.TV never has custody of your funds."
      />
    </StageScaffold>
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

  if (phase === "checking") {
    return (
      <StageScaffold surface="navy">
        <CenteredHero
          logo={<EyeBrand size={40} />}
          title="Checking your wallet balance…"
          body={`Minimum entry: ${minSol} SOL`}
        />
      </StageScaffold>
    );
  }

  if (phase === "success") {
    return (
      <StageScaffold surface="navy">
        <CenteredHero
          logo={<StatusIcon tone="success" />}
          title={`Balance: ${balSol} SOL`}
          body="You're cleared to play."
        />
      </StageScaffold>
    );
  }

  return (
    <StageScaffold surface="navy">
      <CenteredHero
        logo={<StatusIcon tone="error" />}
        title="Balance too low"
        body={`You have ${balSol} SOL. Top up to at least ${minSol} SOL to play.`}
      />
    </StageScaffold>
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
    <StageScaffold surface="onboard">
      <div className="flex flex-1 flex-col px-6 pb-6 pt-10">
        <div className="mb-6">
          <EyeBrand size={32} />
        </div>

        <h2 className="mb-3 text-[28px] font-bold text-white">Top up to play.</h2>
        <p className="mb-6 text-[15px] leading-relaxed text-white/70">
          Your wallet has {balSol.toFixed(3)} SOL. You need at least{" "}
          {minSol.toFixed(3)} SOL to start a session.
        </p>

        <div className="space-y-4">
          <BalanceStatusRow currentSol={balSol} shortfallSol={shortfall} />
          <AmountStepper valueSol={amount} onChange={setAmount} step={0.01} min={0.001} />
          <QuickAmountChips
            options={presets}
            selected={amount}
            onSelect={setAmount}
          />
          <ConversionLine newBalanceSol={balSol + amount} />
        </div>

        <BottomAction
          primary={
            <Button
              type="button"
              variant="gold"
              size="block"
              disabled={amount < shortfall}
              onClick={() => toast.error("Top-up requires external wallet flow")}
            >
              Add {amount.toFixed(3)} SOL to Wallet
            </Button>
          }
          note="Funds stay in your wallet. SPOTR never has custody."
        />
      </div>
    </StageScaffold>
  );
}

function ConfirmSessionScreen({
  state,
}: {
  state: ReturnType<typeof useSpotrDashboard>;
}) {
  const done = state.session.joined;
  const onChain = Boolean(state.session.chainSessionNumber);

  if (done) {
    return (
      <StageScaffold surface="navy">
        <CenteredHero
          logo={<StatusIcon tone="success" />}
          title="You're in. Session starts now."
          body="Locking your seat on chain."
        />
      </StageScaffold>
    );
  }

  if (!onChain) {
    return (
      <StageScaffold surface="navy">
        <CenteredHero
          logo={<EyeBrand size={44} />}
          title="Session not yet on-chain"
          body="The session hasn't been deployed on-chain yet. Check back soon."
        />
      </StageScaffold>
    );
  }

  return (
    <StageScaffold surface="navy">
      <CenteredHero
        logo={<EyeBrand size={44} />}
        title={state.isPending ? "Confirming on Solana…" : "Ready to play"}
        body={
          state.isPending
            ? "Sign the transaction in your wallet."
            : "Pay the buy-in to lock your seat for this session."
        }
        action={
          !state.isPending ? (
            <Button
              type="button"
              variant="gold"
              size="block"
              onClick={state.handleJoin}
              disabled={!state.canSignActions}
            >
              Join Session
            </Button>
          ) : undefined
        }
      />
    </StageScaffold>
  );
}

function WaitingRoomScreen({
  state,
  config,
}: {
  state: ReturnType<typeof useSpotrDashboard>;
  config: SpotrPublicConfig;
}) {
  const players = state.admin.participants.map((p) => ({
    address: p.walletAddress,
    status: "Joined",
  }));
  const starting = state.session.status === "live";
  return (
    <StageScaffold surface="navy">
      <WaitingRoom
        joined={state.session.walletsJoined}
        capacity={config.sessionMinWallets}
        players={players}
        starting={starting}
      />
    </StageScaffold>
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
  const [buyFlash, setBuyFlash] = useState(false);

  if (!state.activeRound) {
    return <WaitingRoomScreen state={state} config={config} />;
  }

  const roundProgress =
    state.countdown == null
      ? 0
      : Math.max(0, Math.min(100, (state.countdown / config.roundDurationSeconds) * 100));

  const isLocked = Boolean(state.activeRound.lockedSide);

  function handleBuy() {
    setBuyFlash(true);
    window.setTimeout(() => setBuyFlash(false), 260);
    state.handleEnter();
  }

  return (
    <StageScaffold surface="navy">
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-4">
          <EyeBrand size={28} />
          <RoundLabel
            index={state.activeRound.index ?? config.roundCount}
            total={config.roundCount}
          />
          <BalancePill balanceLamports={balanceLamports} />
        </div>

        <div className="mt-3 h-[3px] w-full bg-white/10">
          <div
            className={cn(
              "h-full",
              state.countdown != null && state.countdown <= 10
                ? "bg-destructive"
                : "bg-primary"
            )}
            style={{ width: `${roundProgress}%` }}
          />
        </div>

        <div className="flex flex-1 flex-col px-4 pt-4">
          {state.activeFaultLine && state.activeDisplay ? (
            <FaultLineCard
              category={state.activeFaultLine.category}
              side={state.activeDisplay.side as SpotrSide}
              copy={state.activeDisplay.copy}
              pct={state.activeDisplay.pct}
              opposingPct={state.activeDisplay.opposingPct}
              flipped={state.flipped}
              onFlip={() =>
                state.setFlipState((current) => ({
                  roundId: state.activeRound?.id ?? current.roundId,
                  flipped:
                    current.roundId === state.activeRound?.id
                      ? !current.flipped
                      : true,
                }))
              }
              locked={isLocked}
            />
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/50">
              No deployed session data is available yet.
            </div>
          )}

          <p className="mb-3 mt-4 text-center text-[13px] text-white/40">
            {isLocked
              ? `Position locked · settles in ${state.countdown ?? "—"}s`
              : "Tap card to flip · buy either side"}
          </p>

          {isLocked ? (
            <TokenConfirmationCard
              statement={state.activeDisplay?.copy ?? ""}
              settlesIn={state.countdown}
            />
          ) : (
            <Button
              type="button"
              variant="gold"
              size="block"
              onClick={handleBuy}
              disabled={
                state.isPending ||
                !state.session.joined ||
                !state.canSignActions ||
                state.activeRound.status !== "open"
              }
              className={cn(buyFlash && "!bg-success !text-white")}
            >
              {buyFlash
                ? "Locked in ✓"
                : state.isPending
                  ? "Locking position..."
                  : `Buy side ${state.activeDisplay?.side ?? "A"} · ${state.activeDisplay?.pct ?? 0}% →`}
            </Button>
          )}

          <p className="mb-5 mt-3 text-center text-[11px] text-white/30">
            No mock fills. Positions settle on Solana.
          </p>
        </div>
      </div>
    </StageScaffold>
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
  const pnl = round.claimableLamports - (round.stakeLamports ?? 0);
  const faultLine = activeFaultLine;
  const isSkip = !round.lockedSide;
  const isWin = !isSkip && pnl > 0;

  const finalPct =
    round.lockedSide === "A"
      ? round.sideAProbabilityPct
      : round.lockedSide === "B"
        ? round.sideBProbabilityPct
        : null;

  const lockedCopy =
    round.lockedSide === "A"
      ? faultLine?.sideA
      : round.lockedSide === "B"
        ? faultLine?.sideB
        : null;

  return (
    <StageScaffold surface="navy">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-7 pt-10">
        <div className="mb-6 flex flex-col items-center gap-2">
          <EyeBrand size={44} />
          <p className="text-sm text-white/70">
            Round {round.index} of {totalRounds}
          </p>
        </div>

        {lockedCopy ? (
          <div className="mb-5">
            <PositionSummaryCard statement={lockedCopy} finalSharePct={finalPct} />
          </div>
        ) : null}

        <div className="mb-6 rounded-[16px] border border-white/12 bg-black/16 p-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            PNL
          </p>
          <PnlNumber deltaLamports={pnl} isSkip={isSkip} />
          <div className="mt-2">
            <OutcomeMessage won={isWin} isSkip={isSkip} />
          </div>
        </div>

        <BottomAction
          primary={
            <Button
              type="button"
              variant="gold"
              size="block"
              onClick={onContinue}
            >
              Next Round
            </Button>
          }
        />
        <div className="mt-3">
          <AutoAdvanceFooter durationSeconds={5} onAdvance={onContinue} />
        </div>
      </div>
    </StageScaffold>
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

  const pnlTone = cumPnl >= 0 ? "text-success" : "text-destructive";

  return (
    <StageScaffold surface="onboard">
      <div className="flex flex-1 flex-col items-center overflow-hidden px-6 pb-6 pt-9">
        <div className="mb-6">
          <EyeBrand size={40} />
        </div>

        <p
          className={cn(
            "mb-1 font-mono text-[36px] font-bold tabular-nums",
            pnlTone
          )}
        >
          <CountUp
            value={cumPnl / 1_000_000_000}
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} SOL`}
          />
        </p>
        <p className="mb-8 text-[13px] text-white/60">
          Season 1 · {roundsSettled} round{roundsSettled !== 1 ? "s" : ""} settled
        </p>

        {phase === "arrive" ? (
          <>
            <h2 className="mb-6 text-center text-[26px] font-bold text-white">
              Tear it open.
            </h2>
            <div
              onMouseDown={handleCardPress}
              onMouseUp={handleCardRelease}
              onTouchStart={handleCardPress}
              onTouchEnd={handleCardRelease}
              className="cursor-pointer"
            >
              <ConvictionCard size={220} bounce />
            </div>
            <p className="mt-4 text-[13px] text-white/50">Hold to reveal</p>
          </>
        ) : null}

        {phase === "hold" ? (
          <>
            <h2 className="mb-6 text-center text-[26px] font-bold text-white">
              Hold…
            </h2>
            <ConvictionCard size={220} />
          </>
        ) : null}

        {phase === "tearing" ? (
          <div className="opacity-0">
            <ConvictionCard size={220} />
          </div>
        ) : null}

        {phase === "revealed" ? (
          <div className="w-full max-w-sm">
            <h2 className="mb-5 text-center text-[22px] font-bold text-white">
              Your haul
            </h2>
            <div className="mb-8 flex flex-col gap-3">
              {prizeList.map((prize) => (
                <div
                  key={prize.id}
                  className="flex items-center gap-3 rounded-[16px] bg-black/25 px-4 py-3"
                >
                  <div className="h-[58px] w-11 shrink-0 rounded-[8px] border-[1.5px] border-primary bg-[linear-gradient(135deg,#1b4f8c,#0d1b2e)]" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">{prize.title}</p>
                    <p className="text-xs text-white/55">{prize.subtitle}</p>
                  </div>
                  <Button
                    type="button"
                    variant="gold"
                    size="sm"
                    onClick={() =>
                      onUnavailable(
                        "Reward claim flow is not implemented in SPOTR yet."
                      )
                    }
                  >
                    Claim
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="gold" size="block" className="mb-3">
              Play Next Session
            </Button>
            <button
              type="button"
              onClick={() => onUnavailable("Sharing haul is not implemented yet.")}
              className="focus-ring w-full rounded-[14px] border-[1.5px] border-white/40 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Share my haul
            </button>
          </div>
        ) : null}
      </div>
    </StageScaffold>
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
        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <SurfaceCard>
            <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                  Wallet dossier
                </p>
                <h2 className="font-display text-[2rem] font-extrabold leading-tight tracking-[-0.04em] text-balance text-foreground sm:text-[2.4rem]">
                  Connect a wallet to open your SPOTR ledger.
                </h2>
                <p className="max-w-lg text-sm leading-relaxed text-muted">
                  Claims, referral balances, assigned rewards, and paid-session history
                  are wallet-scoped and read from persisted backend state.
                </p>
              </div>
              <div className="rounded-[1rem] border border-white/12 bg-black/16 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
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
          </SurfaceCard>

          <SurfaceCard>
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
          </SurfaceCard>
        </div>
      ) : !state.profile ? (
        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <SurfaceCard>
            <SectionHeading
              eyebrow="Wallet dossier"
              title="No SPOTR profile has been written for this wallet yet."
              description="The wallet is connected, but there is no persisted profile record to read from sessions, referrals, rewards, or claims."
            />
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <MetricCard label="Wallet" value="Connected" accent />
              <MetricCard label="Profile" value="Missing" />
              <MetricCard label="Claims" value="Unavailable" />
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <SectionHeading
              eyebrow="Why this happens"
              title="No paid-session footprint"
              description="This route will populate after the wallet joins a session or receives persisted referral or reward state."
            />
          </SurfaceCard>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
          <SurfaceCard>
            <div className="grid gap-8">
              <div className="space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                  Wallet
                </p>
                <p className="font-mono text-base tabular-nums break-all text-foreground">
                  {state.profile.walletAddress}
                </p>
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

              <div className="rounded-[1rem] border border-white/12 bg-black/16 p-5">
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

              <div className="space-y-3">
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
          </SurfaceCard>

          <div className="grid gap-6">
            <SurfaceCard>
              <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
                <div>
                  <SectionHeading
                    eyebrow="Referral ledger"
                    title="Wallet breakdown"
                    description="Admin payout batches settle referral balances; this view shows what is still due by referred wallet."
                  />
                </div>
                <div className="rounded-[1rem] border border-primary/25 bg-primary/10 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                    Pending total
                  </p>
                  <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                    {lamportsToSol(state.profile.referralPendingLamports)} SOL
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {state.profile.referredWalletBreakdown.length === 0 ? (
                  <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
                    No referral relationships have generated fees yet.
                  </p>
                ) : (
                  state.profile.referredWalletBreakdown.map((wallet) => (
                    <div
                      key={wallet.walletAddress}
                      className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-4"
                    >
                      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                        <div>
                          <p className="font-mono text-sm tabular-nums text-foreground break-all">
                            {wallet.walletAddress}
                          </p>
                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
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
            </SurfaceCard>

            <SurfaceCard>
              <SectionHeading
                eyebrow="Rewards"
                title="Assigned inventory"
                description="Wallet-visible reward state only. Claim execution remains unavailable until implemented."
              />
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {state.profile.rewards.length === 0 ? (
                  <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted md:col-span-2">
                    No rewards assigned yet.
                  </p>
                ) : (
                  state.profile.rewards.map((reward) => (
                    <div
                      key={reward.id}
                      className="rounded-[1rem] border border-white/12 bg-black/16 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-foreground">{reward.title}</p>
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
            </SurfaceCard>
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
        <SurfaceCard>
          <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
            <div className="space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                Control room
              </p>
              <h2 className="font-display text-[2rem] font-extrabold leading-tight tracking-[-0.04em] text-balance text-foreground sm:text-[2.4rem]">
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

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Live sessions" value={String(state.admin.liveSessions)} />
              <MetricCard label="Pending sessions" value={String(state.admin.pendingSessions)} />
              <MetricCard label="Active pairs" value={String(state.admin.activePairs)} />
              <MetricCard label="Available pairs" value={String(state.admin.availablePairs)} />
              <MetricCard
                label="Protocol fees"
                value={`${lamportsToSol(state.admin.protocolFeesLamports)} SOL`}
              />
              <MetricCard
                label="Referral pending"
                value={`${lamportsToSol(state.admin.pendingReferralLamports)} SOL`}
              />
              <MetricCard
                label="Assigned rewards"
                value={String(state.admin.assignedRewards)}
              />
              <MetricCard
                label="Claimable rewards"
                value={String(state.admin.claimableRewards)}
              />
            </div>
          </div>

          {state.admin.lowPairAlert ? (
            <div className="mt-6 rounded-[1rem] border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              Active pair inventory is below the env threshold of{" "}
              {config.lowPairAlertThreshold}.
            </div>
          ) : null}
        </SurfaceCard>

        {!state.admin.authorized ? (
          <SurfaceCard>
            <SectionHeading
              eyebrow="Write access"
              title="This wallet is read-only"
              description="Admin write actions remain locked unless the connected wallet is listed in SPOTR_ADMIN_WALLETS."
            />
          </SurfaceCard>
        ) : !state.canSignActions ? (
          <SurfaceCard>
            <SectionHeading
              eyebrow="Write access"
              title="This wallet cannot sign admin requests"
              description="Use a wallet that supports message signing."
            />
          </SurfaceCard>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <SurfaceCard>
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
                  className="focus-ring min-h-11 w-full rounded-[1rem] border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground focus:border-primary/50"
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
                        className="flex cursor-pointer items-start gap-3 rounded-[1rem] border border-white/12 bg-black/16 px-4 py-4"
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
                        <div className="min-w-0 flex-1 break-words">
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

              <Button variant="gold" size="lg"
                type="submit"
                disabled={state.isPending || state.selectedDeployPairIds.length !== config.roundCount || !canWrite}
                className="w-full"
              >
                {state.isPending ? "Deploying..." : "Deploy session"}
              </Button>
            </form>
          </SurfaceCard>

          <SurfaceCard>
            <SectionHeading
              eyebrow="On-chain"
              title="Deploy sessions on-chain"
              description="Each Postgres session must be bound to an on-chain session account before players can join. This tx pays the rent for the Session + SessionTreasury PDAs, and initializes the Config PDA once per program."
            />
            <div className="mt-5 space-y-3">
              {state.admin.sessionHistory.length === 0 ? (
                <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
                  No sessions created yet.
                </p>
              ) : (
                state.admin.sessionHistory.map((sessionCard) => {
                  const deployed = sessionCard.chainSessionNumber != null;
                  return (
                    <div
                      key={sessionCard.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {sessionCard.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {new Date(sessionCard.startsAtIso).toLocaleString()} →
                          {" "}
                          {new Date(sessionCard.endsAtIso).toLocaleString()}
                        </p>
                        <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
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
                      <Button
                        type="button"
                        variant="gold"
                        size="sm"
                        disabled={deployed || state.isPending || !canWrite}
                        onClick={() => state.handleChainDeploy(sessionCard)}
                      >
                        {deployed ? "Deployed" : state.isPending ? "Working…" : "Deploy on-chain"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard>
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
                  className="focus-ring min-h-11 w-full rounded-[1rem] border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground focus:border-primary/50"
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
                  className="focus-ring min-h-11 w-full rounded-[1rem] border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground focus:border-primary/50"
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
                  className="focus-ring min-h-11 w-full rounded-[1rem] border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground focus:border-primary/50"
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
                  className="focus-ring min-h-11 w-full rounded-[1rem] border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground focus:border-primary/50"
                >
                  <option value="nft">NFT</option>
                  <option value="merch">Merch</option>
                  <option value="gift-card">Gift card</option>
                  <option value="voucher">Voucher</option>
                </select>
              </LabeledInput>
              <Button variant="gold" size="lg" type="submit" disabled={state.isPending || !canWrite} className="w-full">
                {state.isPending ? "Saving..." : "Assign reward"}
              </Button>
            </form>
          </SurfaceCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SurfaceCard>
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
                className="focus-ring w-full rounded-[1rem] border border-white/12 bg-black/20 px-4 py-3 text-sm text-foreground focus:border-primary/50"
              />
              <Button variant="gold" size="lg"
                type="submit"
                disabled={state.isPending || state.pairImportForm.csv.trim().length === 0 || !canWrite}
                className="w-full"
              >
                {state.isPending ? "Importing..." : "Import pairs"}
              </Button>
            </form>
          </SurfaceCard>

          <SurfaceCard>
            <SectionHeading
              eyebrow="Referral payouts"
              title="Outstanding balances"
              description="Payout batches are recorded through the admin route."
            />
            <div className="mt-6 space-y-3">
              {state.admin.referralBalances.length === 0 ? (
                <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
                  No referral balances recorded yet.
                </p>
              ) : (
                state.admin.referralBalances.map((referral) => (
                  <div
                    key={referral.referrerWallet}
                    className="rounded-[1rem] border border-white/12 bg-black/16 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm tabular-nums text-foreground break-all">
                          {referral.referrerWallet}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {referral.referredWallets} referred wallets
                        </p>
                      </div>
                      <p className="font-mono text-xs tabular-nums text-muted">
                        {lamportsToSol(referral.balanceDueLamports)} SOL due
                      </p>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
                      <div>Accrued: {lamportsToSol(referral.totalAccruedLamports)} SOL</div>
                      <div>Paid: {lamportsToSol(referral.paidOutLamports)} SOL</div>
                      <div>Due: {lamportsToSol(referral.balanceDueLamports)} SOL</div>
                    </div>
                    {canWrite ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-4"
                        onClick={() => state.handlePayReferral(referral.referrerWallet)}
                        disabled={state.isPending || referral.balanceDueLamports <= 0}
                      >
                        Mark payout paid
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </SurfaceCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SurfaceCard>
            <SectionHeading
              eyebrow="Recent rewards"
              title="Inventory state changes"
            />
            <div className="mt-6 space-y-3">
              {state.admin.recentRewards.length === 0 ? (
                <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
                  No rewards recorded yet.
                </p>
              ) : (
                state.admin.recentRewards.map((reward) => (
                  <div
                    key={reward.id}
                    className="rounded-[1rem] border border-white/12 bg-black/16 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{reward.title}</p>
                        <p className="mt-1 font-mono text-xs tabular-nums text-muted break-all">
                          {reward.walletAddress}
                        </p>
                      </div>
                      <StatusBadge label={reward.status} tone="accent" />
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Assigned {formatUtc(reward.assignedAtIso)}
                    </p>
                    {canWrite ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => state.handleRewardStatusUpdate(reward.id, "claimable")}
                          disabled={state.isPending || reward.status !== "assigned"}
                        >
                          Mark claimable
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => state.handleRewardStatusUpdate(reward.id, "claimed")}
                          disabled={state.isPending || reward.status === "claimed"}
                        >
                          Mark claimed
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <SectionHeading
              eyebrow="Pair library"
              title="Toggle active inventory"
            />
            <div className="mt-6 space-y-3">
              {state.admin.pairLibrary.length === 0 ? (
                <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
                  No pairs in the library yet.
                </p>
              ) : (
                state.admin.pairLibrary.map((pair) => (
                  <div
                    key={pair.id}
                    className="rounded-[1rem] border border-white/12 bg-black/16 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
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
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="mt-3"
                            onClick={() => state.handleTogglePair(pair.id, !pair.active)}
                            disabled={state.isPending}
                          >
                            {pair.active ? "Deactivate" : "Activate"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SurfaceCard>
        </div>
      </div>
    </PageShell>
  );
}
