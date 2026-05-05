"use client";

import { useEffect, useState } from "react";
import { address } from "@solana/kit";
import { useWallet } from "../lib/wallet/context";
import { useCluster } from "../components/cluster-context";
import { WalletButton } from "../components/wallet-button";
import { publicSpotrConfig } from "../lib/spotr-config/public";
import { Button } from "../components/ui/button";
import {
  AppHeader,
  AppPage,
  NoticeBanner,
  SurfaceCard,
} from "../components/spotr-ui/system";
import { useBalance } from "../lib/hooks/use-balance";
import { useUsdcBalance } from "../lib/hooks/use-usdc-balance";
import { useVaultBalance } from "../lib/hooks/use-vault-balance";
import { lamportsToSol } from "../lib/format";
import { microUsdcToDisplay } from "../lib/usdc";

type AirdropStatus = "idle" | "pending" | "ok" | "err";

type AirdropType = "sol" | "usdc" | "usdc-vault";

function useAirdrop(type: AirdropType) {
  const [status, setStatus] = useState<AirdropStatus>("idle");
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const request = async (wallet: string, amount: number) => {
    setStatus("pending");
    setSig(null);
    setErr(null);
    try {
      const res = await fetch("/api/airdrop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, type, amount }),
      });
      const data = (await res.json()) as { signature?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Airdrop failed.");
      setSig(data.signature ?? null);
      setStatus("ok");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus("err");
    }
  };

  return { status, sig, err, request };
}

function AirdropCard({
  label,
  symbol,
  defaultAmount,
  max,
  description,
  disabled,
  onRequest,
  status,
  sig,
  err,
}: {
  label: string;
  symbol: string;
  defaultAmount: number;
  max: number;
  description: string;
  disabled: boolean;
  onRequest: (amount: number) => void;
  status: AirdropStatus;
  sig: string | null;
  err: string | null;
}) {
  const [amount, setAmount] = useState(defaultAmount);

  return (
    <SurfaceCard>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm font-bold text-primary">
          {symbol}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
            Mock token
          </p>
          <p className="text-sm font-semibold text-foreground">{label}</p>
        </div>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted">{description}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0.001}
          max={max}
          step={symbol === "SOL" ? 0.5 : 100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="focus-ring w-full rounded-[1rem] border border-white/12 bg-black/20 px-3 py-2 text-sm text-foreground focus:border-primary/50 sm:w-28"
        />
        <span className="text-xs text-muted">
          {symbol} (max {max})
        </span>
      </div>

      <Button
        type="button"
        variant="gold"
        size="sm"
        disabled={disabled || status === "pending"}
        onClick={() => onRequest(amount)}
      >
        {status === "pending" ? "Requesting…" : `Request ${symbol}`}
      </Button>

      {status === "ok" && sig ? (
        <p className="mt-3 break-all text-[11px] text-success">
          ✓ Signature: <span className="font-mono">{sig.slice(0, 20)}…</span>
        </p>
      ) : null}
      {status === "err" && err ? (
        <p className="mt-3 text-[11px] text-destructive">{err}</p>
      ) : null}
    </SurfaceCard>
  );
}

export default function AirdropPage() {
  const { wallet, status: walletStatus } = useWallet();
  const { cluster } = useCluster();
  const sol = useAirdrop("sol");
  const usdc = useAirdrop("usdc");
  const usdcVault = useAirdrop("usdc-vault");

  const walletAddr = wallet?.account.address ?? null;
  const isFaucetEnabled = cluster !== "mainnet";
  const connected = walletStatus === "connected" && !!walletAddr;
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;

  const solBalance = useBalance(walletAddr ? address(walletAddr) : undefined);
  const usdcBalance = useUsdcBalance(walletAddr);
  const vault = useVaultBalance(walletAddr);

  const vaultMissing =
    walletAddr != null &&
    !vault.isLoading &&
    vault.microUsdc === null &&
    vault.activeSessions === null;

  const [initStatus, setInitStatus] = useState<AirdropStatus>("idle");
  const [initSig, setInitSig] = useState<string | null>(null);
  const [initErr, setInitErr] = useState<string | null>(null);

  useEffect(() => {
    if (sol.status === "ok") void solBalance.mutate();
  }, [sol.status]);

  useEffect(() => {
    if (usdc.status === "ok") void usdcBalance.mutate();
  }, [usdc.status]);

  useEffect(() => {
    if (usdcVault.status !== "ok") return;
    void vault.mutate();
    // Retry after a short delay in case surfpool hasn't indexed the mint yet.
    const t = setTimeout(() => void vault.mutate(), 1500);
    return () => clearTimeout(t);
  }, [usdcVault.status]);

  const initVault = async (): Promise<boolean> => {
    if (!walletAddr || !usdcMint) return false;
    setInitStatus("pending");
    setInitSig(null);
    setInitErr(null);
    try {
      const res = await fetch("/api/airdrop/init-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr }),
      });
      const data = (await res.json()) as {
        signature?: string;
        alreadyInitialized?: boolean;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Vault init failed.");
      }
      setInitSig(data.signature ?? null);
      setInitStatus("ok");
      await vault.mutate();
      return true;
    } catch (e) {
      setInitErr(e instanceof Error ? e.message : String(e));
      setInitStatus("err");
      return false;
    }
  };

  const requestVaultUsdc = async (amt: number) => {
    if (!walletAddr) return;
    if (vaultMissing) {
      const ok = await initVault();
      if (!ok) return;
    }
    usdcVault.request(walletAddr, amt);
  };

  return (
    <AppPage
      header={
        <AppHeader
          title="Dev Faucet"
          eyebrow={`${publicSpotrConfig.seasonLabel} · Faucet`}
        />
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
            Devnet &amp; Localnet
          </p>
          <h2 className="mt-2 font-display text-[1.5rem] font-extrabold tracking-[-0.03em] text-foreground sm:text-[1.85rem]">
            Dev Faucet
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Request SOL and mock USDC for testing. Available on devnet and localnet.
          </p>
        </SurfaceCard>

        {!isFaucetEnabled ? (
          <NoticeBanner tone="error">
            Faucet is disabled on <strong>{cluster}</strong>.
          </NoticeBanner>
        ) : null}

        {isFaucetEnabled && !connected ? (
          <SurfaceCard className="text-center">
            <p className="mb-4 text-sm text-muted">Connect a wallet to request tokens.</p>
            <div className="flex justify-center">
              <WalletButton />
            </div>
          </SurfaceCard>
        ) : null}

        {connected ? (
          <SurfaceCard>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
              Balances
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
                  SOL
                </p>
                <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {solBalance.isLoading
                    ? "—"
                    : solBalance.lamports != null
                      ? lamportsToSol(Number(solBalance.lamports))
                      : "0.000"}
                </p>
              </div>
              <div className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
                  USDC
                </p>
                <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {usdcBalance.isLoading
                    ? "—"
                    : usdcBalance.microUsdc != null
                      ? microUsdcToDisplay(Number(usdcBalance.microUsdc))
                      : "0.00"}
                </p>
              </div>
              <div className="rounded-[1rem] border border-white/12 bg-black/16 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted">
                  Vault USDC
                </p>
                <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-foreground">
                  {vault.isLoading
                    ? "—"
                    : vault.microUsdc != null
                      ? microUsdcToDisplay(Number(vault.microUsdc))
                      : "—"}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted">
                  {vault.activeSessions != null
                    ? `active sessions: ${vault.activeSessions}`
                    : "—"}
                </p>
              </div>
            </div>
            <div className="mt-4 border-t border-white/8 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
                Receiving wallet
              </p>
              <p className="mt-1 break-all font-mono text-xs text-foreground">{walletAddr}</p>
            </div>
          </SurfaceCard>
        ) : null}

        {isFaucetEnabled && usdcMint ? (
          <SurfaceCard>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
              Mock USDC mint
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{usdcMint}</p>
          </SurfaceCard>
        ) : null}


        {isFaucetEnabled && connected ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <AirdropCard
              label="Solana"
              symbol="SOL"
              defaultAmount={2}
              max={10}
              description="Native SOL for transaction fees and program interactions."
              disabled={!connected}
              onRequest={(amt) => sol.request(walletAddr!, amt)}
              status={sol.status}
              sig={sol.sig}
              err={sol.err}
            />
            <AirdropCard
              label="Mock USDC"
              symbol="USDC"
              defaultAmount={1000}
              max={10000}
              description="SPL token mimicking USDC with 6 decimals. Localnet only — no real value."
              disabled={!connected || !usdcMint}
              onRequest={(amt) => usdc.request(walletAddr!, amt)}
              status={usdc.status}
              sig={usdc.sig}
              err={usdc.err}
            />
            <AirdropCard
              label="Vault USDC"
              symbol="USDC"
              defaultAmount={1000}
              max={10000}
              description="Mint mock USDC straight into your vault. Skips the deposit tx when joining a session."
              disabled={
                !connected ||
                !usdcMint ||
                vault.isLoading ||
                initStatus === "pending"
              }
              onRequest={(amt) => void requestVaultUsdc(amt)}
              status={
                initStatus === "pending"
                  ? "pending"
                  : initStatus === "err"
                    ? "err"
                    : usdcVault.status
              }
              sig={usdcVault.sig}
              err={initStatus === "err" ? initErr : usdcVault.err}
            />
          </div>
        ) : null}
      </div>
    </AppPage>
  );
}
