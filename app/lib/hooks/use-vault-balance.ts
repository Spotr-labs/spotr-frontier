"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { address } from "@solana/kit";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";
import { findVaultTokensPda } from "../../generated/spotr/pdas/vaultTokens";
import { fetchMaybeUserVault } from "../../generated/spotr/accounts/userVault";
import { findVaultPda } from "../../generated/spotr/pdas/vault";

export type VaultBalance = {
  microUsdc: bigint | null;
  activeSessions: number | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
};

export function useVaultBalance(walletAddress?: string | null): VaultBalance {
  const { cluster } = useCluster();
  const client = useSolanaClient();

  const { data, isLoading, error, mutate } = useSWR(
    walletAddress ? (["vault-balance", cluster, walletAddress] as const) : null,
    async ([, , addr]) => {
      const owner = address(addr);
      const [vaultPda] = await findVaultPda({ player: owner });
      const [vaultTokensPda] = await findVaultTokensPda({ player: owner });

      const [tokenResult, vaultResult] = await Promise.all([
        client.rpc
          .getTokenAccountBalance(vaultTokensPda)
          .send()
          .then((r) => BigInt(r.value.amount))
          .catch(() => null),
        fetchMaybeUserVault(client.rpc, vaultPda).catch(() => null),
      ]);

      return {
        microUsdc: tokenResult,
        activeSessions:
          vaultResult && vaultResult.exists
            ? Number(vaultResult.data.activeSessions)
            : null,
      };
    },
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );

  useEffect(() => {
    if (!walletAddress) return;
    const abortController = new AbortController();

    const subscribe = async () => {
      try {
        const owner = address(walletAddress);
        const [vaultTokensPda] = await findVaultTokensPda({ player: owner });
        const notifications = await client.rpcSubscriptions
          .accountNotifications(vaultTokensPda, { commitment: "confirmed" })
          .subscribe({ abortSignal: abortController.signal });

        for await (const _notification of notifications) {
          void mutate();
        }
      } catch {
        // SWR polling and focus revalidation remain the fallback.
      }
    };

    void subscribe();
    return () => abortController.abort();
  }, [walletAddress, client, mutate]);

  return {
    microUsdc: data?.microUsdc ?? null,
    activeSessions: data?.activeSessions ?? null,
    isLoading,
    error,
    mutate,
  };
}
