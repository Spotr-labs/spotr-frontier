"use client";

import { address, type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getDepositToVaultInstructionAsync } from "../../generated/spotr/instructions";
import { getEnterPositionInstructionAsync } from "../../generated/spotr/instructions/enterPosition";
import { findDepositToVaultVaultTokensPda } from "../../generated/spotr/pdas/depositToVaultVaultTokens";
import { SideSelection } from "../../generated/spotr/types/sideSelection";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { findSpotrSessionPda } from "./session-pda";
import { findSpotrRoundPda } from "./round-pda";
import { accountExists, getTokenBalance } from "./spotr-join-session";
import { submitCreateRoundOnChain } from "./spotr-ops";
import type { ClusterMoniker } from "../solana-client";
import type { SpotrSide } from "../spotr-types";

export type EnterPositionChainResult = {
  txSignature: string;
};

function makeTxClient(cluster: ClusterMoniker, payer: TransactionSigner) {
  return createClient({
    url: getClusterUrl(cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(cluster),
    payer,
  });
}

function getUsdcMint(): Address {
  const raw = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_USDC_MINT_ADDRESS is not set; cannot top up vault without USDC mint."
    );
  }
  return address(raw);
}

export async function submitEnterPositionOnChain(params: {
  cluster: ClusterMoniker;
  sessionNumber: bigint;
  roundIndex: number;
  pairId: string;
  player: TransactionSigner;
  side: SpotrSide;
  wagerUsdcUnits: bigint;
}): Promise<EnterPositionChainResult> {
  const txClient = makeTxClient(params.cluster, params.player);
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress as Address,
    index: params.roundIndex,
  });

  console.log("[SPOTR] enter: sessionAddress =", String(sessionAddress));
  console.log("[SPOTR] enter: roundAddress =", String(roundAddress));

  const roundOnChain = await accountExists(params.cluster, roundAddress as Address);
  console.log("[SPOTR] enter: round already on-chain =", roundOnChain);

  if (!roundOnChain) {
    console.log("[SPOTR] enter: TX1 — creating round PDA…");
    const pairIdBytes = new Uint8Array(32);
    const encoded = new TextEncoder().encode(params.pairId);
    pairIdBytes.set(encoded.slice(0, 32));
    await submitCreateRoundOnChain({
      cluster: params.cluster,
      signer: params.player,
      sessionNumber: params.sessionNumber,
      roundIndex: params.roundIndex,
      pairId: pairIdBytes,
    });
    console.log("[SPOTR] enter: round created ✓");
  }

  const [vaultTokensPda] = await findDepositToVaultVaultTokensPda({
    owner: params.player.address,
  });
  const vaultBalance = await getTokenBalance(params.cluster, vaultTokensPda);
  console.log("[SPOTR] enter: vault balance =", vaultBalance.toString());

  if (vaultBalance < params.wagerUsdcUnits) {
    const shortfall = params.wagerUsdcUnits - vaultBalance;
    const usdcMint = getUsdcMint();
    const [playerAta] = await findAssociatedTokenPda({
      owner: params.player.address,
      mint: usdcMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    console.log("[SPOTR] enter: TX2 — depositing", shortfall.toString(), "into vault…");
    const depositIx = await getDepositToVaultInstructionAsync({
      owner: params.player,
      ownerTokenAccount: playerAta,
      amount: shortfall,
    });
    await txClient.sendTransaction([depositIx]);
    console.log("[SPOTR] enter: deposit confirmed ✓");
  }

  console.log("[SPOTR] enter: side =", params.side, "wager =", params.wagerUsdcUnits.toString());

  const sideSelection = params.side === "A" ? SideSelection.A : SideSelection.B;

  const enterIx = await getEnterPositionInstructionAsync({
    player: params.player,
    session: sessionAddress as Address,
    round: roundAddress as Address,
    side: sideSelection,
    wagerUsdcUnits: params.wagerUsdcUnits,
  });

  const result = await txClient.sendTransaction([enterIx]);
  const txSignature = String(result.context.signature);
  console.log("[SPOTR] enter: confirmed ✓ signature =", txSignature);
  return { txSignature };
}
