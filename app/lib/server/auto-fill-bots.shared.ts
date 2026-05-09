export const AUTO_FILL_BOT_SUPPORTED_CLUSTERS = ["localnet", "devnet"] as const;

export type AutoFillBotsConfig = {
  enabled: boolean;
  initialDelayMs: number;
  trickleDelayMs: number;
  depositLamports: bigint;
};

type EnvMap = Record<string, string | undefined>;

function readInt(
  env: EnvMap,
  name: string,
  fallback: number,
  min: number,
) {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}.`);
  }
  return parsed;
}

export function readAutoFillBotsConfig(
  env: EnvMap = process.env,
): AutoFillBotsConfig {
  const enabled = (env.SPOTR_AUTO_FILL_BOTS_ENABLED ?? "false").trim() === "true";
  const initialDelayMs = readInt(
    env,
    "SPOTR_AUTO_FILL_BOTS_INITIAL_DELAY_MS",
    3_000,
    0,
  );
  const trickleDelayMs = readInt(
    env,
    "SPOTR_AUTO_FILL_BOTS_TRICKLE_DELAY_MS",
    1_200,
    0,
  );
  const depositLamportsRaw =
    env.SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS ?? "1000000";
  if (!/^\d+$/.test(depositLamportsRaw)) {
    throw new Error("SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS must be a positive integer.");
  }
  const depositLamports = BigInt(depositLamportsRaw);
  if (depositLamports < 1_000_000n) {
    throw new Error(
      "SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS must be at least 1000000.",
    );
  }

  return {
    enabled,
    initialDelayMs,
    trickleDelayMs,
    depositLamports,
  };
}

export function shouldScheduleAutoFill(params: {
  enabled: boolean;
  cluster: string;
  actor: "player" | "bot";
  previousStatus: string;
  previousDepositsCount: number;
  newDepositsCount: number;
  fillThreshold: number;
}) {
  return (
    params.enabled &&
    AUTO_FILL_BOT_SUPPORTED_CLUSTERS.includes(
      params.cluster as (typeof AUTO_FILL_BOT_SUPPORTED_CLUSTERS)[number],
    ) &&
    params.actor === "player" &&
    params.previousStatus === "UPCOMING" &&
    params.previousDepositsCount === 0 &&
    params.newDepositsCount === 1 &&
    params.newDepositsCount < params.fillThreshold
  );
}
