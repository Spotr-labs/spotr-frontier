"use client";

import { address, type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  getCloseRoundInstruction,
  getCreateRoundInstruction,
  getFinalizeSessionInstruction,
  getSweepOrphansInstructionAsync,
  getWithdrawProtocolFeesInstructionAsync,
} from "../../generated/spotr/instructions";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { findSpotrSessionPda } from "./session-pda";
import { findSpotrRoundPda } from "./round-pda";
import type { ClusterMoniker } from "../solana-client";

const USDC_MINT_ADDRESS = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;

function requireUsdcMint(): Address {
  if (!USDC_MINT_ADDRESS) {
    throw new Error(
      "NEXT_PUBLIC_USDC_MINT_ADDRESS is not set; cannot run protocol ops without USDC mint."
    );
  }
  return address(USDC_MINT_ADDRESS);
}

type ChainParams = {
  cluster: ClusterMoniker;
  signer: TransactionSigner;
};

export type SubmitCloseRoundParams = ChainParams & {
  sessionNumber: bigint;
  roundIndex: number;
};

export async function submitCloseRoundOnChain(
  params: SubmitCloseRoundParams
): Promise<{ signature: string }> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress,
    index: params.roundIndex,
  });
  const ix = getCloseRoundInstruction({
    session: sessionAddress,
    round: roundAddress,
  });
  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.signer,
  });
  const result = await txClient.sendTransaction([ix]);
  return { signature: String(result.context.signature) };
}

export type SubmitSweepOrphansParams = ChainParams & {
  sessionNumber: bigint;
  roundIndex: number;
};

export async function submitSweepOrphansOnChain(
  params: SubmitSweepOrphansParams
): Promise<{ signature: string }> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress,
    index: params.roundIndex,
  });
  // Touch USDC mint so PDAs derive consistently when present.
  void requireUsdcMint();
  const ix = await getSweepOrphansInstructionAsync({
    session: sessionAddress,
    round: roundAddress,
  });
  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.signer,
  });
  const result = await txClient.sendTransaction([ix]);
  return { signature: String(result.context.signature) };
}

export type SubmitFinalizeSessionParams = ChainParams & {
  sessionNumber: bigint;
};

export async function submitFinalizeSessionOnChain(
  params: SubmitFinalizeSessionParams
): Promise<{ signature: string }> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  const ix = getFinalizeSessionInstruction({ session: sessionAddress });
  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.signer,
  });
  const result = await txClient.sendTransaction([ix]);
  return { signature: String(result.context.signature) };
}

export type SubmitWithdrawProtocolFeesParams = ChainParams & {
  sessionNumber: bigint;
};

export async function submitWithdrawProtocolFeesOnChain(
  params: SubmitWithdrawProtocolFeesParams
): Promise<{ signature: string }> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  void requireUsdcMint();
  const ix = await getWithdrawProtocolFeesInstructionAsync({
    authority: params.signer,
    session: sessionAddress,
  });
  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.signer,
  });
  const result = await txClient.sendTransaction([ix]);
  return { signature: String(result.context.signature) };
}

export type SubmitCreateRoundParams = ChainParams & {
  sessionNumber: bigint;
  roundIndex: number;
  pairId: Uint8Array;
};

export async function submitCreateRoundOnChain(
  params: SubmitCreateRoundParams
): Promise<{ signature: string }> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress,
    index: params.roundIndex,
  });
  const ix = getCreateRoundInstruction({
    authority: params.signer,
    session: sessionAddress,
    round: roundAddress,
    index: params.roundIndex,
    pairId: params.pairId,
  });
  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.signer,
  });
  const result = await txClient.sendTransaction([ix]);
  return { signature: String(result.context.signature) };
}
