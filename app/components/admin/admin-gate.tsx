"use client";

import type { ReactNode } from "react";
import { useWallet } from "../../lib/wallet/context";
import { WalletButton } from "../wallet-button";
import { SurfaceCard } from "../spotr-ui/system";

type AdminGateProps = {
  adminWallets: readonly string[];
  children: ReactNode;
};

export function AdminGate({ adminWallets, children }: AdminGateProps) {
  const { wallet, status } = useWallet();
  const walletAddress = wallet?.account.address ?? null;
  const allowed = walletAddress
    ? adminWallets.includes(walletAddress)
    : false;

  if (!walletAddress) {
    return (
      <div className="stage-canvas min-h-[100dvh]">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-[680px] items-center px-6 py-10">
          <SurfaceCard className="w-full">
            <div className="space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
                SPOTR · admin
              </p>
              <h1 className="font-display text-[1.6rem] font-extrabold tracking-[-0.04em] text-foreground">
                Connect an admin wallet
              </h1>
              <p className="text-sm leading-relaxed text-muted">
                The admin dashboard requires a wallet listed in
                {" "}
                <code className="font-mono text-xs text-primary">
                  SPOTR_ADMIN_WALLETS
                </code>
                . Connect to continue.
              </p>
              <WalletButton />
              {status === "connecting" ? (
                <p className="text-xs text-muted">Connecting…</p>
              ) : null}
            </div>
          </SurfaceCard>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="stage-canvas min-h-[100dvh]">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-[680px] items-center px-6 py-10">
          <SurfaceCard className="w-full">
            <div className="space-y-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-destructive">
                Restricted
              </p>
              <h1 className="font-display text-[1.6rem] font-extrabold tracking-[-0.04em] text-foreground">
                This wallet is not an admin
              </h1>
              <p className="text-sm leading-relaxed text-muted">
                Connected as
                {" "}
                <code className="font-mono text-xs text-primary">
                  {walletAddress}
                </code>
                . Switch to a wallet listed in
                {" "}
                <code className="font-mono text-xs text-primary">
                  SPOTR_ADMIN_WALLETS
                </code>
                {" "}
                to manage the protocol.
              </p>
              <WalletButton />
            </div>
          </SurfaceCard>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
