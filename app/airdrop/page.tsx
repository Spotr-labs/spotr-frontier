"use client";

import { useState } from "react";
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

type AirdropStatus = "idle" | "pending" | "ok" | "err";

function useAirdrop(type: "sol" | "usdc") {
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

  const walletAddr = wallet?.account.address ?? null;
  const isLocalnet = cluster === "localnet";
  const connected = walletStatus === "connected" && !!walletAddr;
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;

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
            Localnet only
          </p>
          <h2 className="mt-2 font-display text-[1.5rem] font-extrabold tracking-[-0.03em] text-foreground sm:text-[1.85rem]">
            Dev Faucet
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Request SOL and mock USDC for local testing. Only works when running{" "}
            <code className="rounded bg-white/8 px-1 py-0.5 font-mono text-[11px]">
              npm run dev:local
            </code>
            .
          </p>
        </SurfaceCard>

        {!isLocalnet ? (
          <NoticeBanner tone="error">
            Faucet is disabled on <strong>{cluster}</strong>. Switch to localnet to use it.
          </NoticeBanner>
        ) : null}

        {isLocalnet && !connected ? (
          <SurfaceCard className="text-center">
            <p className="mb-4 text-sm text-muted">Connect a wallet to request tokens.</p>
            <div className="flex justify-center">
              <WalletButton />
            </div>
          </SurfaceCard>
        ) : null}

        {isLocalnet && usdcMint ? (
          <SurfaceCard>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
              Mock USDC mint
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{usdcMint}</p>
          </SurfaceCard>
        ) : null}

        {isLocalnet && connected ? (
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        ) : null}

        {connected ? (
          <SurfaceCard>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
              Receiving wallet
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{walletAddr}</p>
          </SurfaceCard>
        ) : null}
      </div>
    </AppPage>
  );
}
