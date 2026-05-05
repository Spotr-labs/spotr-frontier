import "server-only";

import { PrivyClient } from "@privy-io/server-auth";

let cachedClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (cachedClient) return cachedClient;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "Privy is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.",
    );
  }
  cachedClient = new PrivyClient(appId, appSecret);
  return cachedClient;
}

export class PrivyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivyAuthError";
  }
}

function extractAccessToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header) {
    const stripped = header.replace(/^Bearer\s+/i, "").trim();
    if (stripped) return stripped;
  }
  // Privy's React SDK also writes the access token as a cookie when
  // configured to do so; fall back to it for browsers that strip the
  // Authorization header during fetch retries.
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)privy-token=([^;]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  throw new PrivyAuthError("Missing Privy access token.");
}

/**
 * Verifies the Privy access token from the request and returns the user's
 * Solana wallet address. Throws PrivyAuthError if the token is invalid, the
 * user has no linked Solana wallet, or Privy is not configured.
 */
export async function getPlayerWalletFromRequest(
  request: Request,
): Promise<string> {
  const privy = getPrivyClient();
  const token = extractAccessToken(request);

  let claims;
  try {
    claims = await privy.verifyAuthToken(token);
  } catch (err) {
    throw new PrivyAuthError(
      `Privy auth token failed verification: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const user = await privy.getUser(claims.userId);
  const wallet = user.linkedAccounts.find(
    (account) =>
      account.type === "wallet" &&
      "chainType" in account &&
      account.chainType === "solana" &&
      typeof account.address === "string",
  ) as { address: string } | undefined;

  if (!wallet?.address) {
    throw new PrivyAuthError("Privy user has no linked Solana wallet.");
  }

  return wallet.address;
}
