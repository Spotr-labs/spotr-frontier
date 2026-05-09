import { readFileSync } from "node:fs";
import path from "node:path";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getMintToInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getInitUserVaultInstructionAsync } from "../app/generated/spotr/instructions/initUserVault";
import { findVaultPda } from "../app/generated/spotr/pdas/vault";
import { findVaultTokensPda } from "../app/generated/spotr/pdas/vaultTokens";
import { fetchAccountExists, waitForAccountExists, waitForTokenBalanceAtLeast } from "../app/lib/server/rpc-account";
import { getSponsorRpcUrl, loadSponsorSigner, submitSponsoredTx } from "../app/lib/server/sponsor-tx";

function loadEnvFile(filePath: string) {
  const env = readFileSync(filePath, "utf8");
  for (const line of env.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

async function main() {
  const envFile =
    process.env.SPOTR_ENV_FILE?.trim() || path.join(process.cwd(), ".env.devnet");
  loadEnvFile(envFile);

  const cluster = process.env.NEXT_PUBLIC_SPOTR_CLUSTER;
  if (cluster !== "devnet" && cluster !== "localnet") {
    throw new Error(`Unsupported cluster for funding bot wallets: ${cluster}`);
  }

  const wallets = (process.env.SPOTR_AUTO_FILL_BOT_WALLETS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (wallets.length === 0) {
    throw new Error("SPOTR_AUTO_FILL_BOT_WALLETS is empty.");
  }

  const sponsor = await loadSponsorSigner();
  const rpcUrl = getSponsorRpcUrl(cluster);
  const rpc = createSolanaRpc(rpcUrl);
  const usdcMint = address(process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS ?? "");
  const mintAuthority = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(process.env.USDC_MINT_AUTHORITY_KEYPAIR ?? "[]")),
  );
  const buyIn = BigInt(process.env.NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS ?? "0");
  const deposit = BigInt(process.env.SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS ?? "1000000");
  const amount = buyIn + deposit;

  for (const wallet of wallets) {
    console.log(`funding ${wallet}`);
    const owner = address(wallet);
    const [vaultPda] = await findVaultPda({ player: owner });
    if (!(await fetchAccountExists(rpcUrl, String(vaultPda)))) {
      const ix = await getInitUserVaultInstructionAsync({
        sponsor,
        owner,
        usdcMint,
      });
      const sig = await submitSponsoredTx(cluster, [ix]);
      console.log(`  init-vault submitted: ${sig}`);
      const created = await waitForAccountExists(rpcUrl, String(vaultPda), {
        attempts: 30,
        delayMs: 1000,
      });
      if (!created) {
        throw new Error(`Vault did not appear after init for ${wallet}.`);
      }
      console.log(`  init-vault confirmed: ${sig}`);
    } else {
      console.log("  init-vault: already exists");
    }

    const [vaultTokensPda] = await findVaultTokensPda({ player: owner });
    const accountInfo = await rpc
      .getAccountInfo(vaultTokensPda, { encoding: "base64" })
      .send();
    if (!accountInfo.value) {
      throw new Error(`Vault token account missing for ${wallet}.`);
    }
    if (accountInfo.value.owner !== TOKEN_PROGRAM_ADDRESS) {
      throw new Error(`Vault token owner mismatch for ${wallet}.`);
    }

    const mintToIx = getMintToInstruction({
      mint: usdcMint,
      token: vaultTokensPda,
      mintAuthority,
      amount,
    });
    const {
      value: { blockhash, lastValidBlockHeight },
    } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(mintAuthority, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash, lastValidBlockHeight },
          m,
        ),
      (m) => appendTransactionMessageInstructions([mintToIx], m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const encoded = getBase64EncodedWireTransaction(signed);
    const mintSig = await rpc
      .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
      .send();
    const balance = await waitForTokenBalanceAtLeast(
      rpcUrl,
      String(vaultTokensPda),
      amount,
      {
        attempts: 30,
        delayMs: 1000,
      },
    );
    if (balance < amount) {
      throw new Error(
        `Vault balance for ${wallet} is ${balance.toString()}, expected at least ${amount.toString()}.`,
      );
    }
    console.log(`  mint: ${mintSig}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
