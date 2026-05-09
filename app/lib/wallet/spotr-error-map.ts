// Friendly mapping for every Spotr program error. Keys are the
// `SPOTR_MARKETS_ERROR__*` constants from the Codama-generated module
// (`app/generated/spotr/errors/spotrMarkets.ts`), so adding a new error in
// the program — and re-running codama — will produce a TypeScript error
// here until this file picks the new constant up.
//
// Source of truth for the underlying error semantics:
// `anchor/programs/spotr_markets/src/lib.rs` (#[error_code] enum).

import {
  SPOTR_MARKETS_ERROR__ALREADY_CLAIMED,
  SPOTR_MARKETS_ERROR__DEPOSIT_ALREADY_EXISTS,
  SPOTR_MARKETS_ERROR__DEPOSIT_ALREADY_USED,
  SPOTR_MARKETS_ERROR__INSUFFICIENT_ESCROW,
  SPOTR_MARKETS_ERROR__INSUFFICIENT_TREASURY_BALANCE,
  SPOTR_MARKETS_ERROR__INSUFFICIENT_VAULT_BALANCE,
  SPOTR_MARKETS_ERROR__INVALID_CONFIG,
  SPOTR_MARKETS_ERROR__INVALID_ENTRY_INDEX,
  SPOTR_MARKETS_ERROR__INVALID_MINT,
  SPOTR_MARKETS_ERROR__INVALID_ROUND_INDEX,
  SPOTR_MARKETS_ERROR__MATH_OVERFLOW,
  SPOTR_MARKETS_ERROR__MISSING_WINNING_POSITIONS,
  SPOTR_MARKETS_ERROR__NOTHING_TO_CLAIM,
  SPOTR_MARKETS_ERROR__ROUND_ALREADY_ENTERED,
  SPOTR_MARKETS_ERROR__ROUND_ALREADY_RESOLVED,
  SPOTR_MARKETS_ERROR__ROUND_ALREADY_SETTLED,
  SPOTR_MARKETS_ERROR__ROUND_CLOSED,
  SPOTR_MARKETS_ERROR__ROUND_NOT_OPEN,
  SPOTR_MARKETS_ERROR__ROUND_NOT_PENDING,
  SPOTR_MARKETS_ERROR__ROUND_NOT_RESOLVED,
  SPOTR_MARKETS_ERROR__ROUND_NOT_SETTLED,
  SPOTR_MARKETS_ERROR__ROUND_STILL_OPEN,
  SPOTR_MARKETS_ERROR__SESSION_CLOSED,
  SPOTR_MARKETS_ERROR__SESSION_NOT_JOINABLE,
  SPOTR_MARKETS_ERROR__SESSION_NOT_LIVE,
  SPOTR_MARKETS_ERROR__SESSION_STILL_IN_PROGRESS,
  SPOTR_MARKETS_ERROR__SIDE_FULL,
  SPOTR_MARKETS_ERROR__STAKE_BELOW_MINIMUM,
  SPOTR_MARKETS_ERROR__VAULT_LOCKED,
  SPOTR_MARKETS_ERROR__WRONG_SIDE,
  type SpotrMarketsError,
} from "../../generated/spotr/errors/spotrMarkets";

export type SpotrErrorEntry = {
  /** Stable, screaming-snake identifier safe to ship in API responses. */
  code: string;
  /** Short noun phrase suitable for toast headings. */
  title: string;
  /** One-sentence explanation, user-facing, no jargon. */
  message: string;
  /** Suggested next step. Optional. */
  hint?: string;
  /** Whether a naive retry is expected to succeed. */
  retriable: boolean;
};

export const SPOTR_ERROR_MAP: Record<SpotrMarketsError, SpotrErrorEntry> = {
  [SPOTR_MARKETS_ERROR__INVALID_CONFIG]: {
    code: "SPOTR_INVALID_CONFIG",
    title: "Configuration mismatch",
    message: "The on-chain configuration is not in the expected state.",
    hint: "An admin needs to re-run the config update script.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__STAKE_BELOW_MINIMUM]: {
    code: "SPOTR_STAKE_BELOW_MINIMUM",
    title: "Stake too small",
    message: "Your stake is below the per-position minimum.",
    hint: "Increase the amount and try again.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__SESSION_NOT_JOINABLE]: {
    code: "SPOTR_SESSION_NOT_JOINABLE",
    title: "Session closed for joins",
    message: "This session can no longer be joined.",
    hint: "Wait for the next session to open.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__SESSION_NOT_LIVE]: {
    code: "SPOTR_SESSION_NOT_LIVE",
    title: "Session not live yet",
    message: "The session has not started yet.",
    hint: "Try again once the session opens.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__SESSION_CLOSED]: {
    code: "SPOTR_SESSION_CLOSED",
    title: "Session already closed",
    message: "This session has already ended.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__INVALID_ROUND_INDEX]: {
    code: "SPOTR_INVALID_ROUND_INDEX",
    title: "Round index out of range",
    message: "The round you targeted does not belong to this session.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_CLOSED]: {
    code: "SPOTR_ROUND_CLOSED",
    title: "Round already closed",
    message: "This round is no longer accepting predictions.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_STILL_OPEN]: {
    code: "SPOTR_ROUND_STILL_OPEN",
    title: "Round still open",
    message: "This action cannot run until the round is closed.",
    hint: "Wait for the round to close, then retry.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__ROUND_ALREADY_ENTERED]: {
    code: "SPOTR_ROUND_ALREADY_ENTERED",
    title: "Already entered this round",
    message: "You already submitted a position for this round.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__INSUFFICIENT_ESCROW]: {
    code: "SPOTR_INSUFFICIENT_ESCROW",
    title: "Not enough escrow",
    message: "Your deposit does not cover this position.",
    hint: "Top up your vault before retrying.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__SIDE_FULL]: {
    code: "SPOTR_SIDE_FULL",
    title: "Side is full",
    message: "The side you picked has reached its entry cap.",
    hint: "Try the opposite side.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__INVALID_ENTRY_INDEX]: {
    code: "SPOTR_INVALID_ENTRY_INDEX",
    title: "Round entry conflict",
    message: "The round changed while we were submitting. Reload and try again.",
    hint: "If this keeps happening, the round may already be full.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__ALREADY_CLAIMED]: {
    code: "SPOTR_ALREADY_CLAIMED",
    title: "Already claimed",
    message: "This position has already been claimed.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__NOTHING_TO_CLAIM]: {
    code: "SPOTR_NOTHING_TO_CLAIM",
    title: "Nothing to claim",
    message: "There is nothing to claim on this round.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__SESSION_STILL_IN_PROGRESS]: {
    code: "SPOTR_SESSION_STILL_IN_PROGRESS",
    title: "Session still running",
    message: "The session is still in progress.",
    hint: "Wait for the session to finish, then retry.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__MATH_OVERFLOW]: {
    code: "SPOTR_MATH_OVERFLOW",
    title: "Internal math overflow",
    message: "An internal calculation overflowed.",
    hint: "Please report this so we can investigate.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__INSUFFICIENT_TREASURY_BALANCE]: {
    code: "SPOTR_INSUFFICIENT_TREASURY_BALANCE",
    title: "Treasury balance too low",
    message:
      "The session treasury would drop below its rent-exempt minimum.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__VAULT_LOCKED]: {
    code: "SPOTR_VAULT_LOCKED",
    title: "Vault locked",
    message: "Your vault is locked while at least one session is active.",
    hint: "Wait for active sessions to finish before withdrawing.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__INSUFFICIENT_VAULT_BALANCE]: {
    code: "SPOTR_INSUFFICIENT_VAULT_BALANCE",
    title: "Vault balance too low",
    message: "Your vault does not have enough USDC for this withdrawal.",
    hint: "Top up your vault and try again.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__INVALID_MINT]: {
    code: "SPOTR_INVALID_MINT",
    title: "Token mint mismatch",
    message: "The token mint or owner does not match the expected USDC mint.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_NOT_PENDING]: {
    code: "SPOTR_ROUND_NOT_PENDING",
    title: "Round not in wait phase",
    message: "This action requires the round to be in the wait phase.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_NOT_OPEN]: {
    code: "SPOTR_ROUND_NOT_OPEN",
    title: "Round not in predict phase",
    message: "This action requires the round to be in the predict phase.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__DEPOSIT_ALREADY_USED]: {
    code: "SPOTR_DEPOSIT_ALREADY_USED",
    title: "Deposit already used",
    message: "This deposit has already been used or refunded.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__DEPOSIT_ALREADY_EXISTS]: {
    code: "SPOTR_DEPOSIT_ALREADY_EXISTS",
    title: "Already deposited",
    message: "You have already deposited for this round.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_ALREADY_RESOLVED]: {
    code: "SPOTR_ROUND_ALREADY_RESOLVED",
    title: "Round already resolved",
    message: "This round has already been resolved.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_NOT_RESOLVED]: {
    code: "SPOTR_ROUND_NOT_RESOLVED",
    title: "Round not yet resolved",
    message: "This action requires the round to be resolved first.",
    hint: "Resolve the round before retrying.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__ROUND_ALREADY_SETTLED]: {
    code: "SPOTR_ROUND_ALREADY_SETTLED",
    title: "Round already settled",
    message: "This round has already been settled.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__ROUND_NOT_SETTLED]: {
    code: "SPOTR_ROUND_NOT_SETTLED",
    title: "Round not yet settled",
    message: "This action requires the round to be settled first.",
    hint: "Settle the round before retrying.",
    retriable: true,
  },
  [SPOTR_MARKETS_ERROR__WRONG_SIDE]: {
    code: "SPOTR_WRONG_SIDE",
    title: "Position on losing side",
    message: "This position is on the losing side and cannot be claimed.",
    retriable: false,
  },
  [SPOTR_MARKETS_ERROR__MISSING_WINNING_POSITIONS]: {
    code: "SPOTR_MISSING_WINNING_POSITIONS",
    title: "Missing winning positions",
    message:
      "The supplied winning-position list does not match the round.",
    retriable: false,
  },
};

/** Look up the friendly entry for a raw program error code (0x1770…0x178d). */
export function getSpotrErrorEntry(
  code: number,
): SpotrErrorEntry | undefined {
  return (SPOTR_ERROR_MAP as Record<number, SpotrErrorEntry>)[code];
}
