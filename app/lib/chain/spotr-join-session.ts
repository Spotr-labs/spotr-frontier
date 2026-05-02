"use client";

import { address, type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getDepositToVaultInstructionAsync,
  getInitUserVaultInstructionAsync,
  getJoinSessionInstructionAsync,
} from "../../generated/spotr/instructions";
import { findPlayerSessionPda } from "../../generated/spotr/pdas/playerSession";
import { findDepositToVaultVaultPda } from "../../generated/spotr/pdas/depositToVaultVault";
import { findDepositToVaultVaultTokensPda } from "../../generated/spotr/pdas/depositToVaultVaultTokens";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { findSpotrSessionPda } from "./session-pda";
import type { ClusterMoniker } from "../solana-client";

export type JoinSessionChainResult = {
  signature: string;
  sessionAddress: Address;
};

export async function accountExists(
  cluster: ClusterMoniker,
  pda: Address
): Promise<boolean> {
  const response = await fetch(getClusterUrl(cluster), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [String(pda), { encoding: "base64" }],
    }),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const json = (await response.json()) as {
    result?: { value: unknown } | null;
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);
  return json.result?.value != null;
}

export async function getTokenBalance(
  cluster: ClusterMoniker,
  tokenAccount: Address
): Promise<bigint> {
  const response = await fetch(getClusterUrl(cluster), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountBalance",
      params: [String(tokenAccount)],
    }),
    cache: "no-store",
  });
  if (!response.ok) return 0n;
  const json = (await response.json()) as {
    result?: { value?: { amount?: string } } | null;
    error?: unknown;
  };
  if (json.error || !json.result?.value?.amount) return 0n;
  return BigInt(json.result.value.amount);
}

function getUsdcMint(): Address {
  const raw = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_USDC_MINT_ADDRESS is not set; cannot join session without USDC mint."
    );
  }
  return address(raw);
}

function makeTxClient(cluster: ClusterMoniker, payer: TransactionSigner) {
  return createClient({
    url: getClusterUrl(cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(cluster),
    payer,
  });
}

/**
 * Ensures the player's UserVault is ready (initialized + funded) then
 * submits the join_session instruction — all in a single atomic transaction.
 *
 * Instructions batched (conditionally):
 *   ix 0 (if needed): init_user_vault
 *   ix 1 (if needed): deposit_to_vault
 *   ix N:             join_session  ← signature returned to backend
 *
 * If the PlayerSession PDA already exists the whole flow is skipped and
 * the "already-joined" sentinel is returned.
 */
export async function submitJoinSessionOnChain(params: {
  cluster: ClusterMoniker;
  sessionNumber: bigint;
  player: TransactionSigner;
  buyInAmount: bigint;
}): Promise<JoinSessionChainResult> {
  const usdcMint = getUsdcMint();
  const txClient = makeTxClient(params.cluster, params.player);
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);

  const [playerSessionPda] = await findPlayerSessionPda({
    session: sessionAddress,
    player: params.player.address,
  });

  console.log("[SPOTR] join: sessionAddress =", String(sessionAddress));
  console.log("[SPOTR] join: playerSessionPda =", String(playerSessionPda));

  const alreadyJoined = await accountExists(params.cluster, playerSessionPda);
  console.log("[SPOTR] join: playerSession already on-chain =", alreadyJoined);
  if (alreadyJoined) {
    return { signature: "already-joined", sessionAddress };
  }

  const sessionExists = await accountExists(params.cluster, sessionAddress);
  console.log("[SPOTR] join: session account on-chain =", sessionExists);
  if (!sessionExists) {
    throw new Error(
      "Session account not found on-chain. The session needs to be re-deployed. Ask an admin to deploy it again."
    );
  }

  // ── collect instructions ─────────────────────────────────────────────────
  const ixs = [];

  const [vaultPda] = await findDepositToVaultVaultPda({
    owner: params.player.address,
  });
  const vaultExists = await accountExists(params.cluster, vaultPda);
  console.log("[SPOTR] join: vault already on-chain =", vaultExists);

  if (!vaultExists) {
    console.log("[SPOTR] join: will init user vault in batch…");
    ixs.push(
      await getInitUserVaultInstructionAsync({ owner: params.player, usdcMint })
    );
  }

  const [vaultTokensPda] = await findDepositToVaultVaultTokensPda({
    owner: params.player.address,
  });
  const vaultBalance = await getTokenBalance(params.cluster, vaultTokensPda);
  console.log("[SPOTR] join: vault balance =", vaultBalance.toString());

  if (vaultBalance < params.buyInAmount) {
    const depositAmount = params.buyInAmount - vaultBalance;
    console.log("[SPOTR] join: will deposit", depositAmount.toString(), "in batch…");
    const [playerAta] = await findAssociatedTokenPda({
      owner: params.player.address,
      mint: usdcMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    ixs.push(
      await getDepositToVaultInstructionAsync({
        owner: params.player,
        ownerTokenAccount: playerAta,
        amount: depositAmount,
      })
    );
  }

  ixs.push(
    await getJoinSessionInstructionAsync({
      player: params.player,
      session: sessionAddress,
    })
  );

  // ── single atomic TX ─────────────────────────────────────────────────────
  console.log("[SPOTR] join: sending", ixs.length, "instruction(s) in one TX…");
  const result = await txClient.sendTransaction(ixs);
  const signature = String(result.context.signature);
  console.log("[SPOTR] join: joined ✓ signature =", signature);
  return { signature, sessionAddress };
}
