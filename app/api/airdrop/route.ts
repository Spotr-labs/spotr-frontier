import "server-only";
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  address,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { findVaultTokensPda } from "../../generated/spotr/pdas/vaultTokens";

export const dynamic = "force-dynamic";

const CLUSTER = process.env.NEXT_PUBLIC_SPOTR_CLUSTER ?? "localnet";
const RPC_URLS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
};
const RPC_URL = RPC_URLS[CLUSTER] ?? null;

// Private RPCs don't implement requestAirdrop — always use the public endpoint for SOL drops.
const FAUCET_RPC_URLS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
};
const FAUCET_RPC_URL = FAUCET_RPC_URLS[CLUSTER] ?? null;

const SOL_AIRDROP_CAP = 10;
const USDC_AIRDROP_CAP = 10_000;

function loadMintAuthorityBytes(): number[] {
  const fromEnv = process.env.USDC_MINT_AUTHORITY_KEYPAIR;
  if (fromEnv) return JSON.parse(fromEnv) as number[];
  try {
    return JSON.parse(
      readFileSync(path.join(process.cwd(), "keys", "usdc-mint-authority.json"), "utf-8")
    ) as number[];
  } catch {
    throw new Error(
      "USDC mint authority not available. Set USDC_MINT_AUTHORITY_KEYPAIR env var or ensure keys/usdc-mint-authority.json exists."
    );
  }
}

export async function POST(request: Request) {
  if (CLUSTER === "mainnet" || !RPC_URL) {
    return NextResponse.json(
      { error: "Airdrop is not available on mainnet." },
      { status: 403 }
    );
  }

  let body: { wallet?: string; type?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { wallet, type, amount } = body;
  if (!wallet || !type) {
    return NextResponse.json(
      { error: "Missing required fields: wallet, type." },
      { status: 400 }
    );
  }

  const walletAddr = address(wallet);
  const rpc = createSolanaRpc(RPC_URL);

  // ── SOL ─────────────────────────────────────────────────────────────────
  if (type === "sol") {
    if (!FAUCET_RPC_URL) {
      return NextResponse.json({ error: "SOL airdrop not available on this cluster." }, { status: 403 });
    }
    const sol = Math.min(Number(amount) || 2, SOL_AIRDROP_CAP);
    try {
      const faucetRpc = createSolanaRpc(FAUCET_RPC_URL);
      const sig = await faucetRpc
        .requestAirdrop(walletAddr, lamports(BigInt(Math.floor(sol * 1e9))))
        .send();
      return NextResponse.json({ signature: String(sig) });
    } catch (e) {
      const ctx = (e as { context?: { statusCode?: number; headers?: Headers } })?.context;
      if (ctx?.statusCode === 429) {
        const retryAfter = ctx.headers?.get?.("retry-after") ?? null;
        return NextResponse.json(
          {
            error:
              "Devnet faucet rate-limited this wallet/IP. Use the web faucet at https://faucet.solana.com instead.",
            retryAfterSeconds: retryAfter ? Number(retryAfter) : null,
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "SOL airdrop failed." },
        { status: 500 }
      );
    }
  }

  // ── USDC (mocked SPL token) ──────────────────────────────────────────────
  if (type === "usdc") {
    const mintAddress = process.env.USDC_MINT_ADDRESS;
    if (!mintAddress) {
      return NextResponse.json(
        { error: "USDC_MINT_ADDRESS env var not set." },
        { status: 500 }
      );
    }

    try {
      let authorityBytes: number[];
      try {
        authorityBytes = loadMintAuthorityBytes();
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Could not load mint authority." },
          { status: 500 }
        );
      }

      const authoritySigner = await createKeyPairSignerFromBytes(
        new Uint8Array(authorityBytes)
      );
      const mintAddr = address(mintAddress);

      const authorityBalance = await rpc.getBalance(authoritySigner.address).send();
      if (authorityBalance.value < 5_000_000n) {
        return NextResponse.json(
          {
            error: `Mint authority ${authoritySigner.address} is out of SOL on devnet (balance ${authorityBalance.value} lamports). Fund it via https://faucet.solana.com so it can pay tx fees.`,
          },
          { status: 500 }
        );
      }

      const [ata] = await findAssociatedTokenPda({
        owner: walletAddr,
        mint: mintAddr,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      const usdc = Math.min(Number(amount) || 1_000, USDC_AIRDROP_CAP);
      const rawAmount = BigInt(Math.floor(usdc * 1e6));

      const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
        payer: authoritySigner,
        owner: walletAddr,
        ata,
        mint: mintAddr,
      });
      const mintToIx = getMintToInstruction({
        mint: mintAddr,
        token: ata,
        mintAuthority: authoritySigner,
        amount: rawAmount,
      });

      const { value: { blockhash, lastValidBlockHeight } } =
        await rpc.getLatestBlockhash().send();

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(authoritySigner, m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash, lastValidBlockHeight },
            m
          ),
        (m) => appendTransactionMessageInstructions([createAtaIx, mintToIx], m)
      );

      const signed = await signTransactionMessageWithSigners(message);
      const encoded = getBase64EncodedWireTransaction(signed);

      const sig = await rpc
        .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
        .send();

      return NextResponse.json({ signature: String(sig) });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "USDC airdrop failed." },
        { status: 500 }
      );
    }
  }

  // ── USDC → program vault (mints into the user_vault_tokens PDA) ─────────
  if (type === "usdc-vault") {
    const mintAddress = process.env.USDC_MINT_ADDRESS;
    if (!mintAddress) {
      return NextResponse.json(
        { error: "USDC_MINT_ADDRESS env var not set." },
        { status: 500 }
      );
    }

    try {
      let authorityBytes: number[];
      try {
        authorityBytes = loadMintAuthorityBytes();
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Could not load mint authority." },
          { status: 500 }
        );
      }

      const authoritySigner = await createKeyPairSignerFromBytes(
        new Uint8Array(authorityBytes)
      );
      const mintAddr = address(mintAddress);

      const authorityBalance = await rpc.getBalance(authoritySigner.address).send();
      if (authorityBalance.value < 5_000_000n) {
        return NextResponse.json(
          {
            error: `Mint authority ${authoritySigner.address} is out of SOL on devnet (balance ${authorityBalance.value} lamports). Fund it via https://faucet.solana.com so it can pay tx fees.`,
          },
          { status: 500 }
        );
      }

      const [vaultTokensPda] = await findVaultTokensPda({ player: walletAddr });

      const accountInfo = await rpc
        .getAccountInfo(vaultTokensPda, { encoding: "base64" })
        .send();
      if (!accountInfo.value) {
        return NextResponse.json(
          { error: "Vault not initialized for this wallet." },
          { status: 400 }
        );
      }
      if (accountInfo.value.owner !== TOKEN_PROGRAM_ADDRESS) {
        return NextResponse.json(
          { error: "Vault token account exists but is not owned by the SPL Token program." },
          { status: 400 }
        );
      }

      const usdc = Math.min(Number(amount) || 1_000, USDC_AIRDROP_CAP);
      const rawAmount = BigInt(Math.floor(usdc * 1e6));

      const mintToIx = getMintToInstruction({
        mint: mintAddr,
        token: vaultTokensPda,
        mintAuthority: authoritySigner,
        amount: rawAmount,
      });

      const { value: { blockhash, lastValidBlockHeight } } =
        await rpc.getLatestBlockhash().send();

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(authoritySigner, m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash, lastValidBlockHeight },
            m
          ),
        (m) => appendTransactionMessageInstructions([mintToIx], m)
      );

      const signed = await signTransactionMessageWithSigners(message);
      const encoded = getBase64EncodedWireTransaction(signed);

      const sig = await rpc
        .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
        .send();

      return NextResponse.json({ signature: String(sig) });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "USDC-vault airdrop failed." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: `Unknown type: ${type}. Use 'sol', 'usdc', or 'usdc-vault'.` },
    { status: 400 }
  );
}
