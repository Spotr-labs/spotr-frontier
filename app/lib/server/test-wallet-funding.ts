import { readFileSync } from "fs";
import path from "path";
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
  address,
} from "@solana/kit";
import {
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getInitUserVaultInstructionAsync } from "../../generated/spotr/instructions/initUserVault";
import { findVaultPda } from "../../generated/spotr/pdas/vault";
import { findVaultTokensPda } from "../../generated/spotr/pdas/vaultTokens";
import { publicSpotrConfig } from "../spotr-config/public";
import { getSponsorRpcUrl, loadSponsorSigner, submitSponsoredTx } from "./sponsor-tx";
import {
  fetchAccountExists,
  waitForAccountExists,
  waitForTokenBalanceAtLeast,
} from "./rpc-account";

function loadMintAuthorityBytes(): number[] {
  const fromEnv = process.env.USDC_MINT_AUTHORITY_KEYPAIR;
  if (fromEnv) return JSON.parse(fromEnv) as number[];
  try {
    return JSON.parse(
      readFileSync(
        path.join(process.cwd(), "keys", "usdc-mint-authority.json"),
        "utf-8",
      ),
    ) as number[];
  } catch {
    throw new Error(
      "USDC mint authority not available. Set USDC_MINT_AUTHORITY_KEYPAIR env var or ensure keys/usdc-mint-authority.json exists.",
    );
  }
}

export async function ensureUserVaultInitialized(walletAddress: string) {
  const cluster = publicSpotrConfig.cluster;
  const rpcUrl = getSponsorRpcUrl(cluster);
  const playerAddr = address(walletAddress);
  const [vaultPda] = await findVaultPda({ player: playerAddr });
  if (await fetchAccountExists(rpcUrl, String(vaultPda))) {
    return { alreadyInitialized: true, signature: null as string | null };
  }

  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS;
  if (!usdcMint) {
    throw new Error("NEXT_PUBLIC_USDC_MINT_ADDRESS is not set.");
  }

  const sponsor = await loadSponsorSigner();
  const ix = await getInitUserVaultInstructionAsync({
    sponsor,
    owner: playerAddr,
    usdcMint: address(usdcMint),
  });

  const signature = await submitSponsoredTx(cluster, [ix]);
  const created = await waitForAccountExists(rpcUrl, String(vaultPda));
  if (!created) {
    throw new Error(`Vault PDA did not appear after init: ${vaultPda}`);
  }
  return { alreadyInitialized: false, signature };
}

export async function mintUsdcToVault(walletAddress: string, amountUsdcUnits: bigint) {
  const mintAddress = process.env.USDC_MINT_ADDRESS;
  if (!mintAddress) {
    throw new Error("USDC_MINT_ADDRESS env var not set.");
  }

  const cluster = publicSpotrConfig.cluster;
  const rpcUrl = getSponsorRpcUrl(cluster);
  const rpc = createSolanaRpc(rpcUrl);
  const authoritySigner = await createKeyPairSignerFromBytes(
    new Uint8Array(loadMintAuthorityBytes()),
  );
  const mintAddr = address(mintAddress);
  const walletAddr = address(walletAddress);
  const [vaultTokensPda] = await findVaultTokensPda({ player: walletAddr });

  const accountInfo = await rpc.getAccountInfo(vaultTokensPda, { encoding: "base64" }).send();
  if (!accountInfo.value) {
    throw new Error("Vault not initialized for this wallet.");
  }
  if (accountInfo.value.owner !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error(
      "Vault token account exists but is not owned by the SPL Token program.",
    );
  }

  const mintToIx = getMintToInstruction({
    mint: mintAddr,
    token: vaultTokensPda,
    mintAuthority: authoritySigner,
    amount: amountUsdcUnits,
  });

  const {
    value: { blockhash, lastValidBlockHeight },
  } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(authoritySigner, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight },
        m,
      ),
    (m) => appendTransactionMessageInstructions([mintToIx], m),
  );

  const signed = await signTransactionMessageWithSigners(message);
  const encoded = getBase64EncodedWireTransaction(signed);
  const sig = await rpc
    .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
    .send();

  const balance = await waitForTokenBalanceAtLeast(
    rpcUrl,
    String(vaultTokensPda),
    amountUsdcUnits,
  );
  if (balance < amountUsdcUnits) {
    throw new Error(
      `Vault token balance did not reach ${amountUsdcUnits.toString()} after mint; have ${balance.toString()}.`,
    );
  }

  return String(sig);
}
