/**
 * Initializes the on-chain spotr_markets config on localnet.
 * Safe to re-run — exits early if config PDA already exists.
 * Called by dev-local.sh after program deploy.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  pipe,
} from "@solana/kit";
import { getInitializeConfigInstructionAsync } from "../app/generated/spotr/instructions/initializeConfig";
import { findConfigPda } from "../app/generated/spotr/pdas/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const SPONSOR_PUBKEY = "CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW";

async function main() {
  const rpc = createSolanaRpc(RPC_URL);

  const [configPda] = await findConfigPda();
  const existing = await rpc.getAccountInfo(configPda, { encoding: "base64" }).send();
  if (existing.value != null) {
    console.log("[init-config] ✓ config already exists:", String(configPda));
    return;
  }

  const payerBytes: number[] = JSON.parse(
    readFileSync(join(__dirname, ".dev-payer-keypair.json"), "utf-8"),
  );
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(payerBytes));

  const usdcMint = address(process.env.USDC_MINT_ADDRESS!);

  const adminWallets = (process.env.SPOTR_ADMIN_WALLETS ?? "").split(",").map((s) => s.trim());
  if (adminWallets.length < 2) throw new Error("SPOTR_ADMIN_WALLETS must have exactly 2 entries");

  const authorities = [
    address(adminWallets[0]),
    address(adminWallets[1]),
    address(SPONSOR_PUBKEY),
  ];

  const ix = await getInitializeConfigInstructionAsync({
    authority: payer,
    usdcMint,
    input: {
      authorities,
      protocolFeeBps: Number(process.env.NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS ?? 350),
      referralCutBps: Number(process.env.NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS ?? 5000),
      roundCount: Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_COUNT ?? 7),
      roundDurationSeconds: BigInt(process.env.NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS ?? 30),
      buyInUsdcUnits: BigInt(process.env.NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS ?? 0),
      roundFillThreshold: Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_FILL_THRESHOLD ?? 7),
    },
  });

  const {
    value: { blockhash, lastValidBlockHeight },
  } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );

  const signed = await signTransactionMessageWithSigners(message);
  const encoded = getBase64EncodedWireTransaction(signed);
  const signature = await rpc
    .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
    .send();

  console.log("[init-config] ✓ initialize_config:", String(signature));
}

main().catch((err) => {
  console.error("[init-config] ✗", err.message ?? err);
  process.exit(1);
});
