/**
 * Calls update_config on devnet.
 * Usage: npx tsx --env-file=.env scripts/update-config.ts
 *
 * The third authority slot holds the sponsor pubkey (`keys/spotr-sponsor.json`).
 * Sponsored play instructions (join_session / enter_position / claim_round /
 * claim_session_balance / init_user_vault) gate on the signer being one of
 * `config.authorities`, so the sponsor MUST appear here for the server to
 * pay fees and rent on behalf of players.
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

const SPONSOR_KEYPAIR_PATH = join(
  process.cwd(),
  "keys",
  "spotr-sponsor.json"
);

async function main() {
  const deployKeypairBytes = new Uint8Array(
    JSON.parse(readFileSync(join(homedir(), ".config/solana/id.json"), "utf8"))
  );
  const deployer = await createKeyPairSignerFromBytes(deployKeypairBytes);

  const sponsorKeypairBytes = new Uint8Array(
    JSON.parse(readFileSync(SPONSOR_KEYPAIR_PATH, "utf8"))
  );
  const sponsor = await createKeyPairSignerFromBytes(sponsorKeypairBytes);

  const ix = await getUpdateConfigInstructionAsync({
    authority: deployer,
    input: {
      authorities: [address(ADMIN_WALLETS[0]), address(ADMIN_WALLETS[1]), sponsor.address],
      protocolFeeBps:       Number(process.env.NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS ?? 350),
      referralCutBps:       Number(process.env.NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS ?? 5000),
      roundCount:           Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_COUNT ?? 7),
      roundDurationSeconds: BigInt(process.env.NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS ?? 30),
      buyInUsdcUnits:       0n,
      roundFillThreshold:   Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_FILL_THRESHOLD ?? 7),
    },
  });

  const client = createClient({ url: RPC_URL, rpcSubscriptionsConfig: { url: RPC_WS }, payer: deployer });
  const result = await client.sendTransaction([ix]);

  console.log("✓ update_config:", String(result.context.signature));
  console.log("  Explorer: https://explorer.solana.com/tx/" + String(result.context.signature) + "?cluster=devnet");
}

main().catch(err => { console.error(err); process.exit(1); });
