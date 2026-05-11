export const AUTO_FILL_BOT_SUPPORTED_CLUSTERS = ["localnet", "devnet"] as const;

export type AutoFillBotsConfig = {
  enabled: boolean;
  initialDelayMs: number;
  trickleDelayMs: number;
  workerLeaseMs: number;
  depositLamports: bigint;
  botWallets: string[];
};

const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function readCsv(raw: string | undefined) {
  if (!raw?.trim()) return [] as string[];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

type EnvMap = Record<string, string | undefined>;

function readInt(env: EnvMap, name: string, fallback: number, min: number) {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}.`);
  }
  return parsed;
}

export function readAutoFillBotsConfig(
  env: EnvMap = process.env
): AutoFillBotsConfig {
  const enabled =
    (env.SPOTR_AUTO_FILL_BOTS_ENABLED ?? "false").trim() === "true";
  const initialDelayMs = readInt(
    env,
    "SPOTR_AUTO_FILL_BOTS_INITIAL_DELAY_MS",
    3_000,
    0
  );
  const trickleDelayMs = readInt(
    env,
    "SPOTR_AUTO_FILL_BOTS_TRICKLE_DELAY_MS",
    1_200,
    0
  );
  const workerLeaseMs = readInt(
    env,
    "SPOTR_AUTO_FILL_BOTS_WORKER_LEASE_MS",
    120_000,
    1_000
  );
  const depositLamportsRaw =
    env.SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS ?? "1000000";
  if (!/^\d+$/.test(depositLamportsRaw)) {
    throw new Error(
      "SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS must be a positive integer."
    );
  }
  const depositLamports = BigInt(depositLamportsRaw);
  if (depositLamports < 1_000_000n) {
    throw new Error(
      "SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS must be at least 1000000."
    );
  }
  const botWallets = readCsv(env.SPOTR_AUTO_FILL_BOT_WALLETS);
  for (const wallet of botWallets) {
    if (!SOLANA_ADDRESS_PATTERN.test(wallet)) {
      throw new Error(`Invalid SPOTR_AUTO_FILL_BOT_WALLETS entry: ${wallet}`);
    }
  }
  if (enabled && botWallets.length === 0) {
    throw new Error(
      "SPOTR_AUTO_FILL_BOT_WALLETS must contain at least one wallet when bots are enabled."
    );
  }

  return {
    enabled,
    initialDelayMs,
    trickleDelayMs,
    workerLeaseMs,
    depositLamports,
    botWallets,
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
      params.cluster as (typeof AUTO_FILL_BOT_SUPPORTED_CLUSTERS)[number]
    ) &&
    params.actor === "player" &&
    params.previousStatus === "UPCOMING" &&
    params.newDepositsCount > params.previousDepositsCount &&
    params.newDepositsCount < params.fillThreshold
  );
}

export function shouldProcessAutoFillFromHeartbeat(params: {
  enabled: boolean;
  cluster: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return (
    params.enabled &&
    AUTO_FILL_BOT_SUPPORTED_CLUSTERS.includes(
      params.cluster as (typeof AUTO_FILL_BOT_SUPPORTED_CLUSTERS)[number]
    ) &&
    params.status === "UPCOMING" &&
    params.completedAt == null &&
    params.scheduledAt != null &&
    params.scheduledAt.getTime() <= now.getTime()
  );
}

export function shouldReturnMutationPayload(
  actor: "player" | "bot" | undefined,
  override?: boolean
) {
  return override ?? actor !== "bot";
}
