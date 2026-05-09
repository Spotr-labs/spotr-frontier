// Thin shim around the unified classifier in `./solana-errors`. The original
// `classifyTxError` shape (`{ rejected, message }`) is preserved so existing
// call sites — primarily the toast handlers in `spotr-shell.tsx` and the
// admin dialogs — keep compiling. New code should import the structured
// `classifySolanaError` (or `formatSolanaErrorForToast`) directly.

import {
  classifySolanaError,
  isWalletRejection,
} from "./solana-errors";

export type TxErrorClass = {
  rejected: boolean;
  message: string;
};

/**
 * @deprecated Use `formatSolanaErrorForToast` (returns a `{ title, message,
 *             kind }` triple) or the full `classifySolanaError` report.
 */
export function classifyTxError(error: unknown): TxErrorClass {
  const report = classifySolanaError(error);
  return {
    rejected: report.category === "wallet_rejected",
    message: report.hint ? `${report.message} ${report.hint}` : report.message,
  };
}

export { isWalletRejection };
