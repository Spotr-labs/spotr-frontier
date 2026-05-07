/**
 * Deploys the seed session on-chain for localnet dev.
 * Finds the most recent PENDING session with no chainSessionNumber,
 * submits create_session + create_round * N using the sponsor keypair,
 * then patches the DB row with the chain data.
 *
 * Called by dev-local.sh after seed-spotr.mjs.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
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
  type Address,
} from "@solana/kit";
import { getCreateSessionInstructionAsync } from "../app/generated/spotr/instructions/createSession";
import { getCreateRoundInstruction } from "../app/generated/spotr/instructions/createRound";
import { findConfigPda } from "../app/generated/spotr/pdas/config";
import { findSpotrSessionPda } from "../app/lib/chain/session-pda";
import { findSpotrRoundPda } from "../app/lib/chain/round-pda";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";

function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // Find the seeded PENDING session that hasn't been deployed on-chain yet.
    const session = await prisma.session.findFirst({
      where: { status: "PENDING", chainSessionNumber: null },
      orderBy: { createdAt: "desc" },
      include: {
        rounds: {
          orderBy: { roundIndex: "asc" },
          select: { roundIndex: true, pairId: true },
        },
      },
    });

    if (!session) {
      console.log("[deploy-session] ✓ no undeployed sessions — skipping");
      return;
    }

    console.log(`[deploy-session] deploying session ${session.id} on-chain …`);

    const rpc = createSolanaRpc(RPC_URL);
    const usdcMint = address(requireEnv("USDC_MINT_ADDRESS"));

    // Use the sponsor keypair (CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW)
    // as the on-chain authority — it's funded and in the config authorities.
    const sponsorBytes: number[] = JSON.parse(
      readFileSync(join(__dirname, "../keys/spotr-sponsor.json"), "utf-8"),
    );
    const authority = await createKeyPairSignerFromBytes(new Uint8Array(sponsorBytes));

    // Microsecond-resolution session number to avoid collisions across runs.
    const sessionNumber =
      BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

    const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
    const [configPda] = await findConfigPda();

    const roundDurationSeconds = BigInt(
      Number(process.env.NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS ?? 30),
    );
    const buyInUsdcUnits = BigInt(
      Number(process.env.NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS ?? 0),
    );
    const protocolFeeBps = Number(process.env.NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS ?? 350);
    const referralCutBps = Number(process.env.NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS ?? 5000);
    const roundCount = session.rounds.length;
    const roundFillThreshold = Number(
      process.env.NEXT_PUBLIC_SPOTR_ROUND_FILL_THRESHOLD ?? roundCount,
    );

    const startTs = BigInt(Math.floor(session.startsAt.getTime() / 1000));
    const endTs = BigInt(Math.floor(session.endsAt.getTime() / 1000));

    // Build the instruction list: create_session + create_round * N
    const createSessionIx = await getCreateSessionInstructionAsync({
      authority,
      session: sessionAddress as Address,
      usdcMint,
      sessionNumber,
      roundCount,
      roundDurationSeconds,
      buyInUsdcUnits,
      protocolFeeBps,
      referralCutBps,
      startTs,
      endTs,
      roundFillThreshold,
    });

    const roundIxs = await Promise.all(
      session.rounds.map(async (round) => {
        const [roundAddress] = await findSpotrRoundPda({
          session: sessionAddress as Address,
          index: round.roundIndex,
        });
        const pairIdBytes = new Uint8Array(32);
        pairIdBytes.set(new TextEncoder().encode(round.pairId).slice(0, 32));
        return getCreateRoundInstruction({
          authority,
          session: sessionAddress as Address,
          round: roundAddress as Address,
          index: round.roundIndex,
          pairId: pairIdBytes,
        });
      }),
    );

    const {
      value: { blockhash, lastValidBlockHeight },
    } = await rpc.getLatestBlockhash().send();

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(authority, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash, lastValidBlockHeight },
          m,
        ),
      (m) => appendTransactionMessageInstructions([createSessionIx, ...roundIxs], m),
    );

    const signed = await signTransactionMessageWithSigners(message);
    const encoded = getBase64EncodedWireTransaction(signed);
    const signature = await rpc
      .sendTransaction(encoded, { encoding: "base64", skipPreflight: false })
      .send();

    const txSignature = String(signature);
    const sessionAddr = String(sessionAddress);

    await prisma.session.update({
      where: { id: session.id },
      data: {
        chainSessionNumber: sessionNumber,
        chainSessionAddress: sessionAddr,
        chainDeployTxSignature: txSignature,
      },
    });

    console.log(`[deploy-session] ✓ create_session: ${txSignature}`);
    console.log(`[deploy-session] ✓ session PDA:    ${sessionAddr}`);
    console.log(`[deploy-session] ✓ session number: ${sessionNumber}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[deploy-session] ✗", err.message ?? err);
  process.exit(1);
});
