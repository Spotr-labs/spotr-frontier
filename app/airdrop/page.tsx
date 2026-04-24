"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "../lib/wallet/context";
import { useCluster } from "../components/cluster-context";
import { WalletButton } from "../components/wallet-button";
import { publicSpotrConfig } from "../lib/spotr-config/public";

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
    <div className="rounded-[1.75rem] border border-white/8 bg-card/80 p-5 backdrop-blur-xl">
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

      <div className="mb-3 flex items-center gap-2">
        <input
          type="number"
          min={0.001}
          max={max}
          step={symbol === "SOL" ? 0.5 : 100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-28 rounded-xl border border-white/10 bg-secondary/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <span className="text-xs text-muted">{symbol} (max {max})</span>
      </div>

      <button
        disabled={disabled || status === "pending"}
        onClick={() => onRequest(amount)}
        className="inline-flex min-h-10 items-center rounded-full border border-primary/40 bg-primary/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary transition-[background-color,opacity] duration-150 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === "pending" ? "Requesting…" : `Request ${symbol}`}
      </button>

      {status === "ok" && sig && (
        <p className="mt-3 break-all text-[11px] text-primary">
          ✓ Signature: <span className="font-mono">{sig.slice(0, 20)}…</span>
        </p>
      )}
      {status === "err" && err && (
        <p className="mt-3 text-[11px] text-destructive">{err}</p>
      )}
    </div>
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
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(circle at 20% 0%, rgba(245,200,0,0.10), transparent 22%)",
            "radial-gradient(circle at 78% 10%, rgba(27,79,140,0.16), transparent 22%)",
          ].join(", "),
        }}
      />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-4 pb-8 pt-4 sm:px-6">
        {/* header */}
        <header className="mb-6 flex items-center justify-between gap-3 rounded-[1.35rem] border border-white/8 bg-black/18 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-black">
              ◎
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
                {publicSpotrConfig.seasonLabel}
              </p>
              <p className="text-sm font-semibold text-foreground">Dev Faucet</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">
              {(["/" , "/profile", "/admin"] as const).map((href) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-secondary/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-foreground transition hover:border-primary/40 hover:bg-secondary/80"
                >
                  {href === "/" ? "Play" : href.slice(1).charAt(0).toUpperCase() + href.slice(2)}
                </Link>
              ))}
            </div>
            <WalletButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl space-y-6">
          {/* banner */}
          <div className="rounded-[1.75rem] border border-primary/20 bg-primary/8 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
              Localnet only
            </p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">Dev Faucet</h1>
            <p className="mt-1 text-xs text-muted">
              Request SOL and mock USDC for local testing. Only works when running{" "}
              <code className="rounded bg-white/8 px-1 py-0.5 font-mono text-[11px]">
                npm run dev:local
              </code>
              .
            </p>
          </div>

          {/* cluster guard */}
          {!isLocalnet && (
            <div className="rounded-[1.5rem] border border-destructive/25 bg-destructive/10 px-5 py-4">
              <p className="text-sm font-medium text-destructive">
                Faucet is disabled on <strong>{cluster}</strong>. Switch to localnet to use it.
              </p>
            </div>
          )}

          {/* wallet guard */}
          {isLocalnet && !connected && (
            <div className="rounded-[1.5rem] border border-white/8 bg-card/60 px-5 py-6 text-center">
              <p className="mb-4 text-sm text-muted">Connect a wallet to request tokens.</p>
              <WalletButton />
            </div>
          )}

          {/* mint address info */}
          {isLocalnet && usdcMint && (
            <div className="rounded-[1.35rem] border border-white/8 bg-secondary/30 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
                Mock USDC mint
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-foreground">
                {usdcMint}
              </p>
            </div>
          )}

          {/* airdrop cards */}
          {isLocalnet && connected && (
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
          )}

          {/* wallet address */}
          {connected && (
            <div className="rounded-[1.35rem] border border-white/8 bg-secondary/30 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
                Receiving wallet
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-foreground">
                {walletAddr}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
