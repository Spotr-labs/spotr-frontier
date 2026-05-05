/**
 * Calls initialize_config on devnet with the admin wallets from .env
 * plus the deploy wallet as the third slot.
 *
 * Usage:
 *   npx tsx scripts/initialize-config.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  address,
  createSolanaRpc,
  createKeyPairSignerFromBytes,
} from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import { getInitializeConfigInstructionAsync } from "../app/generated/spotr/instructions/initializeConfig";

const RPC_URL = "https://api.devnet.solana.com";
const RPC_WS  = "wss://api.devnet.solana.com/";

// USDC mint created in keys/usdc-mint.json
const USDC_MINT = address("5fsPFeDSMbmQKDxyA19kV8tEswFpwZCkCoUuKm66DyuQ");

// Admin wallets: two from SPOTR_ADMIN_WALLETS + deploy wallet
const ADMIN_WALLETS = process.env.SPOTR_ADMIN_WALLETS?.split(",").map(s => s.trim()) ?? [];
if (ADMIN_WALLETS.length !== 2) {
  throw new Error("Expected exactly 2 wallets in SPOTR_ADMIN_WALLETS");
}

// Deploy wallet is always the third slot
const DEPLOY_WALLET = "CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW";

const authorities = [
  address(ADMIN_WALLETS[0]),
  address(ADMIN_WALLETS[1]),
  address(DEPLOY_WALLET),
];

async function main() {
  const deployKeypairBytes = new Uint8Array(
    JSON.parse(readFileSync(join(homedir(), ".config/solana/id.json"), "utf8"))
  );
  const deployer = await createKeyPairSignerFromBytes(deployKeypairBytes);

  console.log("Deployer:", deployer.address);
  console.log("Authorities:", authorities);
  console.log("USDC mint:", USDC_MINT);

  const ix = await getInitializeConfigInstructionAsync({
    authority: deployer,
    usdcMint: USDC_MINT,
    input: {
      authorities,
      protocolFeeBps:        Number(process.env.NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS ?? 350),
      referralCutBps:        Number(process.env.NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS ?? 5000),
      roundCount:            Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_COUNT ?? 7),
      roundDurationSeconds:  BigInt(process.env.NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS ?? 30),
      buyInUsdcUnits:        BigInt(process.env.NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS ?? 0),
      roundFillThreshold:    Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_FILL_THRESHOLD ?? 7),
    },
  });

  const rpc = createSolanaRpc(RPC_URL);
  const client = createClient({ url: RPC_URL, rpcSubscriptionsConfig: { url: RPC_WS }, payer: deployer });
  const result = await client.sendTransaction([ix]);

  console.log("✓ initialize_config:", String(result.context.signature));
  console.log("  Explorer: https://explorer.solana.com/tx/" + String(result.context.signature) + "?cluster=devnet");
}

main().catch(err => { console.error(err); process.exit(1); });
