/**
 * Calls update_config on devnet.
 * Usage: npx tsx --env-file=.env scripts/update-config.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { address, createKeyPairSignerFromBytes } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import { getUpdateConfigInstructionAsync } from "../app/generated/spotr/instructions/updateConfig";

const RPC_URL = "https://api.devnet.solana.com";
const RPC_WS  = "wss://api.devnet.solana.com/";

const ADMIN_WALLETS = process.env.SPOTR_ADMIN_WALLETS?.split(",").map(s => s.trim()) ?? [];
if (ADMIN_WALLETS.length !== 2) throw new Error("Expected 2 wallets in SPOTR_ADMIN_WALLETS");
const DEPLOY_WALLET = "CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW";

async function main() {
  const deployKeypairBytes = new Uint8Array(
    JSON.parse(readFileSync(join(homedir(), ".config/solana/id.json"), "utf8"))
  );
  const deployer = await createKeyPairSignerFromBytes(deployKeypairBytes);

  const ix = await getUpdateConfigInstructionAsync({
    authority: deployer,
    input: {
      authorities: [address(ADMIN_WALLETS[0]), address(ADMIN_WALLETS[1]), address(DEPLOY_WALLET)],
      protocolFeeBps:       Number(process.env.NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS ?? 350),
      referralCutBps:       Number(process.env.NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS ?? 5000),
      roundCount:           Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_COUNT ?? 7),
      roundDurationSeconds: BigInt(process.env.NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS ?? 30),
      buyInUsdcUnits:       0n,
    },
  });

  const client = createClient({ url: RPC_URL, rpcSubscriptionsConfig: { url: RPC_WS }, payer: deployer });
  const result = await client.sendTransaction([ix]);

  console.log("✓ update_config:", String(result.context.signature));
  console.log("  Explorer: https://explorer.solana.com/tx/" + String(result.context.signature) + "?cluster=devnet");
}

main().catch(err => { console.error(err); process.exit(1); });
