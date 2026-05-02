"use client";

import { type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import { getEnterPositionInstructionAsync } from "../../generated/spotr/instructions";
import { findDepositToVaultVaultTokensPda } from "../../generated/spotr/pdas/depositToVaultVaultTokens";
import { SideSelection } from "../../generated/spotr/types/sideSelection";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { findSpotrSessionPda } from "./session-pda";
import { findSpotrRoundPda } from "./round-pda";
import { getTokenBalance } from "./spotr-join-session";
import type { ClusterMoniker } from "../solana-client";
import type { SpotrSide } from "../spotr-types";

export type EnterPositionChainResult = {
  txSignature: string;
};

export const INSUFFICIENT_VAULT_ERROR = "INSUFFICIENT_VAULT";

export async function submitEnterPositionOnChain(params: {
  cluster: ClusterMoniker;
  sessionNumber: bigint;
  roundIndex: number;
  pairId: string;
  player: TransactionSigner;
  side: SpotrSide;
  wagerUsdcUnits: bigint;
}): Promise<EnterPositionChainResult> {
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress as Address,
    index: params.roundIndex,
  });

  const [vaultTokensPda] = await findDepositToVaultVaultTokensPda({
    owner: params.player.address,
  });
  const vaultBalance = await getTokenBalance(params.cluster, vaultTokensPda);

  if (vaultBalance < params.wagerUsdcUnits) {
    const err = new Error(INSUFFICIENT_VAULT_ERROR);
    err.name = INSUFFICIENT_VAULT_ERROR;
    throw err;
  }

  const sideSelection = params.side === "A" ? SideSelection.A : SideSelection.B;
  const enterIx = await getEnterPositionInstructionAsync({
    player: params.player,
    session: sessionAddress as Address,
    round: roundAddress as Address,
    side: sideSelection,
    wagerUsdcUnits: params.wagerUsdcUnits,
  });

  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.player,
  });
  const result = await txClient.sendTransaction([enterIx]);
  return { txSignature: String(result.context.signature) };
}
