import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";
import {
  getSpotrMarketsErrorMessage,
  SPOTR_MARKETS_ERROR__ALREADY_CLAIMED,
  SPOTR_MARKETS_ERROR__INSUFFICIENT_ESCROW,
  SPOTR_MARKETS_ERROR__INVALID_CONFIG,
  SPOTR_MARKETS_ERROR__INVALID_ROUND_INDEX,
  SPOTR_MARKETS_ERROR__MATH_OVERFLOW,
  SPOTR_MARKETS_ERROR__NOTHING_TO_CLAIM,
  SPOTR_MARKETS_ERROR__ROUND_ALREADY_ENTERED,
  SPOTR_MARKETS_ERROR__ROUND_CLOSED,
  SPOTR_MARKETS_ERROR__ROUND_STILL_OPEN,
  SPOTR_MARKETS_ERROR__SESSION_CLOSED,
  SPOTR_MARKETS_ERROR__SESSION_NOT_JOINABLE,
  SPOTR_MARKETS_ERROR__SESSION_NOT_LIVE,
  SPOTR_MARKETS_ERROR__SESSION_STILL_IN_PROGRESS,
  type SpotrMarketsError,
} from "../generated/spotr";

const SPOTR_ERROR_CODES: Record<number, SpotrMarketsError> = {
  [SPOTR_MARKETS_ERROR__ALREADY_CLAIMED]: SPOTR_MARKETS_ERROR__ALREADY_CLAIMED,
  [SPOTR_MARKETS_ERROR__INSUFFICIENT_ESCROW]:
    SPOTR_MARKETS_ERROR__INSUFFICIENT_ESCROW,
  [SPOTR_MARKETS_ERROR__INVALID_CONFIG]: SPOTR_MARKETS_ERROR__INVALID_CONFIG,
  [SPOTR_MARKETS_ERROR__INVALID_ROUND_INDEX]:
    SPOTR_MARKETS_ERROR__INVALID_ROUND_INDEX,
  [SPOTR_MARKETS_ERROR__MATH_OVERFLOW]: SPOTR_MARKETS_ERROR__MATH_OVERFLOW,
  [SPOTR_MARKETS_ERROR__NOTHING_TO_CLAIM]:
    SPOTR_MARKETS_ERROR__NOTHING_TO_CLAIM,
  [SPOTR_MARKETS_ERROR__ROUND_ALREADY_ENTERED]:
    SPOTR_MARKETS_ERROR__ROUND_ALREADY_ENTERED,
  [SPOTR_MARKETS_ERROR__ROUND_CLOSED]: SPOTR_MARKETS_ERROR__ROUND_CLOSED,
  [SPOTR_MARKETS_ERROR__ROUND_STILL_OPEN]:
    SPOTR_MARKETS_ERROR__ROUND_STILL_OPEN,
  [SPOTR_MARKETS_ERROR__SESSION_CLOSED]: SPOTR_MARKETS_ERROR__SESSION_CLOSED,
  [SPOTR_MARKETS_ERROR__SESSION_NOT_JOINABLE]:
    SPOTR_MARKETS_ERROR__SESSION_NOT_JOINABLE,
  [SPOTR_MARKETS_ERROR__SESSION_NOT_LIVE]:
    SPOTR_MARKETS_ERROR__SESSION_NOT_LIVE,
  [SPOTR_MARKETS_ERROR__SESSION_STILL_IN_PROGRESS]:
    SPOTR_MARKETS_ERROR__SESSION_STILL_IN_PROGRESS,
};

export function parseTransactionError(err: unknown): string {
  // Wallet rejection (comes from wallet-standard, not a SolanaError)
  if (err instanceof Error && err.message.includes("User rejected")) {
    return "Transaction was rejected by the wallet.";
  }

  // Anchor custom program errors — use the Codama-generated error messages.
  if (
    isSolanaError(err, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
    typeof err.context?.code === "number"
  ) {
    const spotrError = SPOTR_ERROR_CODES[err.context.code];
    if (spotrError !== undefined) {
      return getSpotrMarketsErrorMessage(spotrError);
    }
  }

  // For all other errors, walk the cause chain to find the deepest message.
  const message = getDeepestMessage(err);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

function getDeepestMessage(err: unknown): string {
  let deepest = err instanceof Error ? err.message : String(err);
  let current: unknown = err;

  while (current instanceof Error && current.cause) {
    current = current.cause;
    if (current instanceof Error) {
      deepest = current.message;
    }
  }

  return deepest;
}
