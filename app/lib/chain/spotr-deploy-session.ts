"use client";

import { type Address, type TransactionSigner } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  getCreateSessionInstructionAsync,
  getInitializeConfigInstructionAsync,
} from "../../generated/spotr/instructions";
import { findConfigPda } from "../../generated/spotr/pdas";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";
import { publicSpotrConfig } from "../spotr-config/public";
import { findSpotrSessionPda } from "./session-pda";
import type { ClusterMoniker } from "../solana-client";

export type DeploySessionChainParams = {
  cluster: ClusterMoniker;
  admin: TransactionSigner;
  sessionNumber: bigint;
  startTsSeconds: bigint;
  endTsSeconds: bigint;
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
 * Builds one tx containing (optionally) initialize_config followed by
 * create_session, then signs and sends with the admin wallet. Returns the
 * confirmed signature and the resolved session PDA.
 */
export async function submitDeploySessionOnChain(
  params: DeploySessionChainParams
): Promise<DeploySessionChainResult> {
  const [configPda] = await findConfigPda();
  const [sessionAddress] = await findSpotrSessionPda(params.sessionNumber);

  const alreadyInitialized = await configAccountExists(params.cluster, configPda);

  const instructions = [] as Awaited<
    ReturnType<typeof getCreateSessionInstructionAsync>
  >[];

  if (!alreadyInitialized) {
    const initIx = await getInitializeConfigInstructionAsync({
      authority: params.admin,
      input: {
        protocolFeeBps: publicSpotrConfig.protocolFeeBps,
        referralCutBps: publicSpotrConfig.referralCutBps,
        roundCount: publicSpotrConfig.roundCount,
        roundDurationSeconds: BigInt(publicSpotrConfig.roundDurationSeconds),
        buyInLamports: BigInt(publicSpotrConfig.sessionBuyInLamports),
        roundStakeLamports: BigInt(publicSpotrConfig.roundMinStakeLamports),
      },
    });
    instructions.push(
      initIx as unknown as Awaited<
        ReturnType<typeof getCreateSessionInstructionAsync>
      >
    );
  }

  const createIx = await getCreateSessionInstructionAsync({
    authority: params.admin,
    session: sessionAddress,
    sessionNumber: params.sessionNumber,
    roundCount: publicSpotrConfig.roundCount,
    roundDurationSeconds: BigInt(publicSpotrConfig.roundDurationSeconds),
    buyInLamports: BigInt(publicSpotrConfig.sessionBuyInLamports),
    roundStakeLamports: BigInt(publicSpotrConfig.roundMinStakeLamports),
    protocolFeeBps: publicSpotrConfig.protocolFeeBps,
    referralCutBps: publicSpotrConfig.referralCutBps,
    minWallets: publicSpotrConfig.sessionMinWallets,
    minTotalLamports: BigInt(publicSpotrConfig.sessionMinTotalLamports),
    startTs: params.startTsSeconds,
    endTs: params.endTsSeconds,
  });
  instructions.push(createIx);

  const txClient = createClient({
    url: getClusterUrl(params.cluster),
    rpcSubscriptionsConfig: getClusterWsConfig(params.cluster),
    payer: params.admin,
  });
  const result = await txClient.sendTransaction(instructions);
  return {
    signature: String(result.context.signature),
    sessionAddress,
    initializedConfig: !alreadyInitialized,
  };
}
