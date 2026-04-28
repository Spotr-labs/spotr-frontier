"use client";

import Image from "next/image";
import { useState, useRef, useEffect, useCallback } from "react";
import { useWallet } from "../lib/wallet/context";
import { useUsdcBalance } from "../lib/hooks/use-usdc-balance";
import { microUsdcToString } from "../lib/usdc";
import { ellipsify } from "../lib/explorer";
import { cn } from "../lib/utils";
import { useCluster, CLUSTERS } from "./cluster-context";
import {
  EPHEMERAL_ID,
  prepareEphemeralWallet,
  discardEphemeralWallet,
  getSavedWalletAddress,
} from "../lib/wallet/ephemeral";
import { PRIVY_ID } from "../lib/wallet/privy-bridge";

type CreateStep = "idle" | "confirming";

function ClusterSelector({
  cluster,
  setCluster,
}: {
  cluster: string;
  setCluster: (c: typeof CLUSTERS[number]) => void;
}) {
  return (
    <div className="mt-3">
      <div className="border-t border-border-low" />
      <p className="mb-2 mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
        Network
      </p>
      <div className="flex gap-1.5">
        {CLUSTERS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCluster(c)}
            className={cn(
              "flex-1 rounded-xl py-2 text-[11px] font-semibold capitalize tracking-[0.08em] transition",
              cluster === c
                ? "bg-primary text-primary-foreground"
                : "border border-border-low text-muted hover:text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WalletButton() {
  const { connectors, connect, cancelConnect, disconnect, wallet, status, error } =
    useWallet();

  const { cluster, setCluster, getExplorerUrl } = useCluster();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("idle");
  const [pendingAddress, setPendingAddress] = useState<string>("");
  const [isPreparing, setIsPreparing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const address = wallet?.account.address;
  const balance = useUsdcBalance(address);

  const open = () => setIsOpen(true);
  const close = useCallback(() => {
    setIsOpen(false);
    setCreateStep("idle");
    setPendingAddress("");
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [close, isOpen]);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreateWallet = async (generateNew = false) => {
    if (generateNew) discardEphemeralWallet();
    setIsPreparing(true);
    try {
      const addr = await prepareEphemeralWallet();
      setPendingAddress(addr);
      setCreateStep("confirming");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleConfirmEphemeral = async () => {
    try {
      await connect(EPHEMERAL_ID);
      close();
    } catch {
      // error surfaced via context error state
    }
  };

  const privyConnector = connectors.find((c) => c.id === PRIVY_ID);
  const extensionConnectors = connectors.filter(
    (c) => c.id !== EPHEMERAL_ID && c.id !== PRIVY_ID
  );
  const savedAddress = getSavedWalletAddress();

  const handleConnectPrivy = async () => {
    cancelConnect();
    try {
      await connect(PRIVY_ID);
      close();
    } catch {
      // error surfaced via context error state
    }
  };

  if (status !== "connected") {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => (isOpen ? close() : open())}
          className="focus-ring inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-primary/30 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_12px_30px_-16px_rgba(245,200,0,0.9)] transition hover:bg-primary/90"
        >
          <span className="inline-flex h-2 w-2 rounded-full bg-primary-foreground/80" />
          {status === "connecting" ? "Connecting..." : "Connect wallet"}
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full z-50 mt-3 w-72 rounded-3xl border border-border bg-popover p-4 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)]">

            {createStep === "confirming" ? (
              /* ── Create-wallet confirmation step ── */
              <div>
                <button
                  onClick={() => setCreateStep("idle")}
                  className="mb-3 flex items-center gap-1 text-xs text-muted transition hover:text-foreground"
                >
                  ← Back
                </button>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Your browser wallet
                </p>
                <div className="my-3 rounded-2xl border border-border-low bg-secondary px-3 py-3">
                  <p className="break-all font-mono text-[11px] leading-relaxed">
                    {pendingAddress}
                  </p>
                </div>
                <p className="mb-4 text-[11px] leading-relaxed text-muted">
                  This wallet lives in your browser. Copy the address above and
                  save it — you cannot recover it if you clear your browser data.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleConfirmEphemeral}
                    disabled={status === "connecting"}
                    className="focus-ring min-h-11 w-full cursor-pointer rounded-2xl bg-primary px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    {status === "connecting" ? "Connecting…" : "Connect"}
                  </button>
                  <button
                    onClick={() => handleCreateWallet(true)}
                    disabled={isPreparing || status === "connecting"}
                    className="focus-ring cursor-pointer rounded-2xl border border-border-low px-3 py-2 text-[11px] text-muted transition hover:text-foreground disabled:opacity-50"
                  >
                    Generate a different address
                  </button>
                </div>
                {(status === "error") && error != null && (
                  <p className="mt-3 text-xs text-destructive">
                    {error instanceof Error ? error.message : String(error)}
                  </p>
                )}
              </div>
            ) : (
              /* ── Wallet list step ── */
              <>
                {privyConnector && (
                  <>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Sign in
                    </p>
                    <button
                      onClick={handleConnectPrivy}
                      className="focus-ring flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl bg-primary px-3 py-3 text-left text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      <span>Email, Google, X, or wallet</span>
                      <span aria-hidden="true">→</span>
                    </button>
                    <div className="my-3 border-t border-border-low" />
                  </>
                )}
                {extensionConnectors.length > 0 && (
                  <>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Browser extension
                    </p>
                    <div className="space-y-1">
                      {extensionConnectors.map((connector) => (
                        <button
                          key={connector.id}
                          onClick={async () => {
                            cancelConnect();
                            try {
                              await connect(connector.id);
                              close();
                            } catch {
                              // error shown via context error state
                            }
                          }}
                          className="focus-ring flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition hover:bg-secondary disabled:pointer-events-none disabled:opacity-50"
                        >
                          {connector.icon && (
                            <Image
                              src={connector.icon}
                              alt=""
                              width={20}
                              height={20}
                              unoptimized
                              className="h-5 w-5 rounded"
                            />
                          )}
                          <span>{connector.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="my-3 border-t border-border-low" />
                  </>
                )}

                {/* Ephemeral / no-extension option */}
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  {extensionConnectors.length === 0
                    ? "Choose a wallet"
                    : "No extension?"}
                </p>
                {savedAddress ? (
                  <button
                    onClick={() => handleCreateWallet(false)}
                    disabled={isPreparing || status === "connecting"}
                    className="focus-ring flex min-h-11 w-full cursor-pointer flex-col items-start rounded-2xl border border-border-low px-3 py-3 text-left transition hover:bg-secondary disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">Use saved browser wallet</span>
                    <span className="mt-0.5 font-mono text-[11px] text-muted">
                      {ellipsify(savedAddress, 6)}
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleCreateWallet(false)}
                    disabled={isPreparing || status === "connecting"}
                    className="focus-ring flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-border px-3 py-3 text-left text-sm font-medium text-muted transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded text-base leading-none">
                      +
                    </span>
                    <span>{isPreparing ? "Generating…" : "Create new wallet"}</span>
                  </button>
                )}

                {status === "connecting" && (
                  <div className="mt-3 space-y-2 rounded-2xl border border-primary/40 bg-primary/10 p-3">
                    <p className="text-xs font-semibold text-primary">
                      Waiting for wallet approval…
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted">
                      Click your wallet&apos;s extension icon in the browser
                      toolbar if no popup appeared.
                    </p>
                    <button
                      onClick={cancelConnect}
                      className="focus-ring min-h-9 w-full cursor-pointer rounded-xl border border-border-low bg-card px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {status === "error" && error != null && (
                  <div className="mt-3 space-y-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3">
                    <p className="text-xs text-destructive">
                      {error instanceof Error ? error.message : String(error)}
                    </p>
                    <button
                      onClick={cancelConnect}
                      className="focus-ring min-h-9 w-full cursor-pointer rounded-xl border border-border-low bg-card px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <ClusterSelector cluster={cluster} setCluster={setCluster} />
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (isOpen ? close() : open())}
        className="focus-ring flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-2 text-sm font-medium backdrop-blur transition hover:bg-secondary"
      >
        <span className="h-2 w-2 rounded-full bg-success" />
        <span className="font-mono tabular-nums">{ellipsify(address!, 4)}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-3 w-80 rounded-3xl border border-border bg-popover p-4 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)]">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
              Wallet
            </p>
            <p className="mt-2 text-lg font-bold tabular-nums">
              {balance.microUsdc != null
                ? microUsdcToString(balance.microUsdc)
                : "—"}{" "}
              <span className="text-sm font-normal text-muted">USDC</span>
            </p>
          </div>

          <div className="mb-4 rounded-2xl border border-border-low bg-secondary px-3 py-3">
            <p className="break-all font-mono text-xs">{address}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="focus-ring flex-1 cursor-pointer rounded-2xl border border-border-low bg-card px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary"
            >
              {copied ? "Copied!" : "Copy address"}
            </button>
            <a
              href={getExplorerUrl(`/address/${address}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring flex-1 rounded-2xl border border-border-low bg-card px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.18em] text-foreground transition hover:bg-secondary"
            >
              Explorer
            </a>
          </div>

          <ClusterSelector cluster={cluster} setCluster={setCluster} />

          <button
            onClick={() => {
              disconnect();
              close();
            }}
            className="focus-ring mt-2 min-h-11 w-full cursor-pointer rounded-2xl border border-destructive/30 bg-card px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-destructive transition hover:bg-destructive/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
