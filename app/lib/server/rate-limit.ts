import "server-only";

type Bucket = {
  tokens: number;
  updatedAt: number;
};

const BUCKETS = new Map<string, Bucket>();
const MAX_BUCKETS = 4096;

function prune(now: number) {
  if (BUCKETS.size < MAX_BUCKETS) return;
  for (const [key, bucket] of BUCKETS) {
    if (now - bucket.updatedAt > 60_000) {
      BUCKETS.delete(key);
    }
  }
}

export type RateLimitOptions = {
  /** Maximum tokens in the bucket (burst size). */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
};

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Token-bucket rate limiter. Call `consume` with a stable caller key (typically
 * wallet address + route). Throws `RateLimitError` when the bucket is empty.
 */
export function consumeRateLimitToken(
  key: string,
  options: RateLimitOptions
): void {
  const now = Date.now();
  prune(now);

  const bucket = BUCKETS.get(key);
  const capacity = Math.max(1, options.capacity);
  const refillPerMs = options.refillPerSecond / 1000;

  if (!bucket) {
    BUCKETS.set(key, { tokens: capacity - 1, updatedAt: now });
    return;
  }

  const elapsed = now - bucket.updatedAt;
  const refill = elapsed * refillPerMs;
  const tokens = Math.min(capacity, bucket.tokens + refill);

  if (tokens < 1) {
    throw new RateLimitError("Too many requests. Please slow down.");
  }

  bucket.tokens = tokens - 1;
  bucket.updatedAt = now;
}

/**
 * Default policy for signed-write endpoints: 10 requests per minute with a
 * burst of 5. Protects the join / enter / claim routes from replay spam.
 */
export function consumeSignedActionToken(walletAddress: string, route: string) {
  consumeRateLimitToken(`${route}:${walletAddress}`, {
    capacity: 5,
    refillPerSecond: 10 / 60,
  });
}
