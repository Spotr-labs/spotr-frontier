import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const faultLineSeeds = JSON.parse(
  readFileSync(path.join(__dirname, "../data/fault-line-catalog.json"), "utf8")
);

function readString(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function readInt(name) {
  const raw = readString(name);
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Env var ${name} must be an integer`);
  }
  return value;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildSessionBounds(launchIso, endHourUtc) {
  const startsAt = new Date(launchIso);
  const endsAt = new Date(startsAt);
  endsAt.setUTCHours(endHourUtc, 0, 0, 0);
  if (endsAt <= startsAt) {
    endsAt.setUTCDate(endsAt.getUTCDate() + 1);
  }
  return { startsAt, endsAt };
}

async function main() {
  const config = {
    seasonLabel: readString("NEXT_PUBLIC_SPOTR_SEASON_LABEL"),
    launchIso: readString("NEXT_PUBLIC_SPOTR_LAUNCH_ISO"),
    sessionBuyInLamports: BigInt(
      readInt("NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS")
    ),
    roundCount: readInt("NEXT_PUBLIC_SPOTR_ROUND_COUNT"),
    roundDurationSeconds: readInt("NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS"),
    protocolFeeBps: readInt("NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS"),
    referralCutBps: readInt("NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS"),
    defaultSessionEndHourUtc: readInt(
      "NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC"
    ),
    payoutCadenceDays: readInt("NEXT_PUBLIC_SPOTR_PAYOUT_CADENCE_DAYS"),
    cardRewardSlots: readInt("NEXT_PUBLIC_SPOTR_CARD_REWARD_SLOTS"),
  };

  if (faultLineSeeds.length < config.roundCount) {
    throw new Error("Not enough fault-line seeds for the configured round count");
  }

  for (const pair of faultLineSeeds) {
    await prisma.faultLinePair.upsert({
      where: { slug: pair.slug },
      update: {
        category: pair.category,
        sideA: pair.sideA,
        sideB: pair.sideB,
        defaultSideAPct: pair.sideAPct,
        defaultSideBPct: pair.sideBPct,
        crowdLabel: pair.crowdLabel,
        active: true,
      },
      create: {
        slug: pair.slug,
        category: pair.category,
        sideA: pair.sideA,
        sideB: pair.sideB,
        defaultSideAPct: pair.sideAPct,
        defaultSideBPct: pair.sideBPct,
        crowdLabel: pair.crowdLabel,
        active: true,
      },
    });
  }

  const activePairs = await prisma.faultLinePair.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    take: config.roundCount,
  });

  const { startsAt, endsAt } = buildSessionBounds(
    config.launchIso,
    config.defaultSessionEndHourUtc
  );
  const sessionSlug = `${slugify(config.seasonLabel)}-${startsAt
    .toISOString()
    .slice(0, 10)}`;

  const existingSession = await prisma.session.findUnique({
    where: { slug: sessionSlug },
  });

  let sessionId = existingSession?.id;
  if (!existingSession) {
    const created = await prisma.session.create({
      data: {
        slug: sessionSlug,
        title: `${config.seasonLabel} launch session`,
        seasonLabel: config.seasonLabel,
        status: "PENDING",
        launchIso: new Date(config.launchIso),
        startsAt,
        endsAt,
        roundCount: config.roundCount,
        roundDurationSeconds: config.roundDurationSeconds,
        buyInLamports: config.sessionBuyInLamports,
        protocolFeeBps: config.protocolFeeBps,
        referralCutBps: config.referralCutBps,
        cardRewardSlots: config.cardRewardSlots,
        payoutCadenceDays: config.payoutCadenceDays,
      },
    });
    sessionId = created.id;
  }

  const participantCount = await prisma.sessionParticipant.count({
    where: { sessionId },
  });

  if (participantCount === 0) {
    await prisma.transactionLog.deleteMany({
      where: { sessionId },
    });
    await prisma.roundPosition.deleteMany({
      where: {
        round: { sessionId },
      },
    });
    await prisma.sessionRound.deleteMany({
      where: { sessionId },
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        title: `${config.seasonLabel} launch session`,
        seasonLabel: config.seasonLabel,
        status: "PENDING",
        launchIso: new Date(config.launchIso),
        startsAt,
        endsAt,
        activatedAt: null,
        completedAt: null,
        roundCount: config.roundCount,
        roundDurationSeconds: config.roundDurationSeconds,
        buyInLamports: config.sessionBuyInLamports,
        protocolFeeBps: config.protocolFeeBps,
        referralCutBps: config.referralCutBps,
        joinedWallets: 0,
        totalEscrowLamports: 0n,
        protocolFeeAccruedLamports: 0n,
        cardRewardSlots: config.cardRewardSlots,
        payoutCadenceDays: config.payoutCadenceDays,
      },
    });

    await prisma.sessionRound.createMany({
      data: activePairs.map((pair, index) => {
        const seed = faultLineSeeds[index];
        return {
          sessionId,
          pairId: pair.id,
          roundIndex: index,
          status: "UPCOMING",
          sideAProbabilityPct: seed.sideAPct,
          sideBProbabilityPct: seed.sideBPct,
        };
      }),
    });
  }

  const counts = {
    sessionId,
    pairs: await prisma.faultLinePair.count(),
    rounds: await prisma.sessionRound.count({ where: { sessionId } }),
    participants: await prisma.sessionParticipant.count({ where: { sessionId } }),
  };

  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
