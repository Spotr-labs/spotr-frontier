const INTEGER_PATTERN = /^-?\d+$/;

type NumberOptions = {
  min?: number;
  max?: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Define it in spotr/.env or override it in spotr/.env.local. See spotr/.env.example for the expected shape.`
    );
  }
  return value;
}

export function readStringEnv(name: string): string {
  return requireEnv(name).trim();
}

export function readEnumEnv<T extends string>(
  name: string,
  allowed: readonly T[]
): T {
  const value = readStringEnv(name) as T;
  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid ${name}: expected one of ${allowed.join(", ")}, received ${value}`
    );
  }
  return value;
}

export function readIntegerEnv(name: string, options: NumberOptions = {}) {
  const value = requireEnv(name).trim();
  if (!INTEGER_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}: expected an integer, received ${value}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${name}: ${value} is outside the safe integer range`);
  }
  if (options.min != null && parsed < options.min) {
    throw new Error(`Invalid ${name}: expected >= ${options.min}, received ${parsed}`);
  }
  if (options.max != null && parsed > options.max) {
    throw new Error(`Invalid ${name}: expected <= ${options.max}, received ${parsed}`);
  }

  return parsed;
}

export function readCsvEnv(name: string) {
  const raw = process.env[name]?.trim() ?? "";
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
