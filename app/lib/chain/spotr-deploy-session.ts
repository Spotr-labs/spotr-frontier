"use client";

import { address, type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  getCreateRoundInstruction,
  getCreateSessionInstructionAsync,
  getInitializeConfigInstructionAsync,
} from "../../generated/spotr/instructions";
import { findConfigPda } from "../../generated/spotr/pdas";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { publicSpotrConfig } from "../spotr-config/public";
import { findSpotrSessionPda } from "./session-pda";
import { findSpotrRoundPda } from "./round-pda";
import type { ClusterMoniker } from "../solana-client";

const USDC_MINT_ADDRESS = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? null;
function requireUsdcMint(): Address {
  if (!USDC_MINT_ADDRESS) {
    throw new Error(
      "NEXT_PUBLIC_USDC_MINT_ADDRESS is not set; cannot deploy session without USDC mint."
    );
  }
  return address(USDC_MINT_ADDRESS);
}

export type DeploySessionChainParams = {
  cluster: ClusterMoniker;
  admin: TransactionSigner;
  sessionNumber: bigint;
  startTsSeconds: bigint;
  endTsSeconds: bigint;
  pairIds: string[];
  buyInUsdcUnits?: bigint;
};

export type DeploySessionChainResult = {
  signature: string;
  sessionAddress: Address;
  initializedConfig: boolean;
};

async function configAccountExists(
  cluster: ClusterMoniker,
  configPda: Address
): Promise<boolean> {
  const response = await fetch(getClusterUrl(cluster), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [String(configPda), { encoding: "base64" }],
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`RPC getAccountInfo failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    result?: { value: unknown } | null;
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);
  return json.result?.value != null;
}

/**
 * TX 1: (optionally) initialize_config + create_session.
 * All instructions — (optionally) initialize_config, create_session, and
 * every create_round — are sent in a single transaction and a single wallet
 * signing prompt.
 */
export async function submitDeploySessionOnChain(
  params: DeploySessionChainParams
): Promise<DeploySessionChainResult> {
  const [configPda] = await findConfigPda();
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);

  const alreadyInitialized = await configAccountExists(params.cluster, configPda);

  const usdcMint = requireUsdcMint();

  // Derive all round PDAs in parallel before building the instruction list.
  const roundPdas = await Promise.all(
    params.pairIds.map((_, i) =>
      findSpotrRoundPda({ session: sessionAddress as Address, index: i })
    )
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ixs: any[] = [];

  if (!alreadyInitialized) {
    ixs.push(
      await getInitializeConfigInstructionAsync({
        authority: params.admin,
        usdcMint,
        input: {
          protocolFeeBps: publicSpotrConfig.protocolFeeBps,
          referralCutBps: publicSpotrConfig.referralCutBps,
          roundCount: publicSpotrConfig.roundCount,
          roundDurationSeconds: BigInt(publicSpotrConfig.roundDurationSeconds),
          buyInUsdcUnits: BigInt(publicSpotrConfig.sessionBuyInLamports),
        },
      })
    );
  }

  ixs.push(
    await getCreateSessionInstructionAsync({
      authority: params.admin,
      session: sessionAddress,
      usdcMint,
      sessionNumber: params.sessionNumber,
      roundCount: publicSpotrConfig.roundCount,
      roundDurationSeconds: BigInt(publicSpotrConfig.roundDurationSeconds),
      buyInUsdcUnits: params.buyInUsdcUnits ?? BigInt(publicSpotrConfig.sessionBuyInLamports),
      protocolFeeBps: publicSpotrConfig.protocolFeeBps,
      referralCutBps: publicSpotrConfig.referralCutBps,
      minWallets: publicSpotrConfig.sessionMinWallets,
      minTotalUsdcUnits: BigInt(publicSpotrConfig.sessionMinTotalLamports),
      startTs: params.startTsSeconds,
      endTs: params.endTsSeconds,
    })
  );

  for (let i = 0; i < params.pairIds.length; i++) {
    const pairIdBytes = new Uint8Array(32);
    pairIdBytes.set(new TextEncoder().encode(params.pairIds[i]).slice(0, 32));
    const [roundAddress] = roundPdas[i];
    ixs.push(
      getCreateRoundInstruction({
        authority: params.admin,
        session: sessionAddress as Address,
        round: roundAddress as Address,
        index: i,
        pairId: pairIdBytes,
      })
    );
  }

  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.admin,
  });
  const result = await txClient.sendTransaction(ixs);

  return {
    signature: String(result.context.signature),
    sessionAddress,
    initializedConfig: !alreadyInitialized,
  };
}
