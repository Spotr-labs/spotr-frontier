"use client";

import { Menu } from "lucide-react";
import { Button } from "../ui/button";
import { WalletButton } from "../wallet-button";
import { useCluster, CLUSTERS } from "../cluster-context";
import { useWallet } from "../../lib/wallet/context";
import { cn } from "../../lib/utils";

type AdminTopbarProps = {
  onOpenDrawer: () => void;
};

export function AdminTopbar({ onOpenDrawer }: AdminTopbarProps) {
  const { cluster, setCluster } = useCluster();
  const { wallet } = useWallet();
  const canSign = Boolean(wallet?.signMessage);
  return (
    <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#080d1c]/80 px-4 py-3 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className="lg:hidden"
          onClick={onOpenDrawer}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value as typeof CLUSTERS[number])}
          className={cn(
            "cursor-pointer rounded-full border bg-transparent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] outline-none",
            cluster === "mainnet"
              ? "border-success/40 bg-success/10 text-success"
              : "border-primary/40 bg-primary/10 text-primary"
          )}
        >
          {CLUSTERS.map((c) => (
            <option key={c} value={c} className="bg-[#080d1c] normal-case tracking-normal">
              {c}
            </option>
          ))}
        </select>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]",
            canSign
              ? "border-success/35 bg-success/10 text-success"
              : "border-destructive/35 bg-destructive/10 text-destructive"
          )}
        >
          {canSign ? "Write access" : "Read-only"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <WalletButton />
      </div>
    </header>
  );
}
