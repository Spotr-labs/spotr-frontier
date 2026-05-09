// Thin shim around the unified classifier in `app/lib/wallet/solana-errors.ts`.
// Kept so that any caller still importing `parseTransactionError` from
// `app/lib/errors` continues to work. New code should import
// `classifySolanaError` (or one of the surface helpers) directly.

import {
  classifySolanaError,
  formatSolanaErrorForToast,
  formatSolanaErrorForApi,
  isWalletRejection,
  SolanaTxError,
  toSolanaTxError,
} from "./wallet/solana-errors";

/**
 * @deprecated Use `classifySolanaError` from `lib/wallet/solana-errors`
 *             (returns a structured report). This shim is preserved only so
 *             call sites that have not been migrated yet keep compiling.
 */
export function parseTransactionError(err: unknown): string {
  return classifySolanaError(err).message;
}

export {
  classifySolanaError,
  formatSolanaErrorForToast,
  formatSolanaErrorForApi,
  isWalletRejection,
  SolanaTxError,
  toSolanaTxError,
};
