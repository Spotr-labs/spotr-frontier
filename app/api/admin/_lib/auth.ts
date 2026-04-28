import "server-only";

import { isValidSolanaAddress } from "../../../lib/server/signed-action";
import { serverSpotrConfig } from "../../../lib/spotr-config/server";

export class AdminAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export function requireAdminWalletFromUrl(request: Request): string {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet) {
    throw new AdminAuthError("Missing ?wallet= query parameter.");
  }
  if (!isValidSolanaAddress(wallet)) {
    throw new AdminAuthError("Wallet address is not a valid Solana address.");
  }
  if (!serverSpotrConfig.adminWallets.includes(wallet)) {
    throw new AdminAuthError("Wallet is not configured for admin access.");
  }
  return wallet;
}
