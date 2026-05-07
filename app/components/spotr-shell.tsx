"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Gift, Target, Zap } from "lucide-react";
import { toast } from "sonner";
import { WalletButton } from "./wallet-button";
import { useWallet } from "../lib/wallet/context";
import { classifyTxError } from "../lib/wallet/tx-error";
import { useUsdcBalance } from "../lib/hooks/use-usdc-balance";
import { useVaultBalance } from "../lib/hooks/use-vault-balance";
import { useToken } from "@privy-io/react-auth";
import { useCluster } from "./cluster-context";

const INSUFFICIENT_VAULT_ERROR = "INSUFFICIENT_VAULT";
import { cn } from "../lib/utils";
import { ellipsify } from "../lib/explorer";
import {
  formatSignedMicroUsdc,
  lamportsToSol,
} from "../lib/format";
import { microUsdcToDisplay } from "../lib/usdc";
import { toPng } from "html-to-image";
import type {
  AdminSessionCard,
  FaultLinePair,
  LiveSessionSnapshot,
  ProfileSessionHistoryResponse,
  ProfileSessionHistoryRow,
  ProfileSessionRoundRow,
  ProfileSessionRoundsResponse,
  ProfileSummary,
  SessionPublicResults,
  SpotrDashboardPayload,
  SpotrPublicConfig,
  SpotrSide,
} from "../lib/spotr-types";
import { Button } from "./ui/button";
import {
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

type PlayerScreen =
  | "splash"
  | "howto"
  | "entry"
  | "checking"
  | "topup"
  | "sessions"
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
  const { wallet, status } = useWallet();
  const { getAccessToken } = useToken();
  const { cluster } = useCluster();
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    if (token) return { Authorization: `Bearer ${token}` };
    const addr = wallet?.account.address;
    if (cluster === "localnet" && addr) return { "X-Dev-Wallet": String(addr) };
    throw new Error("Privy session expired. Please log in again.");
  }, [getAccessToken, cluster, wallet]);
  const [data, setData] = useState(initialData);
  const [flipState, setFlipState] = useState(() => ({
    roundId: initialData.session.currentRoundId,
    flipped: false,
  }));
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<"A" | "B" | null>(null);
  const [wagerMicro, setWagerMicro] = useState<bigint | null>(null);
  const [lastSettledRoundId, setLastSettledRoundId] = useState<string | null>(null);
  const [dismissedRoundIds, setDismissedRoundIds] = useState<ReadonlySet<string>>(() => new Set());

  const walletAddress = wallet?.account.address ?? null;
  const canSignActions = Boolean(wallet?.signMessage);
  const { session, profile, admin, faultLines } = data;

  const availableSessions = data.availableSessions ?? [];
  const selectedSession =
    availableSessions.find((s) => s.id === selectedSessionId) ??
    admin.sessionHistory.find((s) => s.id === selectedSessionId) ??
    null;

  // activeRound: an OPEN round where the player can predict (already
  // deposited) or late-deposit (joined the session before this round
  // actually opened); else the next UPCOMING round; else nothing. A
  // session-late-joiner — i.e. one that joined after the round flipped open
  // — must skip the OPEN round and land in the next UPCOMING round's wait
  // screen, since on-chain `deposit_for_round` will reject them.
  const sessionJoinedAt = session.participant?.joinedAtIso
    ? new Date(session.participant.joinedAtIso).getTime()
    : null;
  const playerCanLateDeposit = (round: typeof session.rounds[number]) => {
    if (round.depositLamports != null) return true;
    if (sessionJoinedAt == null || round.opensAtIso == null) return false;
    return sessionJoinedAt <= new Date(round.opensAtIso).getTime();
  };
  const activeRound =
    session.rounds.find(
      (round) =>
        round.status === "open" &&
        !round.lockedSide &&
        playerCanLateDeposit(round) &&
        !dismissedRoundIds.has(round.id)
    ) ??
    session.rounds.find(
      (round) => round.status === "upcoming" && !dismissedRoundIds.has(round.id)
    ) ??
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

  // While waiting for the round fill threshold, poll the lightweight
  // heartbeat endpoint every 4 s. We only trigger a full dashboard refresh
  // when depositsCount crosses the fill threshold or the round flips out of
  // UPCOMING status — every other tick is a single Prisma read.
  const activeRoundIsWaiting =
    activeRound != null &&
    activeRound.status === "upcoming" &&
    (activeRound.depositLamports ?? null) != null;
  const lastHeartbeatRef = useRef<{ depositsCount: number; status: string } | null>(null);
  useEffect(() => {
    if (!activeRoundIsWaiting || !walletAddress || !activeRoundId) return;
    lastHeartbeatRef.current = null;
    const threshold = config.roundFillThreshold;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/rounds/heartbeat?roundId=${encodeURIComponent(activeRoundId)}`,
            { cache: "no-store" }
          );
          if (!response.ok) return;
          const payload = (await response.json()) as {
            depositsCount: number;
            status: string;
          };
          const previous = lastHeartbeatRef.current;
          lastHeartbeatRef.current = payload;
          const crossedThreshold =
            previous != null &&
            previous.depositsCount < threshold &&
            payload.depositsCount >= threshold;
          const statusFlipped =
            previous != null && previous.status === "UPCOMING" && payload.status !== "UPCOMING";
          const initialAlreadyOpen =
            previous == null && payload.status !== "UPCOMING";
          const initialAlreadyFull =
            previous == null && payload.depositsCount >= threshold;
          if (crossedThreshold || statusFlipped || initialAlreadyOpen || initialAlreadyFull) {
            void refreshDashboard(walletAddress).catch(() => undefined);
          }
        } catch {
          // best-effort polling
        }
      })();
    }, 4_000);
    return () => window.clearInterval(id);
  }, [activeRoundIsWaiting, walletAddress, activeRoundId, config.roundFillThreshold]);

  // Per-round countdown: derived from `opensAtIso` (the moment the round
  // flipped Pending→Open) plus `roundDurationSeconds`. We can't use
  // `closesAtIso` because every round shares `session.end_ts` for that
  // field. Late depositors naturally get the remaining slice because
  // `opensAt` is the actual flip time, not when this client first saw it.
  useEffect(() => {
    if (!activeRoundId || activeRound?.status !== "open") return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeRoundId, activeRound?.status]);

  const countdown = useMemo(() => {
    if (!activeRound || activeRound.status !== "open" || !activeRound.opensAtIso) {
      return null;
    }
    const opensAtMs = new Date(activeRound.opensAtIso).getTime();
    const elapsed = Math.floor((clockMs - opensAtMs) / 1000);
    return Math.max(0, config.roundDurationSeconds - elapsed);
  }, [
    activeRound?.id,
    activeRound?.status,
    activeRound?.opensAtIso,
    clockMs,
    config.roundDurationSeconds,
  ]);

  const sessionProgress = useMemo(() => {
    const start = new Date(session.startsAtIso).getTime();
    const end = new Date(session.endsAtIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return 0;
    }
    return Math.min(1, Math.max(0, (clockMs - start) / (end - start)));
  }, [clockMs, session.startsAtIso, session.endsAtIso]);

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

  const handleJoin = () => {
    if (!walletAddress) {
      setNotice({ tone: "error", message: "Connect a wallet before joining the session." });
      return;
    }
    const activeChainSessionNumber =
      selectedSession?.chainSessionNumber ?? data.session.chainSessionNumber;
    if (!activeChainSessionNumber) {
      setNotice({
        tone: "error",
        message: "This session has not been deployed on-chain yet.",
      });
      return;
    }

    startTransition(async () => {
      try {
        setNotice({ tone: "info", message: "Joining session…" });
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/session/join", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            referrerWallet: null,
            sessionId: selectedSession?.id ?? data.session.id,
          }),
        });
        const body = (await response.json()) as
          | (SpotrDashboardPayload & { error?: undefined })
          | { error: string; needed?: string; have?: string };
        if (!response.ok || "error" in body) {
          const err = "error" in body ? body.error : "Join failed.";
          if (err === INSUFFICIENT_VAULT_ERROR && "needed" in body) {
            const needed = (Number(body.needed ?? 0) / 1_000_000).toFixed(2);
            const have = (Number(body.have ?? 0) / 1_000_000).toFixed(2);
            const msg = `Need ${needed} USDC to join (you have ${have}). Top up at /airdrop.`;
            setNotice({ tone: "error", message: msg });
            toast.error(msg, {
              action: { label: "Top up", onClick: () => window.open("/airdrop", "_self") },
              duration: 8000,
            });
            return;
          }
          throw new Error(err);
        }
        setData(body);
        setNotice({ tone: "success", message: "Session joined." });
        toast.success("Session joined.");
      } catch (error) {
        console.error("[SPOTR] join session failed:", error);
        const { rejected, message } = classifyTxError(error);
        setNotice({ tone: rejected ? "info" : "error", message });
        if (rejected) toast(message);
        else toast.error(message);
      }
    });
  };

  const handleSelectSide = (side: "A" | "B") => {
    if (!walletAddress) {
      setNotice({ tone: "error", message: "Connect a wallet before entering a round." });
      return;
    }
    if (!activeRound || !activeDisplay) {
      setNotice({ tone: "error", message: "There is no active round to enter." });
      return;
    }
    if (!session.joined) {
      setNotice({ tone: "error", message: "Join the session before picking a side." });
      return;
    }
    setSelectedSide(side);
  };

  const handleConfirmDeposit = (amountMicro: bigint) => {
    if (!walletAddress || !activeRound) return;
    startTransition(async () => {
      try {
        setNotice({ tone: "info", message: "Submitting deposit…" });
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/rounds/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            roundId: activeRound.id,
            amountLamports: Number(amountMicro),
          }),
        });
        const body = (await response.json()) as
          | (SpotrDashboardPayload & { error?: undefined })
          | { error: string; needed?: string; have?: string };
        if (!response.ok || "error" in body) {
          const err = "error" in body ? body.error : "Deposit failed.";
          if (err === INSUFFICIENT_VAULT_ERROR && "needed" in body) {
            const needed = (Number(body.needed ?? 0) / 1_000_000).toFixed(2);
            const have = (Number(body.have ?? 0) / 1_000_000).toFixed(2);
            const msg = `Need ${needed} USDC to deposit (you have ${have}). Top up at /airdrop.`;
            setNotice({ tone: "error", message: msg });
            toast.error(msg, {
              action: { label: "Top up", onClick: () => window.open("/airdrop", "_self") },
              duration: 8000,
            });
            return;
          }
          throw new Error(err);
        }
        setData(body);
        setWagerMicro(null);
        setNotice({ tone: "success", message: "Deposit confirmed." });
        toast.success("Deposit confirmed.");
      } catch (error) {
        const { rejected, message } = classifyTxError(error);
        setNotice({ tone: rejected ? "info" : "error", message });
        if (rejected) toast(message);
        else toast.error(message);
      }
    });
  };

  const handleConfirmWager = () => {
    if (!walletAddress || !activeRound || !selectedSide) return;

    startTransition(async () => {
      try {
        setNotice({ tone: "info", message: "Locking your position…" });
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/rounds/enter", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            roundId: activeRound.id,
            side: selectedSide,
          }),
        });
        const body = (await response.json()) as
          | (SpotrDashboardPayload & { error?: undefined })
          | { error: string };
        if (!response.ok || "error" in body) {
          throw new Error("error" in body ? body.error : "Wager failed.");
        }
        const enteredRoundId = activeRound.id;
        setData(body);
        setSelectedSide(null);
        setWagerMicro(null);
        setLastSettledRoundId(enteredRoundId);
        setNotice({ tone: "success", message: `Position locked on side ${selectedSide}.` });
        toast.success(`Position locked on side ${selectedSide}.`);
      } catch (error) {
        const { rejected, message } = classifyTxError(error);
        setNotice({ tone: rejected ? "info" : "error", message });
        if (rejected) toast(message);
        else toast.error(message);
        // Clear the selected side so the conviction useEffect does not
        // immediately re-trigger and hammer the endpoint on failure.
        setSelectedSide(null);
      }
    });
  };

  const handleRefundUnused = (roundId: string) => {
    if (!walletAddress) return;
    startTransition(async () => {
      try {
        setNotice({ tone: "info", message: "Refunding deposit…" });
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/rounds/refund-unused", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ roundId }),
        });
        const body = (await response.json()) as
          | (SpotrDashboardPayload & { error?: undefined })
          | { error: string };
        if (!response.ok || "error" in body) {
          throw new Error("error" in body ? body.error : "Refund failed.");
        }
        setData(body);
        toast.success("Deposit refunded to your vault.");
        setNotice({ tone: "success", message: "Deposit refunded." });
      } catch (error) {
        const { rejected, message } = classifyTxError(error);
        setNotice({ tone: rejected ? "info" : "error", message });
        if (rejected) toast(message);
        else toast.error(message);
      }
    });
  };

  const runSponsoredClaim = (
    url: string,
    successMessage: string
  ) => {
    if (!walletAddress) return;
    startTransition(async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(url, {
          method: "POST",
          headers: authHeaders,
        });
        const body = (await response.json()) as
          | (SpotrDashboardPayload & { error?: undefined })
          | { error: string };
        if (!response.ok || "error" in body) {
          throw new Error("error" in body ? body.error : "Claim failed.");
        }
        setData(body);
        setNotice({ tone: "success", message: successMessage });
        toast.success(successMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Claim failed.";
        setNotice({ tone: "error", message });
        toast.error(message);
      }
    });
  };

  const handleClaimRounds = () => {
    runSponsoredClaim("/api/claims/rounds", "Round proceeds claimed.");
  };

  const handleClaimSessionBalance = () => {
    runSponsoredClaim("/api/claims/session-balance", "Returned escrow claimed.");
  };


  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const query = walletAddress
          ? `?wallet=${encodeURIComponent(walletAddress)}`
          : "";
        const response = await fetch(`/api/bootstrap${query}`, { cache: "no-store" });
        const payload = await readJson<SpotrDashboardPayload>(response);
        setData(payload);
      } catch {
        // silently ignore — UI keeps last good state
      }
    });
  }, [walletAddress]);

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
    selectedSessionId,
    selectedSession,
    setSelectedSessionId,
    handleJoin,
    handleSelectSide,
    handleConfirmDeposit,
    handleConfirmWager,
    handleRefundUnused,
    handleClaimRounds,
    handleClaimSessionBalance,
    refresh,
    selectedSide,
    setSelectedSide,
    wagerMicro,
    setWagerMicro,
    lastSettledRoundId,
    clearLastSettledRoundId: () => setLastSettledRoundId(null),
    dismissRound: (id: string) => setDismissedRoundIds((prev) => new Set([...prev, id])),
  };
}

function triggerUnavailable(message: string) {
  toast.error(message);
}

function GameNavBar() {
  const pathname = usePathname();
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <div className="flex gap-1">
        {[{ href: "/play", label: "Play" }, { href: "/profile", label: "Profile" }, { href: "/admin", label: "Admin" }].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
              (pathname === link.href || (link.href === "/play" && pathname.startsWith("/play")))
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white/80"
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <WalletButton />
    </div>
  );
}

function NarrowPageShell({ children, notice }: { children: ReactNode; notice: Notice }) {
  return (
    <div className="stage-canvas min-h-[100dvh]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1366px]">
        <div className="hidden flex-1 bg-[#09172c] md:block" />
        <div className="stage-shell stage-shell-onboard relative mx-auto flex min-h-[100dvh] w-full max-w-[446px] flex-col">
          <GameNavBar />
          {notice && <NoticeBanner tone={notice.tone}>{notice.message}</NoticeBanner>}
          <div className="flex-1 overflow-y-auto space-y-4 px-4 py-4 pb-8">
            {children}
          </div>
        </div>
        <div className="hidden flex-1 bg-[#09172c] md:block" />
      </div>
    </div>
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

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => { router.push(to); }, [router, to]);
  return (
    <StageScaffold surface="navy">
      <GameNavBar />
    </StageScaffold>
  );
}

export function SpotrShell({ config, initialData }: SpotrShellProps) {
  const state = useSpotrDashboard(config, initialData);
  const vault = useVaultBalance(state.walletAddress);
  const balance = { microUsdc: vault.microUsdc };
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
  const pnlShownRoundRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showSplash) return;
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  // PnL trigger: wager confirmed
  useEffect(() => {
    const settledId = state.lastSettledRoundId;
    if (!settledId || pnlShownRoundRef.current === settledId || showPnl) return;
    const settled = state.session.rounds.find((r) => r.id === settledId);
    if (!settled) return;
    pnlShownRoundRef.current = settledId;
    setSettledRound(settled);
    setShowPnl(true);
    void vault.mutate?.();
    const t = window.setTimeout(() => {
      setShowPnl(false);
      state.clearLastSettledRoundId();
      state.dismissRound(settledId);
      state.refresh();
    }, 5000);
    return () => window.clearTimeout(t);
  }, [
    state.lastSettledRoundId,
    state.session.rounds,
    state.refresh,
    state.clearLastSettledRoundId,
    state.dismissRound,
    showPnl,
    vault,
  ]);

  // PnL trigger: countdown elapsed (no wager placed, or round timed out).
  // Only fires when the wallet actually had skin in the game (deposited but
  // never locked a side). If the wallet had no deposit on this round, the
  // round expiring is irrelevant to them — silently dismiss it so the next
  // UPCOMING round becomes active without a "you sat this one out" screen.
  useEffect(() => {
    if (state.countdown !== 0 || !state.activeRound || showPnl) return;
    const round = state.activeRound;
    const roundId = round.id;
    if (pnlShownRoundRef.current === roundId) return;
    if (round.depositLamports == null) {
      pnlShownRoundRef.current = roundId;
      state.dismissRound(roundId);
      return;
    }
    pnlShownRoundRef.current = roundId;
    setSettledRound(round);
    setShowPnl(true);
    const t = window.setTimeout(() => {
      setShowPnl(false);
      state.dismissRound(roundId);
      state.refresh();
    }, 5000);
    return () => window.clearTimeout(t);
  }, [
    state.countdown,
    state.activeRound,
    state.dismissRound,
    state.refresh,
    showPnl,
  ]);

  const rewardList = state.profile?.rewards ?? [];
  let screen: PlayerScreen =
    state.session.status === "completed" && state.session.joined
      ? "season"
      : state.session.joined && !state.activeRound
        ? "season"
      : state.session.joined
        ? "live"
        : !introSeen && showSplash
          ? "splash"
          : !introSeen
            ? "howto"
            : "entry";

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
  if (screen === "pnl" && settledRound) {
    return (
      <PnlScreen
        round={settledRound}
        totalRounds={config.roundCount}
        activeFaultLine={state.activeFaultLine}
        onContinue={() => {
          setShowPnl(false);
          state.clearLastSettledRoundId();
          state.dismissRound(settledRound.id);
          state.refresh();
        }}
      />
    );
  }
  if (screen === "season") {
    return <Redirect to={`/play/${state.session.id}/recap`} />;
  }
  return (
    <LiveGameScreen config={config} state={state} balanceMicro={balance.microUsdc} />
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
          body="Seven rounds. Real culture. No wrong opinions, only early ones."
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
      <GameNavBar />
      <CenteredHero
        logo={<EyeBrand size={40} />}
        title="What do you actually think?"
        body="Browse open sessions and join with a Solana wallet."
        action={
          <Link
            href="/play"
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-bold uppercase tracking-[0.1em] text-black transition hover:bg-primary/90"
          >
            Browse Sessions
          </Link>
        }
        footer="All positions settle on Solana. · SPOTR.TV never has custody of your funds."
      />
    </StageScaffold>
  );
}

function BalanceCheckScreen({
  buyInLamports,
  balanceMicro,
  isLoading,
}: {
  buyInLamports: number;
  balanceMicro: bigint | null;
  isLoading: boolean;
}) {
  const [phase, setPhase] = useState<"checking" | "success" | "low">("checking");

  useEffect(() => {
    if (isLoading) {
      setPhase("checking");
      return;
    }
    const t = window.setTimeout(() => {
      if (balanceMicro == null) {
        setPhase("checking");
        return;
      }
      const bal = Number(balanceMicro);
      setPhase(bal >= buyInLamports ? "success" : "low");
    }, 1600);
    return () => window.clearTimeout(t);
  }, [isLoading, balanceMicro, buyInLamports]);

  const balUsdc = balanceMicro != null ? microUsdcToDisplay(Number(balanceMicro)) : "0";
  const minUsdc = microUsdcToDisplay(buyInLamports);

  if (phase === "checking") {
    return (
      <StageScaffold surface="navy">
        <GameNavBar />
        <CenteredHero
          logo={<EyeBrand size={40} />}
          title="Checking your wallet balance…"
          body={`Minimum entry: ${minUsdc} USDC`}
        />
      </StageScaffold>
    );
  }

  if (phase === "success") {
    return (
      <StageScaffold surface="navy">
        <GameNavBar />
        <CenteredHero
          logo={<StatusIcon tone="success" />}
          title={`Balance: ${balUsdc} USDC`}
          body="You're cleared to play."
        />
      </StageScaffold>
    );
  }

  return (
    <StageScaffold surface="navy">
      <GameNavBar />
      <CenteredHero
        logo={<StatusIcon tone="error" />}
        title="Balance too low"
        body={`You have ${balUsdc} USDC. Top up to at least ${minUsdc} USDC to play.`}
      />
    </StageScaffold>
  );
}

function TopUpScreen({
  config,
  balanceMicro,
}: {
  config: SpotrPublicConfig;
  balanceMicro: bigint | null;
}) {
  const balUsdc = Number(balanceMicro ?? 0n) / 1_000_000;
  const minUsdc = config.sessionBuyInLamports / 1_000_000;
  const shortfall = Math.max(0, minUsdc - balUsdc);
  const [amount, setAmount] = useState(
    parseFloat(shortfall.toFixed(2)) || 5
  );
  const presets = [5, 10, 25];

  return (
    <StageScaffold surface="onboard">
      <GameNavBar />
      <div className="flex flex-1 flex-col px-6 pb-6 pt-4">
        <div className="mb-6">
          <EyeBrand size={32} />
        </div>

        <h2 className="mb-3 text-[28px] font-bold text-white">Top up to play.</h2>
        <p className="mb-6 text-[15px] leading-relaxed text-white/70">
          Your wallet has {balUsdc.toFixed(2)} USDC. You need at least{" "}
          {minUsdc.toFixed(2)} USDC to start a session.
        </p>

        <div className="space-y-4">
          <BalanceStatusRow currentUsdc={balUsdc} shortfallUsdc={shortfall} />
          <AmountStepper valueUsdc={amount} onChange={setAmount} step={1} min={0.5} />
          <QuickAmountChips
            options={presets}
            selected={amount}
            onSelect={setAmount}
          />
          <ConversionLine newBalanceUsdc={balUsdc + amount} />
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
              Add {amount.toFixed(2)} USDC to Wallet
            </Button>
          }
          note="Funds stay in your wallet. SPOTR never has custody."
        />
      </div>
    </StageScaffold>
  );
}

function SessionListScreen({
  sessions,
  config,
  onSelect,
}: {
  sessions: AdminSessionCard[];
  config: SpotrPublicConfig;
  onSelect: (id: string) => void;
}) {
  const joinable = sessions.filter(
    (s) => s.status === "pending" || s.status === "live"
  );
  return (
    <StageScaffold surface="onboard">
      <GameNavBar />
      <div className="flex flex-1 flex-col px-4 pb-6 pt-2">
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
            Available sessions
          </p>
          <h2 className="mt-1 text-[22px] font-bold text-white">Join a session</h2>
        </div>

        {joinable.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-sm text-white/50">
              No sessions open right now. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {joinable.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onJoin={() => onSelect(session.id)}
              />
            ))}
          </div>
        )}
      </div>
    </StageScaffold>
  );
}

function SessionCard({
  session,
  onJoin,
}: {
  session: AdminSessionCard;
  onJoin: () => void;
}) {
  const isLive = session.status === "live";
  const startDate = new Date(session.startsAtIso);
  const endDate = new Date(session.endsAtIso);
  const timeRange = `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${startDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} – ${endDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-white">{session.title}</p>
          <p className="mt-0.5 text-[11px] text-white/50">{timeRange}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
            isLive
              ? "bg-success/20 text-success"
              : "bg-primary/20 text-primary"
          )}
        >
          {isLive ? "Live" : "Open"}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <p className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Wallets</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {session.walletsJoined}
          </p>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <p className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Entry</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">Free</p>
        </div>
      </div>

      <Button
        type="button"
        variant="gold"
        size="sm"
        className="w-full"
        onClick={onJoin}
        disabled={!session.chainSessionNumber}
      >
        {session.chainSessionNumber ? "Join Session" : "Not deployed yet"}
      </Button>
    </div>
  );
}

function ConfirmSessionScreen({
  state,
  onBack,
}: {
  state: ReturnType<typeof useSpotrDashboard>;
  onBack: () => void;
}) {
  const activeSession = state.selectedSession ?? null;
  const done = state.session.joined;
  const onChain = Boolean(
    activeSession?.chainSessionNumber ?? state.session.chainSessionNumber
  );
  const sessionTitle = activeSession?.title ?? state.session.title;

  if (done) {
    return (
      <StageScaffold surface="navy">
        <GameNavBar />
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
        <GameNavBar />
        <CenteredHero
          logo={<EyeBrand size={44} />}
          title="Session not yet on-chain"
          body="The session hasn't been deployed on-chain yet. Check back soon."
          action={
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              ← Back to sessions
            </Button>
          }
        />
      </StageScaffold>
    );
  }

  return (
    <StageScaffold surface="navy">
      <GameNavBar />
      <CenteredHero
        logo={<EyeBrand size={44} />}
        title={state.isPending ? "Confirming on Solana…" : sessionTitle}
        body={
          state.isPending
            ? "Sign the transaction in your wallet."
            : "Register your seat to start playing."
        }
        action={
          <div className="flex w-full flex-col gap-2">
            <Button
              type="button"
              variant="gold"
              size="block"
              onClick={state.handleJoin}
              disabled={!state.canSignActions || state.isPending}
            >
              {state.isPending ? "Confirming on Solana…" : "Join Session"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={state.isPending}>
              ← Back to sessions
            </Button>
          </div>
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
    status: "joined",
  }));
  const starting = state.session.status === "live";
  const threshold = config.roundFillThreshold;
  return (
    <StageScaffold surface="navy">
      <WaitingRoom
        joined={state.session.walletsJoined}
        threshold={threshold}
        players={players}
        starting={starting}
        caption={`Session fills at ${threshold} players`}
      />
    </StageScaffold>
  );
}

const WAGER_PRESETS_MICRO = [1, 2, 5, 10, 25, 50, 100, 250].map(
  (n) => BigInt(n) * 1_000_000n
);

function WagerPicker({
  vaultBalance,
  selectedWager,
  onSelect,
  countdown,
  onConfirm,
  isPending,
  ctaLabel,
}: {
  vaultBalance: bigint | null;
  selectedWager: bigint | null;
  onSelect: (wager: bigint) => void;
  countdown: number | null;
  onConfirm: () => void;
  isPending: boolean;
  ctaLabel?: string;
}) {
  const [customInput, setCustomInput] = useState("");
  const isCustomSelected =
    selectedWager != null && !WAGER_PRESETS_MICRO.includes(selectedWager);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
        Select wager
        {vaultBalance != null && (
          <span className="ml-2 normal-case text-white/30">
            · {microUsdcToDisplay(Number(vaultBalance))} USDC available
          </span>
        )}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {WAGER_PRESETS_MICRO.map((amount) => {
          const tooLarge = vaultBalance != null && amount > vaultBalance;
          const isSelected = selectedWager === amount;
          return (
            <button
              key={amount.toString()}
              type="button"
              onClick={() => { setCustomInput(""); onSelect(amount); }}
              disabled={tooLarge || isPending}
              className={cn(
                "rounded-xl border py-2.5 text-[12px] font-bold transition",
                isSelected
                  ? "border-primary bg-primary/20 text-primary"
                  : tooLarge
                    ? "border-white/5 bg-white/3 text-white/20 cursor-not-allowed"
                    : "border-white/10 bg-white/5 text-white hover:border-primary/50 hover:text-primary"
              )}
            >
              ${Number(amount / 1_000_000n)}
            </button>
          );
        })}
      </div>
      <input
        type="number"
        min="1"
        step="1"
        placeholder="Custom amount ($)"
        value={customInput}
        onChange={(e) => {
          const raw = e.target.value;
          setCustomInput(raw);
          const dollars = parseFloat(raw);
          if (!isNaN(dollars) && dollars >= 1) {
            onSelect(BigInt(Math.floor(dollars)) * 1_000_000n);
          }
        }}
        disabled={isPending}
        className={cn(
          "w-full rounded-xl border bg-white/5 px-3 py-2.5 text-center text-[12px] font-bold text-white placeholder-white/30 outline-none transition",
          isCustomSelected
            ? "border-primary text-primary"
            : "border-white/10 hover:border-primary/50"
        )}
      />
      <Button
        type="button"
        variant="gold"
        size="block"
        onClick={onConfirm}
        disabled={!selectedWager || isPending}
      >
        {isPending
          ? "Confirming…"
          : selectedWager
            ? ctaLabel ?? (countdown != null
                ? `Confirm wager → ${countdown}s`
                : "Confirm")
            : "Pick an amount above"}
      </Button>
    </div>
  );
}

type RoundPhase = "deposit" | "wait" | "predict" | "locked" | "settled";

function deriveRoundPhase(
  round: NonNullable<ReturnType<typeof useSpotrDashboard>["activeRound"]>
): RoundPhase {
  if (round.lockedSide) return "locked";
  if (round.status === "closed") return "settled";
  if (round.depositLamports == null) return "deposit";
  if (round.status === "open") return "predict";
  return "wait";
}

function DepositScreen({
  config,
  state,
  balanceMicro,
  rolloverLamports,
  late,
}: {
  config: SpotrPublicConfig;
  state: ReturnType<typeof useSpotrDashboard>;
  balanceMicro: bigint | null;
  rolloverLamports: bigint | null;
  late: boolean;
}) {
  const round = state.activeRound;
  const isFirst = !rolloverLamports || rolloverLamports === 0n;

  return (
    <StageScaffold surface="navy">
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-4">
          <EyeBrand size={28} />
          {round ? (
            <RoundLabel index={round.index + 1} total={config.roundCount} />
          ) : (
            <span />
          )}
          <BalancePill balanceLamports={balanceMicro} />
        </div>

        <div className="flex flex-1 flex-col items-center px-6 pt-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary">
            {isFirst ? "Deposit · round 1" : `Deposit · round ${(round?.index ?? 0) + 1}`}
          </p>
          <h2 className="mt-3 text-center font-display text-[1.6rem] font-bold tracking-[-0.02em] text-white">
            {isFirst ? "Stake your conviction" : "Roll over your stake"}
          </h2>
          <p className="mt-2 max-w-xs text-center text-sm text-white/55">
            {isFirst
              ? "Deposits seed the round. Once 7 wallets are in, the predict phase opens."
              : `Rolling over ${microUsdcToDisplay(Number(rolloverLamports ?? 0n))} USDC. Adjust to add or reduce before confirming.`}
          </p>
          {late ? (
            <p className="mt-3 text-center text-[11px] uppercase tracking-[0.18em] text-amber-300/80">
              Round in progress — less time to predict.
            </p>
          ) : null}

          <div className="mt-8 w-full max-w-[340px]">
            <WagerPicker
              vaultBalance={balanceMicro}
              selectedWager={state.wagerMicro}
              onSelect={state.setWagerMicro}
              countdown={null}
              onConfirm={() => {
                if (state.wagerMicro) state.handleConfirmDeposit(state.wagerMicro);
              }}
              isPending={state.isPending}
              ctaLabel={isFirst ? "Confirm deposit" : "Confirm rolling deposit"}
            />
          </div>
        </div>
      </div>
    </StageScaffold>
  );
}

function PredictScreen({
  config,
  state,
  balanceMicro,
}: {
  config: SpotrPublicConfig;
  state: ReturnType<typeof useSpotrDashboard>;
  balanceMicro: bigint | null;
}) {
  const round = state.activeRound;
  const isLocked = Boolean(round?.lockedSide);
  const sideSelected = !isLocked && Boolean(state.selectedSide);
  const roundOpen = round?.status === "open";
  const roundId = round?.id ?? null;

  // After picking a side, fire the on-chain enter_position. The wager is
  // already committed via `deposit_for_round`; no amount picker here.
  useEffect(() => {
    if (sideSelected && !isLocked && !state.isPending && roundOpen) {
      const id = window.setTimeout(() => {
        state.handleConfirmWager();
      }, config.convictionHoldMs ?? 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
    // We intentionally key on side + round identity; `state` is captured by reference.
  }, [sideSelected, isLocked, state.isPending, roundOpen, roundId, config.convictionHoldMs]);

  if (!round) return null;
  const roundProgress =
    state.countdown == null
      ? 0
      : Math.max(0, Math.min(100, (state.countdown / config.roundDurationSeconds) * 100));

  function handleBuy() {
    state.handleSelectSide((state.activeDisplay?.side as "A" | "B") ?? "A");
  }

  return (
    <StageScaffold surface="navy">
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-4">
          <EyeBrand size={28} />
          <RoundLabel index={round.index + 1} total={config.roundCount} />
          <BalancePill balanceLamports={balanceMicro} />
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
          {state.activeFaultLine ? (
            <FaultLineCard
              category={state.activeFaultLine.category}
              sideA={state.activeFaultLine.sideA}
              sideB={state.activeFaultLine.sideB}
              sideAPct={round.sideAProbabilityPct}
              sideBPct={round.sideBProbabilityPct}
              flipped={state.flipped}
              onFlip={
                isLocked
                  ? () => {}
                  : () => {
                      const newSide = state.flipped ? "A" : "B";
                      state.setFlipState((current) => ({
                        roundId: round.id,
                        flipped:
                          current.roundId === round.id ? !current.flipped : true,
                      }));
                      if (sideSelected) {
                        state.handleSelectSide(newSide);
                      }
                    }
              }
              locked={isLocked || sideSelected}
              lockedSide={
                isLocked
                  ? ((round.lockedSide as SpotrSide) ?? null)
                  : sideSelected
                    ? (state.selectedSide as SpotrSide)
                    : null
              }
            />
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/50">
              No deployed session data is available yet.
            </div>
          )}

          {isLocked || sideSelected ? (
            <>
              <p className="mb-3 mt-4 text-center text-[13px] text-white/40">
                {isLocked
                  ? `Position locked · settles in ${state.countdown ?? "—"}s`
                  : "Locking opinion…"}
              </p>
              {isLocked ? (
                <TokenConfirmationCard
                  statement={state.activeDisplay?.copy ?? ""}
                  settlesIn={state.countdown}
                />
              ) : null}
            </>
          ) : (
            <>
              <p className="mb-3 mt-4 text-center text-[13px] text-white/40">
                Tap card to flip · lock your opinion
              </p>
              <Button
                type="button"
                variant="gold"
                size="block"
                onClick={handleBuy}
                disabled={
                  state.isPending ||
                  !state.session.joined ||
                  !state.canSignActions ||
                  round.status !== "open"
                }
              >
                {state.isPending
                  ? "Loading..."
                  : `Lock opinion · side ${state.activeDisplay?.side ?? "A"}`}
              </Button>
            </>
          )}

          <p className="mb-5 mt-3 text-center text-[11px] text-white/30">
            Wager already committed at deposit. Positions settle on Solana.
          </p>
        </div>
      </div>
    </StageScaffold>
  );
}

function RoundWaitScreen({
  state,
  config,
  late,
}: {
  state: ReturnType<typeof useSpotrDashboard>;
  config: SpotrPublicConfig;
  late: boolean;
}) {
  const round = state.activeRound;
  const threshold = config.roundFillThreshold;
  const current = round?.walletsDepositedForRound ?? 0;
  // Use the actual round depositors so the feed matches the counter exactly.
  const players = (round?.depositorAddresses ?? []).map((addr) => ({
    address: addr,
    status: "deposited",
  }));
  return (
    <StageScaffold surface="navy">
      <WaitingRoom
        joined={current}
        threshold={threshold}
        players={players}
        starting={current >= threshold}
        caption={
          late
            ? "Round in progress — less time to predict."
            : `Round fills at ${threshold} players`
        }
      />
    </StageScaffold>
  );
}

function LiveGameScreen({
  config,
  state,
  balanceMicro,
}: {
  config: SpotrPublicConfig;
  state: ReturnType<typeof useSpotrDashboard>;
  balanceMicro: bigint | null;
}) {
  if (!state.activeRound) {
    return <WaitingRoomScreen state={state} config={config} />;
  }

  // Compute roll-over balance from the most recent settled round (claimable
  // proceeds + remaining deposit). Null on the first round of the session.
  const settledRounds = state.session.rounds.filter(
    (r) => r.index < state.activeRound!.index && r.depositLamports != null
  );
  const previous = settledRounds[settledRounds.length - 1];
  const rollover = previous
    ? BigInt(previous.claimableLamports + previous.claimedLamports)
    : 0n;

  const phase = deriveRoundPhase(state.activeRound);
  // Late = the round is already Open. Surfaced on the deposit / wait
  // screens so the player knows they have less time to predict than the
  // full `roundDurationSeconds` window.
  const late = state.activeRound.status === "open";

  if (phase === "deposit") {
    return (
      <DepositScreen
        config={config}
        state={state}
        balanceMicro={balanceMicro}
        rolloverLamports={rollover > 0n ? rollover : null}
        late={late}
      />
    );
  }
  if (phase === "wait") {
    return <RoundWaitScreen state={state} config={config} late={late} />;
  }
  // predict | locked → same screen, just different inner state.
  return <PredictScreen config={config} state={state} balanceMicro={balanceMicro} />;
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
            Round {round.index + 1} of {totalRounds}
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

export function SessionEndedScreen({
  session,
  profile,
  faultLines,
  config,
}: {
  session: LiveSessionSnapshot;
  profile: ProfileSummary | null;
  faultLines: FaultLinePair[];
  config: SpotrPublicConfig;
}) {
  const cumPnl = profile?.cumulativePnlLamports ?? 0;
  const pnlTone = cumPnl > 0 ? "text-[#22c55e]" : cumPnl < 0 ? "text-[#ef4444]" : "text-white";

  // Show last 6 chars of chain number so long integers don't overflow
  const sessionNum = session.chainSessionNumber
    ? String(session.chainSessionNumber).slice(-6).padStart(6, "0")
    : session.id.slice(-6).toUpperCase();

  const walletShort = profile?.walletAddress
    ? ellipsify(profile.walletAddress, 4)
    : "—";

  // "28 APR 2026" format matching reference
  const dateStr = new Date()
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();

  const settledCount = session.rounds.filter((r) => r.status === "closed").length;
  const roundCount = settledCount || config.roundCount;

  const roundPnls = session.rounds.map((r) => {
    // include already-claimed winnings so claimed rounds show green, not red
    const pnl = (r.claimableLamports + r.claimedLamports) - (r.stakeLamports ?? 0);
    const faultLine = faultLines.find((f) => f.roundId === r.id);
    return { round: r, pnl, category: faultLine?.category ?? "" };
  });

  const entered = roundPnls.filter((r) => r.round.lockedSide);
  const sorted = [...entered].sort((a, b) => b.pnl - a.pnl);
  const best = sorted[0] ?? null;
  const worst = sorted[sorted.length - 1] ?? null;
  const rawMax = Math.max(...roundPnls.map((r) => Math.abs(r.pnl)));
  // hasData = at least one round has a non-zero PnL
  const hasData = rawMax > 0;
  const maxAbs = hasData ? rawMax : 1;

  const cardRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload() {
    if (!cardRef.current || isDownloading) return;
    setIsDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `spotr-conviction-${sessionNum}.png`;
      a.click();
    } catch {
      toast.error("Could not export card");
    } finally {
      setIsDownloading(false);
    }
  }

  const profileInitial = (
    profile?.displayName?.trim().charAt(0) ||
    profile?.walletAddress?.charAt(0) ||
    "?"
  ).toUpperCase();

  return (
    <StageScaffold surface="navy">
      {/* Hero — top */}
      <div className="relative flex flex-col items-center pt-12 pb-0">
        <div className="absolute left-4 right-4 top-4 flex items-center justify-between">
          <span className="h-9 w-9" aria-hidden />
          <EyeBrand size={28} />
          <Link
            href="/profile"
            aria-label="Open profile"
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[13px] font-bold text-white transition hover:border-primary/50 hover:bg-white/10"
          >
            {profileInitial}
          </Link>
        </div>
        <div className="h-9" aria-hidden />
        <p className={cn("mt-5 font-mono text-[40px] font-bold tabular-nums tracking-[-0.02em] leading-none", pnlTone)}>
          {formatSignedMicroUsdc(cumPnl).replace(" USDC", "")}
        </p>
        <p className="mt-2 text-[12px] text-white/50">
          Season 1 · {roundCount} round{roundCount !== 1 ? "s" : ""} settled
        </p>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Conviction Card */}
      <div className="px-4">
        <div ref={cardRef} className="overflow-hidden rounded-[14px] shadow-[0_16px_48px_rgba(0,0,0,0.5)]">

          {/* Card header */}
          <div className="flex items-center justify-between bg-[#0f1a2e] px-4 py-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white">
              SPOTR · CONVICTION CARD
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">
              SEASON 1
            </span>
          </div>

          {/* Card body — cream */}
          <div className="bg-[#f5f0e8] px-4 pt-3 pb-4 space-y-3">

            {/* Session / Wallet / Date row */}
            <div className="flex gap-6">
              {[
                { label: "SESSION", value: `#${sessionNum}` },
                { label: "WALLET", value: walletShort },
                { label: "DATE", value: dateStr },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[7px] font-semibold uppercase tracking-[0.22em] text-[#8a7f6e]">
                    {label}
                  </span>
                  <span className="font-mono text-[10px] font-bold text-[#1a1628]">
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-[#c8bfae]" />

            {/* Net PnL */}
            <div>
              <p className="font-mono text-[7px] font-semibold uppercase tracking-[0.28em] text-[#8a7f6e]">
                NET PnL · USDC
              </p>
              <p className={cn("mt-0.5 font-mono text-[40px] font-bold tabular-nums leading-none tracking-[-0.03em]",
                cumPnl > 0 ? "text-[#15803d]" : cumPnl < 0 ? "text-[#b91c1c]" : "text-[#1a1628]"
              )}>
                {cumPnl > 0 ? "+" : ""}{microUsdcToDisplay(Math.abs(cumPnl))}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[#8a7f6e]">
                = ${microUsdcToDisplay(Math.abs(cumPnl))} USD
              </p>
            </div>

            <div className="border-t border-dashed border-[#c8bfae]" />

            {/* Best / Worst */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "BEST ROUND", data: best },
                { label: "WORST ROUND", data: worst },
              ].map(({ label, data }) => (
                <div key={label}>
                  <p className="font-mono text-[7px] font-semibold uppercase tracking-[0.22em] text-[#8a7f6e]">
                    {label}
                  </p>
                  {data ? (
                    <>
                      <p className={cn("mt-0.5 font-mono text-[18px] font-bold tabular-nums leading-none",
                        data.pnl > 0 ? "text-[#15803d]" : data.pnl < 0 ? "text-[#b91c1c]" : "text-[#1a1628]"
                      )}>
                        {data.pnl > 0 ? "+" : ""}{microUsdcToDisplay(data.pnl)}
                      </p>
                      <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#8a7f6e]">
                        R{data.round.index + 1}{data.category ? ` · ${data.category}` : ""}
                      </p>
                    </>
                  ) : (
                    <p className="mt-0.5 font-mono text-[16px] text-[#8a7f6e]">—</p>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-[#c8bfae]" />

            {/* Bar chart */}
            <div>
              <p className="font-mono text-[7px] font-semibold uppercase tracking-[0.28em] text-[#8a7f6e] mb-2">
                {roundCount} ROUNDS
              </p>
              {/* two-sided chart: gains grow up from baseline, losses grow down */}
              <div className="relative flex gap-1" style={{ height: 57 }}>
                <div className="absolute left-0 right-0 h-px bg-[#c8bfae]" style={{ top: 28 }} />
                {session.rounds.map((r) => {
                  const entry = roundPnls.find((x) => x.round.id === r.id);
                  const pnl = entry?.pnl ?? 0;
                  const isSkipped = r.status === "skipped" || r.status === "upcoming";
                  const didEnter = r.stakeLamports !== null;
                  const noData = !hasData || isSkipped || !didEnter;
                  const barPx = noData
                    ? 3
                    : Math.max(4, Math.round((Math.abs(pnl) / maxAbs) * 26));
                  const barStyle = noData
                    ? { height: barPx, top: 27 }
                    : pnl > 0
                    ? { height: barPx, top: 28 - barPx }
                    : { height: barPx, top: 29 };
                  return (
                    <div key={r.id} className="relative flex-1">
                      <div
                        className={cn("absolute left-0 right-0 rounded-[2px]",
                          noData ? "bg-[#c8bfae]" : pnl > 0 ? "bg-[#15803d]" : "bg-[#b91c1c]"
                        )}
                        style={barStyle}
                      />
                    </div>
                  );
                })}
              </div>
              {/* labels */}
              <div className="flex gap-1 mt-1">
                {session.rounds.map((r) => (
                  <span key={r.id} className="flex-1 text-center font-mono text-[6px] text-[#8a7f6e]">
                    R{r.index + 1}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Card footer */}
          <div className="flex items-center justify-between bg-[#0f1a2e] px-4 py-3">
            <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.25em] text-white/50">
              SPOTR.TV
            </span>
            <EyeBrand size={16} />
            <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.25em] text-white/50">
              BACKED BY BELIEF
            </span>
          </div>

        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Buttons — bottom */}
      <div className="flex flex-col gap-2 px-4 pb-10">
        <Link
          href="/profile"
          className="flex items-center justify-center rounded-full bg-primary px-6 py-4 text-sm font-bold uppercase tracking-[0.1em] text-black transition hover:bg-primary/90"
        >
          View Profile
        </Link>
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          className="py-2 text-center text-[12px] text-white/40 underline underline-offset-2 transition hover:text-white/70 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDownloading ? "Downloading…" : "Download conviction card"}
        </button>
      </div>
    </StageScaffold>
  );
}

export function SeasonScreen({
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
  const [isSharing, setIsSharing] = useState(false);

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

  async function handleShareHaul() {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const pnlSign = cumPnl >= 0 ? "+" : "-";
      const pnlStr = `${pnlSign}${lamportsToSol(Math.abs(cumPnl))} SOL`;
      const prizeLines = prizeList.map((p) => `• ${p.title}`).join("\n");
      const sessionWord = roundsSettled === 1 ? "session" : "sessions";
      const text = [
        "I just cracked my SPOTR haul 🎯",
        "",
        prizeLines,
        "",
        `PnL: ${pnlStr} across ${roundsSettled} ${sessionWord}`,
        "Play at spotrmarkets.xyz",
      ].join("\n");

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ text });
          return;
        } catch {
          // user cancelled or API failed — fall through to clipboard
        }
      }

      await navigator.clipboard.writeText(text);
      toast.success("Haul copied to clipboard");
    } finally {
      setIsSharing(false);
    }
  }

  const pnlTone = cumPnl >= 0 ? "text-success" : "text-destructive";

  return (
    <StageScaffold surface="onboard">
      <GameNavBar />
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
            value={cumPnl / 1_000_000}
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} USDC`}
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
              onClick={() => void handleShareHaul()}
              disabled={isSharing}
              className="focus-ring w-full rounded-[14px] border-[1.5px] border-white/40 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSharing ? "Sharing…" : "Share my haul"}
            </button>
          </div>
        ) : null}
      </div>
    </StageScaffold>
  );
}


// ─── /profile sessions card ────────────────────────────────────────────────
// Lists every session the wallet has joined; clicking a row expands to show
// the wallet's per-round detail (stake, side picked, outcome, payout) loaded
// lazily from /api/profile/sessions/[id]/rounds.

function SessionsPlayedCard({ walletAddress }: { walletAddress: string }) {
  return (
    <SessionsPlayedCardInner key={walletAddress} walletAddress={walletAddress} />
  );
}

function formatJoinedDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(status: ProfileSessionHistoryRow["status"]) {
  switch (status) {
    case "completed":
      return "Ended";
    case "live":
      return "Live";
    case "expired":
      return "Expired";
    case "pending":
    default:
      return "Pending";
  }
}

function SessionsPlayedCardInner({ walletAddress }: { walletAddress: string }) {
  const [items, setItems] = useState<ProfileSessionHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/history?wallet=${encodeURIComponent(walletAddress)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ProfileSessionHistoryResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setItems(payload.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load history.");
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return (
    <SurfaceCard>
      <SectionHeading
        eyebrow="Sessions played"
        title="Your SPOTR ledger"
        description="Tap a session for the round-by-round breakdown."
      />
      <div className="mt-4 space-y-3">
        {error ? (
          <p className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : items == null ? (
          <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3 text-sm text-muted">
            No sessions joined yet.
          </p>
        ) : (
          items.map((row) => {
            const isOpen = openSessionId === row.sessionId;
            const pnlTone =
              row.netPnlLamports > 0
                ? "text-success"
                : row.netPnlLamports < 0
                  ? "text-destructive"
                  : "text-muted";
            return (
              <div
                key={row.sessionId}
                className={cn(
                  "rounded-[1rem] border bg-black/16 transition",
                  isOpen
                    ? "border-primary/40"
                    : "border-white/12 hover:border-primary/40"
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenSessionId(isOpen ? null : row.sessionId)
                  }
                  aria-expanded={isOpen}
                  className="focus-ring flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {row.title}
                    </p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-muted">
                      {formatJoinedDate(row.joinedAtIso)} · {statusLabel(row.status)}{" "}
                      · {row.positionsEntered} round
                      {row.positionsEntered === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-sm font-semibold tabular-nums",
                      pnlTone
                    )}
                  >
                    {formatSignedMicroUsdc(row.netPnlLamports)}
                  </span>
                </button>
                {isOpen ? (
                  <div className="border-t border-white/10 px-4 pb-4 pt-3">
                    <SessionRoundsBreakdown
                      walletAddress={walletAddress}
                      sessionId={row.sessionId}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </SurfaceCard>
  );
}

function SessionRoundsBreakdown({
  walletAddress,
  sessionId,
}: {
  walletAddress: string;
  sessionId: string;
}) {
  const [rounds, setRounds] = useState<ProfileSessionRoundRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRounds(null);
    setError(null);
    fetch(
      `/api/profile/sessions/${encodeURIComponent(sessionId)}/rounds?wallet=${encodeURIComponent(walletAddress)}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ProfileSessionRoundsResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setRounds(payload.rounds);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load rounds."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, sessionId]);

  if (error) {
    return (
      <p className="rounded-[0.75rem] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </p>
    );
  }
  if (rounds == null) {
    return (
      <p className="rounded-[0.75rem] border border-white/10 bg-black/16 px-3 py-2 text-xs text-muted">
        Loading rounds…
      </p>
    );
  }
  if (rounds.length === 0) {
    return (
      <p className="rounded-[0.75rem] border border-white/10 bg-black/16 px-3 py-2 text-xs text-muted">
        No round-level activity recorded for this wallet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rounds.map((round) => (
        <ProfileRoundRow key={round.roundId} round={round} />
      ))}
    </div>
  );
}

function ProfileRoundRow({ round }: { round: ProfileSessionRoundRow }) {
  const pnlMicro =
    round.claimableMicroUsdc + round.claimedMicroUsdc - round.stakeMicroUsdc;
  const sideCopy =
    round.lockedSide === "A"
      ? round.sideA
      : round.lockedSide === "B"
        ? round.sideB
        : null;

  let outcome: { label: string; tone: "success" | "destructive" | "muted" };
  if (round.lockedSide == null) {
    outcome = round.depositRefunded
      ? { label: "Refunded", tone: "muted" }
      : round.depositMicroUsdc != null
        ? { label: "Sat out", tone: "muted" }
        : { label: "—", tone: "muted" };
  } else if (!round.redistributeApplied) {
    outcome = { label: "Pending", tone: "muted" };
  } else if (round.winningSide && round.winningSide === round.lockedSide) {
    outcome = { label: "Win", tone: "success" };
  } else if (round.winningSide && round.winningSide !== round.lockedSide) {
    outcome = { label: "Loss", tone: "destructive" };
  } else {
    outcome = { label: "Settled", tone: "muted" };
  }

  const outcomeClass =
    outcome.tone === "success"
      ? "border-success/30 bg-success/15 text-success"
      : outcome.tone === "destructive"
        ? "border-destructive/30 bg-destructive/15 text-destructive"
        : "border-white/12 bg-white/5 text-muted";

  const pnlTone =
    pnlMicro > 0
      ? "text-success"
      : pnlMicro < 0
        ? "text-destructive"
        : "text-muted";

  return (
    <div className="rounded-[0.75rem] border border-white/10 bg-black/24 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Round {round.roundIndex + 1}
            <span className="ml-2 font-normal text-muted">
              · {round.pairCategory}
            </span>
          </p>
          <p className="mt-1 truncate text-xs text-foreground">
            {sideCopy ?? (
              <span className="text-muted">No position locked</span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
            outcomeClass
          )}
        >
          {outcome.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="uppercase tracking-[0.18em] text-muted">Stake</p>
          <p className="mt-0.5 font-mono tabular-nums text-foreground">
            {round.stakeMicroUsdc > 0
              ? `${microUsdcToDisplay(round.stakeMicroUsdc)}`
              : round.depositMicroUsdc != null
                ? `${microUsdcToDisplay(round.depositMicroUsdc)}*`
                : "—"}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-[0.18em] text-muted">Payout</p>
          <p className="mt-0.5 font-mono tabular-nums text-foreground">
            {round.lockedSide
              ? microUsdcToDisplay(
                  round.claimableMicroUsdc + round.claimedMicroUsdc
                )
              : "—"}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-[0.18em] text-muted">PnL</p>
          <p
            className={cn(
              "mt-0.5 font-mono tabular-nums",
              pnlTone
            )}
          >
            {round.lockedSide ? formatSignedMicroUsdc(pnlMicro) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SpotrProfileShell({ config, initialData }: SpotrShellProps) {
  const state = useSpotrDashboard(config, initialData);
  const vault = useVaultBalance(state.walletAddress ?? null);

  return (
    <NarrowPageShell notice={state.notice}>
      {!state.walletAddress ? (
        <SurfaceCard>
          <SectionHeading
            eyebrow="Profile"
            title="Connect a wallet to open your SPOTR ledger."
            description="Vault balance and session history load once a wallet is connected."
          />
        </SurfaceCard>
      ) : !state.profile ? (
        <SurfaceCard>
          <SectionHeading
            eyebrow="Profile"
            title="No sessions yet."
            description="Join a session to start building your SPOTR ledger."
          />
        </SurfaceCard>
      ) : (
        <div className="space-y-4">
          <SurfaceCard>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                  Vault
                </p>
                <p className="font-mono text-xs tabular-nums break-all text-muted">
                  {state.profile.walletAddress}
                </p>
              </div>
              {vault.microUsdc === null && vault.activeSessions === null ? (
                <div className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-4 text-sm text-muted">
                  Vault not initialized. It opens the first time this wallet
                  joins a session.
                </div>
              ) : (
                <>
                  <div className="rounded-[1rem] border border-primary/25 bg-primary/10 p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                      Balance
                    </p>
                    <p className="mt-3 font-mono text-[2.4rem] font-semibold tabular-nums leading-none text-foreground">
                      {microUsdcToDisplay(Number(vault.microUsdc ?? 0n))}
                      <span className="ml-2 text-base font-medium text-muted">
                        USDC
                      </span>
                    </p>
                  </div>
                  <div className="grid gap-3 grid-cols-2">
                    <LedgerPill
                      label="Active sessions"
                      value={String(vault.activeSessions ?? 0)}
                    />
                    <LedgerPill
                      label="Withdraw"
                      value={
                        (vault.activeSessions ?? 0) > 0 ? "Locked" : "Available"
                      }
                      tone={(vault.activeSessions ?? 0) > 0 ? "accent" : undefined}
                    />
                  </div>
                </>
              )}
            </div>
          </SurfaceCard>

          <SessionsPlayedCard walletAddress={state.profile.walletAddress} />
        </div>
      )}
    </NarrowPageShell>
  );
}

// ─── /play ──────────────────────────────────────────────────────────────────

export function SpotrSessionsListShell({ config, initialData }: SpotrShellProps) {
  const [allSessions, setAllSessions] = useState<AdminSessionCard[]>(() =>
    (initialData.availableSessions ?? []).filter(
      (s) => s.status === "pending" || s.status === "live"
    )
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialData.admin.nextSessionsCursor ?? null
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  async function loadMore() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch(
        `/api/play/sessions?cursor=${encodeURIComponent(nextCursor)}`
      );
      const data = (await response.json()) as {
        items: AdminSessionCard[];
        nextCursor: string | null;
      };
      setAllSessions((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch {
      // silently ignore — user can retry by clicking again
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <NarrowPageShell notice={null}>
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
          Available sessions
        </p>
        <h2 className="mt-1 text-[22px] font-bold text-foreground">Browse sessions</h2>
      </div>

      {allSessions.length === 0 ? (
        <SurfaceCard>
          <p className="text-center text-sm text-muted">No sessions open right now. Check back soon.</p>
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {allSessions.map((session) => (
            <Link key={session.id} href={`/play/${session.id}`} className="block">
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 transition hover:border-white/20 hover:bg-white/8">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{session.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {new Date(session.startsAtIso).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {session.walletsJoined} joined
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      session.status === "live"
                        ? "bg-success/20 text-success"
                        : "bg-primary/20 text-primary"
                    )}
                  >
                    {session.status === "live" ? "Live" : "Open"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted">Free entry · wager per round</span>
                  <span className="text-xs font-semibold text-primary">Join →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isLoadingMore}
            onClick={() => void loadMore()}
          >
            {isLoadingMore ? "Loading…" : "Load more sessions"}
          </Button>
        </div>
      )}
    </NarrowPageShell>
  );
}

// ─── /play/[sessionId] ───────────────────────────────────────────────────────

export function SpotrSessionDetailShell({
  config,
  initialData,
  sessionId,
}: SpotrShellProps & { sessionId: string }) {
  const { wallet, status } = useWallet();
  const { getAccessToken } = useToken();
  const { cluster } = useCluster();
  const walletAddress = wallet?.account.address ?? null;
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    if (token) return { Authorization: `Bearer ${token}` };
    const addr = wallet?.account.address;
    if (cluster === "localnet" && addr) return { "X-Dev-Wallet": String(addr) };
    throw new Error("Privy session expired. Please log in again.");
  }, [getAccessToken, cluster, wallet]);
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [showGame, setShowGame] = useState(
    initialData.session.id === sessionId && initialData.session.joined
  );
  const [joinedData, setJoinedData] = useState<SpotrDashboardPayload | null>(null);
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);

  const session =
    (initialData.availableSessions ?? []).find((s) => s.id === sessionId) ??
    initialData.admin.sessionHistory.find((s) => s.id === sessionId) ??
    null;

  // Once the wallet hydrates client-side, re-fetch the dashboard scoped to
  // this session so we can skip the join CTA if the wallet is already a
  // participant. The SSR pass has no wallet, so it always returns
  // joined: false.
  useEffect(() => {
    if (!walletAddress || showGame) return;
    let cancelled = false;
    setIsCheckingMembership(true);
    fetch(
      `/api/bootstrap?wallet=${encodeURIComponent(walletAddress)}&session=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    )
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<SpotrDashboardPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        if (payload.session.id === sessionId && payload.session.joined) {
          setJoinedData(payload);
          setShowGame(true);
        }
      })
      .catch(() => {
        // membership check is best-effort; if it fails, we just show the join CTA
      })
      .finally(() => {
        if (!cancelled) setIsCheckingMembership(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, sessionId, showGame]);

  const alreadyJoined =
    initialData.session.id === sessionId && initialData.session.joined;

  if (showGame) {
    return <SpotrShell config={config} initialData={joinedData ?? initialData} />;
  }

  const isConnected = status === "connected" && !!walletAddress;

  const handleJoin = () => {
    if (!walletAddress) {
      setNotice({ tone: "error", message: "Connect a wallet before joining." });
      return;
    }
    if (!session?.chainSessionNumber) {
      setNotice({ tone: "error", message: "This session is not yet deployed on-chain." });
      return;
    }

    startTransition(async () => {
      try {
        setNotice({ tone: "info", message: "Joining session…" });
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/session/join", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ referrerWallet: null, sessionId }),
        });
        const body = (await response.json()) as
          | (SpotrDashboardPayload & { error?: undefined })
          | { error: string; needed?: string; have?: string };
        if (!response.ok || "error" in body) {
          const err = "error" in body ? body.error : "Join failed.";
          if (err === INSUFFICIENT_VAULT_ERROR && "needed" in body) {
            const needed = (Number(body.needed ?? 0) / 1_000_000).toFixed(2);
            const have = (Number(body.have ?? 0) / 1_000_000).toFixed(2);
            const msg = `Need ${needed} USDC to join (you have ${have}). Top up at /airdrop.`;
            setNotice({ tone: "error", message: msg });
            toast.error(msg, {
              action: { label: "Top up", onClick: () => window.open("/airdrop", "_self") },
              duration: 8000,
            });
            return;
          }
          throw new Error(err);
        }
        setJoinedData(body);
        toast.success("Session joined.");
        setShowGame(true);
      } catch (error) {
        console.error("[SPOTR] session detail join failed:", error);
        const { rejected, message } = classifyTxError(error);
        setNotice({ tone: rejected ? "info" : "error", message });
        if (rejected) toast(message);
        else toast.error(message);
      }
    });
  };

  if (!session) {
    return (
      <NarrowPageShell notice={null}>
        <SurfaceCard>
          <p className="text-center text-sm text-muted">Session not found.</p>
          <div className="mt-4 flex justify-center">
            <Link href="/play" className="text-xs text-primary hover:underline">
              ← Back to sessions
            </Link>
          </div>
        </SurfaceCard>
      </NarrowPageShell>
    );
  }

  const startDate = new Date(session.startsAtIso);
  const endDate = new Date(session.endsAtIso);
  const nowMs = Date.now();
  const hasStarted = nowMs >= startDate.getTime();
  const hasEnded = nowMs >= endDate.getTime();

  return (
    <NarrowPageShell notice={notice}>
      <div className="mb-2">
        <Link href="/play" className="text-[11px] text-muted hover:text-foreground transition">
          ← Sessions
        </Link>
      </div>

      <SurfaceCard>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">{session.title}</h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              session.status === "live"
                ? "bg-success/20 text-success"
                : "bg-primary/20 text-primary"
            )}
          >
            {session.status === "live" ? "Live" : "Open"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Wallets</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{session.walletsJoined}</p>
          </div>
          <div className="rounded-xl bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Entry</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">Free</p>
          </div>
          <div className="col-span-2 rounded-xl bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Window</p>
            <p className="mt-0.5 text-xs text-foreground">
              {startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
              {startDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              {" – "}
              {endDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      </SurfaceCard>

      {alreadyJoined ? (
        <SurfaceCard>
          <p className="text-sm font-semibold text-success">You&apos;re already in this session.</p>
          <div className="mt-3">
            <Button type="button" variant="gold" size="block" onClick={() => setShowGame(true)}>
              Go to live game →
            </Button>
          </div>
        </SurfaceCard>
      ) : session.status === "completed" || hasEnded ? (
        <SurfaceCard>
          <p className="mb-3 text-sm text-muted">This session has ended.</p>
          <Link
            href={`/play/${sessionId}/recap`}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-[0.1em] text-black transition hover:bg-primary/90"
          >
            View Recap →
          </Link>
        </SurfaceCard>
      ) : !hasStarted ? (
        <SurfaceCard>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
            Not open yet
          </p>
          <p className="text-sm text-foreground">
            Joining opens at{" "}
            {startDate.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </p>
          <div className="mt-4">
            <Button type="button" variant="gold" size="block" disabled>
              Session hasn&apos;t started
            </Button>
          </div>
        </SurfaceCard>
      ) : !isConnected ? (
        <SurfaceCard>
          <p className="mb-3 text-sm text-muted">Connect a wallet to join this session.</p>
          <WalletButton />
        </SurfaceCard>
      ) : isCheckingMembership ? (
        <SurfaceCard>
          <p className="text-sm text-muted">Checking your participation…</p>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">Ready to join</p>
          <p className="text-sm text-foreground">
            Join free — wager USDC per round when you play.
          </p>
          <div className="mt-4">
            <Button
              type="button"
              variant="gold"
              size="block"
              disabled={isPending || !session.chainSessionNumber}
              onClick={handleJoin}
            >
              {isPending ? "Registering on Solana…" : "Join Session"}
            </Button>
          </div>
          {!session.chainSessionNumber && (
            <p className="mt-2 text-[11px] text-muted">Session not yet deployed on-chain.</p>
          )}
        </SurfaceCard>
      )}
    </NarrowPageShell>
  );
}

export function SessionResultsBody({
  results,
  showBackLink = true,
}: {
  results: SessionPublicResults;
  showBackLink?: boolean;
}) {
  const statusLabel =
    results.status === "completed"
      ? "Ended"
      : results.status === "live"
        ? "Live"
        : results.status === "expired"
          ? "Expired"
          : "Pending";
  const statusColor =
    results.status === "completed" || results.status === "expired"
      ? "bg-white/10 text-white/60"
      : "bg-success/20 text-success";
  const totalUsdc = (results.totalEscrowLamports / 1_000_000).toFixed(2);

  return (
    <>
      {showBackLink ? (
        <div className="mb-2">
          <Link href="/play" className="text-[11px] text-muted hover:text-foreground transition">
            ← Sessions
          </Link>
        </div>
      ) : null}

      <SurfaceCard>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">{results.title}</h2>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", statusColor)}>
            {statusLabel}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Players</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{results.walletsJoined}</p>
          </div>
          <div className="rounded-xl bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Total wagered</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{totalUsdc} USDC</p>
          </div>
        </div>
      </SurfaceCard>

      <div className="mt-1 flex flex-col gap-3">
        {results.rounds.map((round) => {
          const isPending = round.status === "upcoming" || round.status === "open";
          const isSkipped = round.status === "skipped";
          const totalEntries = round.sideATotalEntries + round.sideBTotalEntries;

          return (
            <SurfaceCard key={round.index}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                    Round {round.index + 1}
                  </span>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white/60">
                    {round.category}
                  </span>
                </div>
                {isPending ? (
                  <span className="text-[10px] text-white/40">Not yet settled</span>
                ) : isSkipped ? (
                  <span className="text-[10px] text-white/40">Skipped</span>
                ) : round.winningSide ? (
                  <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold text-success">
                    Side {round.winningSide} won
                  </span>
                ) : (
                  <span className="text-[10px] text-white/40">{totalEntries === 0 ? "No entries" : "Settled"}</span>
                )}
              </div>

              <div className={cn("mb-2 rounded-xl p-3", round.winningSide === "A" ? "bg-primary/12 ring-1 ring-primary/30" : "bg-white/5")}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Side A</span>
                  <span className="text-[11px] font-semibold tabular-nums text-foreground/80">
                    {round.sideAPct}% · {round.sideATotalEntries} {round.sideATotalEntries === 1 ? "entry" : "entries"}
                  </span>
                </div>
                <p className="text-[13px] leading-snug text-foreground">{round.sideA}</p>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${round.sideAPct}%` }} />
                </div>
              </div>

              <div className={cn("rounded-xl p-3", round.winningSide === "B" ? "bg-[#f5c800]/10 ring-1 ring-[#f5c800]/30" : "bg-white/5")}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#f5c800]">Side B</span>
                  <span className="text-[11px] font-semibold tabular-nums text-foreground/80">
                    {round.sideBPct}% · {round.sideBTotalEntries} {round.sideBTotalEntries === 1 ? "entry" : "entries"}
                  </span>
                </div>
                <p className="text-[13px] leading-snug text-foreground">{round.sideB}</p>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#f5c800]" style={{ width: `${round.sideBPct}%` }} />
                </div>
              </div>
            </SurfaceCard>
          );
        })}
      </div>
    </>
  );
}

export function SpotrSessionResultsShell({
  results,
}: {
  results: SessionPublicResults;
}) {
  return (
    <NarrowPageShell notice={null}>
      <SessionResultsBody results={results} />
    </NarrowPageShell>
  );
}
