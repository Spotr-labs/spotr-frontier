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

export const dynamic = "force-dynamic";

const CLUSTER = process.env.NEXT_PUBLIC_SPOTR_CLUSTER ?? "localnet";
const RPC_URL =
  CLUSTER === "localnet" ? "http://127.0.0.1:8899" : null;

const SOL_AIRDROP_CAP = 10;
const USDC_AIRDROP_CAP = 10_000;

export async function POST(request: Request) {
  if (CLUSTER !== "localnet" || !RPC_URL) {
    return NextResponse.json(
      { error: "Airdrop is only available on localnet." },
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
    const sol = Math.min(Number(amount) || 2, SOL_AIRDROP_CAP);
    const sig = await rpc
      .requestAirdrop(walletAddr, lamports(BigInt(Math.floor(sol * 1e9))))
      .send();
    return NextResponse.json({ signature: String(sig) });
  }

  // ── USDC (mocked SPL token) ──────────────────────────────────────────────
  if (type === "usdc") {
    const mintAddress = process.env.USDC_MINT_ADDRESS;
    if (!mintAddress) {
      return NextResponse.json(
        { error: "USDC_MINT_ADDRESS env var not set. Start with npm run dev:local." },
        { status: 500 }
      );
    }

    const authKeyPath = path.join(process.cwd(), "keys", "usdc-mint-authority.json");
    let authorityBytes: number[];
    try {
      authorityBytes = JSON.parse(readFileSync(authKeyPath, "utf-8")) as number[];
    } catch {
      return NextResponse.json(
        { error: "Could not read mint authority keypair from /keys/." },
        { status: 500 }
      );
    }

    const authoritySigner = await createKeyPairSignerFromBytes(
      new Uint8Array(authorityBytes)
    );
    const mintAddr = address(mintAddress);

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
  }

  return NextResponse.json(
    { error: `Unknown type: ${type}. Use 'sol' or 'usdc'.` },
    { status: 400 }
  );
}
