/**
 * Fills the first UPCOMING round to its deposit threshold using synthetic
 * test wallets. Each wallet goes through the full localnet flow:
 *   init-vault → usdc-vault airdrop → join session → deposit for round
 *
 * All on-chain fees are paid by the sponsor; test wallets need no SOL.
 * Use when testing the deposit → wait → predict transition with threshold > 1.
 *
 * Usage (while pnpm dev:local is running):
 *   npx tsx scripts/fill-round.ts
 *   npx tsx scripts/fill-round.ts --round 2   # fill a specific round index
 */
import { generateKeyPairSigner } from "@solana/kit";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env.local and hard-override DATABASE_URL so Prisma hits local postgres,
// not the cloud DB that Prisma auto-loads from .env.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envLocal = readFileSync(join(__dirname, "../.env.local"), "utf-8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const BASE_URL = process.env.FILL_ROUND_BASE_URL ?? "http://localhost:3000";
const USDC_PER_DEPOSIT = 10; // 10 USDC per test deposit
const DEPOSIT_MICRO_USDC = USDC_PER_DEPOSIT * 1_000_000;

const roundIndexArg = process.argv.indexOf("--round");
const targetRoundIndex =
  roundIndexArg !== -1 ? Number(process.argv[roundIndexArg + 1]) : 0;

async function post(
  path: string,
  body: unknown,
  walletAddress?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (walletAddress) headers["X-Dev-Wallet"] = walletAddress;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}: ${json.error ?? "unknown error"}`);
  }
  return json;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const round = await prisma.sessionRound.findFirst({
      where: { roundIndex: targetRoundIndex },
      include: { session: { select: { id: true, roundFillThreshold: true } } },
    });

    if (!round) {
      console.error(`No round with index ${targetRoundIndex} found in the DB.`);
      process.exit(1);
    }

    const threshold = round.session.roundFillThreshold;
    const already = round.depositsCount;
    const needed = threshold - already;

    if (needed <= 0) {
      console.log(
        `Round ${targetRoundIndex} already has ${already}/${threshold} deposits — nothing to do.`,
      );
      return;
    }

    console.log(
      `Filling round ${targetRoundIndex}: ${already}/${threshold} deposits, adding ${needed} test wallets…`,
    );

    for (let i = 0; i < needed; i++) {
      const signer = await generateKeyPairSigner();
      const wallet = String(signer.address);

      process.stdout.write(`  [${i + 1}/${needed}] ${wallet.slice(0, 12)}…  `);

      // 1. Init vault on-chain
      await fetch(`${BASE_URL}/api/airdrop/init-vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      }).then(async (r) => {
        const j = (await r.json()) as { error?: string; alreadyInitialized?: boolean };
        if (!r.ok && !j.alreadyInitialized) throw new Error(`init-vault: ${j.error}`);
      });
      process.stdout.write("vault ✓  ");

      // 2. Airdrop USDC directly into the vault token account
      await post("/api/airdrop", { wallet, type: "usdc-vault", amount: USDC_PER_DEPOSIT + 50 });
      process.stdout.write("usdc ✓  ");

      // 3. Join session
      await post("/api/session/join", { referrerWallet: null, sessionId: round.sessionId }, wallet);
      process.stdout.write("join ✓  ");

      // 4. Deposit for round
      await post(
        "/api/rounds/deposit",
        { roundId: round.id, amountLamports: DEPOSIT_MICRO_USDC },
        wallet,
      );
      process.stdout.write("deposit ✓\n");
      // Pause so the browser can pick up each deposit one at a time.
      await new Promise((r) => setTimeout(r, 1_200));
    }

    // Re-query to confirm status flipped
    const updated = await prisma.sessionRound.findUnique({ where: { id: round.id } });
    console.log(
      `\nRound ${targetRoundIndex} status: ${updated?.status} (${updated?.depositsCount}/${threshold} deposits)`,
    );
    if (updated?.status === "OPEN") {
      console.log("✓ Round is now OPEN — predict screen will appear in the browser.");
    } else {
      console.log("⚠  Round is still UPCOMING — check server logs for errors.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n✗", err.message ?? err);
  process.exit(1);
});
