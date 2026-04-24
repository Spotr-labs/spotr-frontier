"use client";

import { type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import { getJoinSessionInstructionAsync } from "../../generated/spotr/instructions";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { findSpotrSessionPda } from "./session-pda";
import type { ClusterMoniker } from "../solana-client";

export type JoinSessionChainResult = {
  signature: string;
  sessionAddress: Address;
};

/**
 * Builds, signs, and submits the `join_session` Anchor instruction for the
 * connected player. Returns the confirmed transaction signature.
 *
 * Caller contract:
 * - `player` must be a TransactionSigner backed by the connected wallet.
 * - `sessionNumber` must match the on-chain session deployed by the admin;
 *   typically read from the server snapshot's `chainSessionNumber`.
 */
export async function submitJoinSessionOnChain(params: {
  cluster: ClusterMoniker;
  sessionNumber: bigint;
  player: TransactionSigner;
}): Promise<JoinSessionChainResult> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);

  const instruction = await getJoinSessionInstructionAsync({
    player: params.player,
    session: sessionAddress,
  });

  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.player,
  });

  const result = await txClient.sendTransaction([instruction]);
  const signature = result.context.signature;
  return { signature: String(signature), sessionAddress };
}
