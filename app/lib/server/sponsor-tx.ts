import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import type { ClusterMoniker } from "../solana-client";

const RPC_URLS: Record<ClusterMoniker, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export function getSponsorRpcUrl(cluster: ClusterMoniker): string {
  const url = RPC_URLS[cluster];
  if (!url) {
    throw new Error(`No RPC URL configured for cluster '${cluster}'.`);
  }
  return url;
}

let cachedSponsor: KeyPairSigner | null = null;

/**
 * Loads the sponsor keypair used to fee-pay and rent-pay every server-side
 * play instruction. Resolution order:
 *   1. SPOTR_SPONSOR_KEYPAIR env var (JSON byte array)
 *   2. keys/spotr-sponsor.json on disk
 * The sponsor pubkey MUST be present in `config.authorities` on-chain or
 * every sponsored instruction will fail with `InvalidConfig`. Run
 * `scripts/update-config.ts` after rotating this key.
 */
export async function loadSponsorSigner(): Promise<KeyPairSigner> {
  if (cachedSponsor) return cachedSponsor;

  const fromEnv = process.env.SPOTR_SPONSOR_KEYPAIR;
  let bytes: number[];
  if (fromEnv) {
    bytes = JSON.parse(fromEnv) as number[];
  } else {
    try {
      bytes = JSON.parse(
        readFileSync(
          path.join(process.cwd(), "keys", "spotr-sponsor.json"),
          "utf-8",
        ),
      ) as number[];
    } catch {
      throw new Error(
        "Sponsor keypair not available. Set SPOTR_SPONSOR_KEYPAIR env var or place keys/spotr-sponsor.json on disk.",
      );
    }
  }

  cachedSponsor = await createKeyPairSignerFromBytes(new Uint8Array(bytes));
  return cachedSponsor;
}

export async function getSponsorAddress(): Promise<Address> {
  const signer = await loadSponsorSigner();
  return signer.address;
}

/**
 * Builds, signs (sponsor-only) and submits a transaction containing the given
 * instructions. The sponsor is the fee payer and signs every account that
 * carries the sponsor pubkey. Returns the base58 signature returned by RPC.
 */
export async function submitSponsoredTx(
  cluster: ClusterMoniker,
  ixs: Instruction[],
): Promise<string> {
  const sponsor = await loadSponsorSigner();
  const rpc = createSolanaRpc(getSponsorRpcUrl(cluster));

  const {
    value: { blockhash, lastValidBlockHeight },
  } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(sponsor, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight },
        m,
      ),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );

  const signed = await signTransactionMessageWithSigners(message);
  const encoded = getBase64EncodedWireTransaction(signed);

  try {
    const signature = await rpc
      .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
      .send();
    return String(signature);
  } catch (err) {
    throw new Error(extractSimulationMessage(err));
  }
}

function extractSimulationMessage(err: unknown): string {
  // Walk the cause chain to find preflight logs emitted by the program.
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current != null; depth++) {
    if (typeof current !== "object") break;
    const obj = current as { cause?: unknown; context?: { logs?: unknown } };
    const logs = obj.context?.logs;
    if (Array.isArray(logs)) {
      for (const line of logs) {
        if (typeof line !== "string") continue;
        // Anchor error: "AnchorError … Error Message: <msg>."
        const anchor = line.match(/Error Message:\s*([^.]+(?:\.[^.]+)*)/);
        if (anchor) return anchor[1].replace(/\.\s*$/, "").trim();
        // Custom program error code
        const custom = line.match(/custom program error:\s*(0x[0-9a-f]+)/i);
        if (custom) return `Transaction rejected by program (code ${custom[1]}).`;
      }
    }
    current = obj.cause;
  }
  return err instanceof Error ? err.message : "Transaction simulation failed.";
}
