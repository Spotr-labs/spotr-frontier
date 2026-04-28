"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { address, type Address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";

const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;

export function useUsdcBalance(walletAddress?: string | null) {
  const { cluster } = useCluster();
  const client = useSolanaClient();

  const { data, isLoading, error, mutate } = useSWR(
    walletAddress && USDC_MINT
      ? (["usdc-balance", cluster, walletAddress] as const)
      : null,
    async ([, , addr]) => {
      const mintAddr = address(USDC_MINT!);
      const [ata] = await findAssociatedTokenPda({
        owner: address(addr),
        mint: mintAddr,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      try {
        const result = await client.rpc.getTokenAccountBalance(ata).send();
        return BigInt(result.value.amount);
      } catch {
        return 0n;
      }
    },
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );

  useEffect(() => {
    if (!walletAddress || !USDC_MINT) return;

    const abortController = new AbortController();

    const subscribe = async () => {
      try {
        const mintAddr = address(USDC_MINT!);
        const [ata] = await findAssociatedTokenPda({
          owner: address(walletAddress),
          mint: mintAddr,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const notifications = await client.rpcSubscriptions
          .accountNotifications(ata, { commitment: "confirmed" })
          .subscribe({ abortSignal: abortController.signal });

        for await (const _notification of notifications) {
          void mutate();
        }
      } catch {
        // SWR polling and focus revalidation remain as fallback
      }
    };

    void subscribe();

    return () => {
      abortController.abort();
    };
  }, [walletAddress, client, mutate]);

  if (!USDC_MINT) {
    return { microUsdc: null as bigint | null, isLoading: false, error: null, mutate };
  }

  return {
    microUsdc: (data ?? null) as bigint | null,
    isLoading,
    error,
    mutate,
  };
}
