/**
 * Fills an UPCOMING round to its deposit threshold using synthetic
 * test wallets through the same shared bot runner used by the app.
 *
 * Usage:
 *   npx tsx scripts/fill-round.ts
 *   npx tsx scripts/fill-round.ts --round 2
 *   SPOTR_ENV_FILE=.env.devnet npx tsx scripts/fill-round.ts --round 2
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { fillRoundWithBots } from "../app/lib/server/auto-fill-bots";
import { readAutoFillBotsConfig } from "../app/lib/server/auto-fill-bots.shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFileIfNeeded() {
  if (process.env.DATABASE_URL) return;

  const envFile = process.env.SPOTR_ENV_FILE?.trim() || ".env.local";
  const fullPath = join(__dirname, "..", envFile);
  if (!existsSync(fullPath)) return;

  const contents = readFileSync(fullPath, "utf-8");
  for (const line of contents.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }
}

loadEnvFileIfNeeded();

const roundIndexArg = process.argv.indexOf("--round");
const targetRoundIndex =
  roundIndexArg !== -1 ? Number(process.argv[roundIndexArg + 1]) : 0;

async function main() {
  const prisma = new PrismaClient();
  const config = readAutoFillBotsConfig();

  try {
    const round = await prisma.sessionRound.findFirst({
      where: { roundIndex: targetRoundIndex },
      include: { session: { select: { roundFillThreshold: true } } },
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
      `Filling round ${targetRoundIndex}: ${already}/${threshold} deposits, adding ${needed} synthetic wallets…`,
    );

    await fillRoundWithBots({
      roundId: round.id,
      trickleDelayMs: config.trickleDelayMs,
      depositLamports: config.depositLamports,
    });

    const updated = await prisma.sessionRound.findUnique({ where: { id: round.id } });
    console.log(
      `\nRound ${targetRoundIndex} status: ${updated?.status} (${updated?.depositsCount}/${threshold} deposits)`,
    );
    if (updated?.status === "OPEN") {
      console.log("✓ Round is now OPEN — predict screen will appear in the browser.");
    } else {
      console.log("⚠  Round is still not OPEN — check server logs for bot fill errors.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
