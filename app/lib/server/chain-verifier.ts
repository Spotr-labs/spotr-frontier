import "server-only";

import { getBase58Codec } from "@solana/codecs-strings";
import { createSolanaClient, type ClusterMoniker } from "../solana-client";
import { SPOTR_MARKETS_PROGRAM_ADDRESS } from "../../generated/spotr/programs";
import { JOIN_SESSION_DISCRIMINATOR } from "../../generated/spotr/instructions/joinSession";
import { CREATE_SESSION_DISCRIMINATOR } from "../../generated/spotr/instructions/createSession";
import { findSpotrSessionPda } from "../chain/session-pda";
import { findPlayerSessionPda } from "../../generated/spotr/pdas/playerSession";

const base58 = getBase58Codec();

export class ChainVerificationError extends Error {
  readonly retriable: boolean;

  constructor(message: string, options: { retriable?: boolean } = {}) {
    super(message);
    this.name = "ChainVerificationError";
    this.retriable = options.retriable ?? false;
  }
}

export class PendingChainVerificationError extends ChainVerificationError {
  constructor(message = "Transaction is not confirmed yet; retry in a moment.") {
    super(message, { retriable: true });
    this.name = "PendingChainVerificationError";
  }
}

type RpcInstruction = {
  programIdIndex: number;
  accounts: number[];
  data: string;
  stackHeight?: number | null;
};

type RpcMessage = {
  accountKeys: string[];
  instructions: RpcInstruction[];
};

type RpcTransactionResponse = {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown | null } | null;
  transaction: {
    message: RpcMessage;
    signatures: string[];
  };
} | null;

async function rpcCall<T>(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ChainVerificationError(
      `RPC ${method} failed: HTTP ${response.status}`
    );
  }
  const json = (await response.json()) as { result?: T; error?: { message: string } };
  if (json.error) {
    throw new ChainVerificationError(`RPC ${method} error: ${json.error.message}`);
  }
  return json.result as T;
}

function bytesStartWith(data: Uint8Array, prefix: Uint8Array) {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Fetches a confirmed transaction from the current cluster's RPC, verifies
 * it contains a successful joinSession instruction targeting the expected
 * session PDA with the expected player as signer.
 *
 * Returns the resolved session PDA (base58) so callers can persist it.
 */
export async function verifyJoinSessionTx(params: {
  cluster: ClusterMoniker;
  signature: string;
  expectedPlayer: string;
  expectedSessionNumber: bigint;
}): Promise<{
  sessionAddress: string;
  playerSessionAddress: string;
  slot: number;
  blockTime: number | null;
}> {
  if (!params.signature || typeof params.signature !== "string") {
    throw new ChainVerificationError("Missing transaction signature.");
  }

  const client = createSolanaClient(params.cluster);
  const url = (client as unknown as { rpc?: { _transport?: { url?: string } } })
    ?.rpc?._transport?.url;
  // createSolanaClient is built over @solana/kit plugins; the underlying URL
  // may not be exposed reliably, so call the public RPC endpoint directly.
  const rpcUrl = url ?? getDefaultRpcUrl(params.cluster);

  const [expectedSessionAddress] = await findSpotrSessionPda(
    params.expectedSessionNumber
  );
  const expectedSession = String(expectedSessionAddress);
  const [expectedPlayerSessionAddress] = await findPlayerSessionPda({
    session: expectedSessionAddress,
    player: params.expectedPlayer as import("@solana/kit").Address,
  });
  const expectedPlayerSession = String(expectedPlayerSessionAddress);

  let tx: RpcTransactionResponse = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    tx = await rpcCall<RpcTransactionResponse>(rpcUrl, "getTransaction", [
      params.signature,
      {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    if (tx) break;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  if (!tx) {
    type AccountInfoResult = { value: unknown } | null;
    const result = await rpcCall<AccountInfoResult>(rpcUrl, "getAccountInfo", [
      expectedPlayerSession,
      { encoding: "base64" },
    ]);
    if (result?.value) {
      return {
        sessionAddress: expectedSession,
        playerSessionAddress: expectedPlayerSession,
        slot: -1,
        blockTime: null,
      };
    }
    throw new PendingChainVerificationError();
  }
  if (tx.meta?.err) {
    throw new ChainVerificationError(
      `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`
    );
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const programId = String(SPOTR_MARKETS_PROGRAM_ADDRESS);

  const joinInstructions = tx.transaction.message.instructions.filter(
    (ix) => accountKeys[ix.programIdIndex] === programId
  );
  if (joinInstructions.length === 0) {
    throw new ChainVerificationError(
      "Transaction does not invoke the SPOTR program."
    );
  }

  // Sponsored layout: accounts = [sponsor, config, player, session, ...]
  const match = joinInstructions.find((ix) => {
    const data = new Uint8Array(base58.encode(ix.data));
    if (!bytesStartWith(data, JOIN_SESSION_DISCRIMINATOR)) return false;
    if (ix.accounts.length < 4) return false;
    const playerKey = accountKeys[ix.accounts[2]];
    const sessionKey = accountKeys[ix.accounts[3]];
    return playerKey === params.expectedPlayer && sessionKey === expectedSession;
  });

  if (!match) {
    throw new ChainVerificationError(
      "Transaction does not contain the expected join_session instruction."
    );
  }

  return {
    sessionAddress: expectedSession,
    playerSessionAddress: expectedPlayerSession,
    slot: tx.slot,
    blockTime: tx.blockTime,
  };
}

/**
 * Fetches a confirmed create_session transaction and asserts it matches the
 * expected admin + session PDA derived from the given session number.
 */
export async function verifyCreateSessionTx(params: {
  cluster: ClusterMoniker;
  signature: string;
  expectedAdmin: string;
  expectedSessionNumber: bigint;
}): Promise<{ sessionAddress: string; slot: number; blockTime: number | null }> {
  if (!params.signature) {
    throw new ChainVerificationError("Missing transaction signature.");
  }

  const rpcUrl = getDefaultRpcUrl(params.cluster);
  const tx = await rpcCall<RpcTransactionResponse>(rpcUrl, "getTransaction", [
    params.signature,
    {
      commitment: "confirmed",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (!tx) {
    throw new ChainVerificationError(
      "Transaction is not confirmed yet; retry in a moment."
    );
  }
  if (tx.meta?.err) {
    throw new ChainVerificationError(
      `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`
    );
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const programId = String(SPOTR_MARKETS_PROGRAM_ADDRESS);
  const programInstructions = tx.transaction.message.instructions.filter(
    (ix) => accountKeys[ix.programIdIndex] === programId
  );
  if (programInstructions.length === 0) {
    throw new ChainVerificationError(
      "Transaction does not invoke the SPOTR program."
    );
  }

  const [expectedSessionAddress] = await findSpotrSessionPda(
    params.expectedSessionNumber
  );
  const expectedSession = String(expectedSessionAddress);

  const match = programInstructions.find((ix) => {
    const data = new Uint8Array(base58.encode(ix.data));
    if (!bytesStartWith(data, CREATE_SESSION_DISCRIMINATOR)) return false;
    if (ix.accounts.length < 4) return false;
    const authority = accountKeys[ix.accounts[0]];
    const sessionKey = accountKeys[ix.accounts[2]];
    return authority === params.expectedAdmin && sessionKey === expectedSession;
  });
  if (!match) {
    throw new ChainVerificationError(
      "Transaction does not contain the expected create_session instruction."
    );
  }

  return {
    sessionAddress: expectedSession,
    slot: tx.slot,
    blockTime: tx.blockTime,
  };
}

function getDefaultRpcUrl(cluster: ClusterMoniker) {
  switch (cluster) {
    case "mainnet":
      return "https://api.mainnet-beta.solana.com";
    case "testnet":
      return "https://api.testnet.solana.com";
    case "localnet":
      return "http://localhost:8899";
    case "devnet":
    default:
      return "https://api.devnet.solana.com";
  }
}

/**
 * Verifies that the PlayerSession PDA for the given player + session exists
 * on-chain. Used when the client detected the account already existed before
 * sending a new join_session tx (e.g. a prior attempt succeeded on-chain but
 * the backend step failed). Returns the resolved session PDA address.
 */
export async function verifyPlayerSessionExists(params: {
  cluster: ClusterMoniker;
  expectedPlayer: string;
  expectedSessionNumber: bigint;
}): Promise<{ sessionAddress: string; playerSessionAddress: string }> {
  const rpcUrl = getDefaultRpcUrl(params.cluster);
  const [sessionAddress] = await findSpotrSessionPda(params.expectedSessionNumber);
  const [playerSessionPda] = await findPlayerSessionPda({
    session: sessionAddress,
    player: params.expectedPlayer as import("@solana/kit").Address,
  });

  type AccountInfoResult = { value: unknown } | null;
  const result = await rpcCall<AccountInfoResult>(rpcUrl, "getAccountInfo", [
    String(playerSessionPda),
    { encoding: "base64" },
  ]);
  if (!result?.value) {
    throw new ChainVerificationError(
      "PlayerSession account does not exist on-chain. The player has not joined this session."
    );
  }

  return {
    sessionAddress: String(sessionAddress),
    playerSessionAddress: String(playerSessionPda),
  };
}
