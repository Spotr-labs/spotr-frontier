import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, "..");
const { loadEnvConfig } = nextEnv;

loadEnvConfig(projectDir);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Define it in spotr/.env or override it in spotr/.env.local. See spotr/.env.example for the expected shape.`
    );
  }
  return value;
}

const publicConfig = {
  appName: requireEnv("NEXT_PUBLIC_SPOTR_APP_NAME"),
  seasonLabel: requireEnv("NEXT_PUBLIC_SPOTR_SEASON_LABEL"),
  cluster: requireEnv("NEXT_PUBLIC_SPOTR_CLUSTER"),
  launchIso: requireEnv("NEXT_PUBLIC_SPOTR_LAUNCH_ISO"),
  sessionMinWallets: Number(requireEnv("NEXT_PUBLIC_SPOTR_SESSION_MIN_WALLETS")),
  sessionMinTotalLamports: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_SESSION_MIN_TOTAL_LAMPORTS")
  ),
  sessionBuyInLamports: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS")
  ),
  roundCount: Number(requireEnv("NEXT_PUBLIC_SPOTR_ROUND_COUNT")),
  roundDurationSeconds: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS")
  ),
  protocolFeeBps: Number(requireEnv("NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS")),
  referralCutBps: Number(requireEnv("NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS")),
  defaultSessionStartHourUtc: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_START_HOUR_UTC")
  ),
  defaultSessionEndHourUtc: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC")
  ),
  lowPairAlertThreshold: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_LOW_PAIR_ALERT_THRESHOLD")
  ),
  payoutCadenceDays: Number(requireEnv("NEXT_PUBLIC_SPOTR_PAYOUT_CADENCE_DAYS")),
  minPaidSessionsForReferral: Number(
    requireEnv("NEXT_PUBLIC_SPOTR_MIN_PAID_SESSIONS_FOR_REFERRAL")
  ),
  convictionHoldMs: Number(requireEnv("NEXT_PUBLIC_SPOTR_CONVICTION_HOLD_MS")),
  cardRewardSlots: Number(requireEnv("NEXT_PUBLIC_SPOTR_CARD_REWARD_SLOTS")),
  privyAppId: requireEnv("NEXT_PUBLIC_PRIVY_APP_ID"),
};

const output = `import type { SpotrPublicConfig } from "../spotr-types";

export const generatedPublicSpotrConfig: SpotrPublicConfig = ${JSON.stringify(
  publicConfig,
  null,
  2
)};
`;

const outputPath = path.join(
  projectDir,
  "app/lib/spotr-config/public.generated.ts"
);

await fs.writeFile(outputPath, output);
