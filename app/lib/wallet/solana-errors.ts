// Unified classifier for every error path the Spotr app can throw when
// talking to Solana — wallet rejection, Spotr program errors, Anchor
// framework errors, runtime errors (BlockhashNotFound, InsufficientFundsForRent,
// …), and RPC transport problems (429, timeouts, RPC offline).
//
// All transaction sites (UI toast handlers and API routes) should funnel
// caught errors through `classifySolanaError`, then render the resulting
// `SolanaErrorReport` via `formatSolanaErrorForToast` (UI) or
// `formatSolanaErrorForApi` (API responses).

import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_IN_USE,
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
} from "@solana/kit";
import { getSpotrErrorEntry, type SpotrErrorEntry } from "./spotr-error-map";

export type SolanaErrorCategory =
  | "wallet_rejected"
  | "wallet_unavailable"
  | "program"
  | "anchor_framework"
  | "runtime"
  | "rpc"
  | "unknown";

export type SolanaErrorReport = {
  category: SolanaErrorCategory;
  /** Stable, screaming-snake identifier, or null if we couldn't classify. */
  code: string | null;
  /** Short noun phrase, suitable for a toast heading. */
  title: string;
  /** One-sentence explanation, user-facing. */
  message: string;
  /** Optional follow-up hint ("Refresh and try again"). */
  hint?: string;
  /** Whether a naive retry is expected to succeed. */
  retriable: boolean;
  /** Raw Anchor/program hex code (e.g. "0x177b") for debug surfaces. */
  rawHex?: string;
  /** Preflight logs collected from the cause chain — for debug surfaces. */
  logs?: string[];
};

const REJECTION_NEEDLES = [
  "user rejected",
  "user declined",
  "user denied",
  "rejected the request",
  "request was rejected",
  "rejected by user",
  "cancelled by user",
  "wallet was disconnected",
];

const UNAVAILABLE_NEEDLES = [
  "wallet not connected",
  "no wallet selected",
  "wallet is locked",
  "wallet not found",
  "no wallet adapter",
];

const NETWORK_NEEDLES = [
  "fetch failed",
  "network request failed",
  "econnrefused",
  "etimedout",
  "enotfound",
  "socket hang up",
  "connection refused",
];

const STALE_BLOCKHASH_NEEDLES = [
  "blockhash not found",
  "block height exceeded",
  "transaction was not confirmed",
];

const PENDING_CONFIRMATION_NEEDLES = [
  "transaction is not confirmed yet",
  "retry in a moment",
];

// Human-readable labels for the most common Anchor framework error numbers
// (codes 100..5999, which sit BELOW the 6000 #[error_code] custom range).
// Anchor never publishes a JS-importable enum so we hand-pick the ones a
// player or admin is likely to encounter.
const ANCHOR_FRAMEWORK_ERRORS: Record<
  number,
  { code: string; title: string; message: string }
> = {
  100: {
    code: "ANCHOR_INSTRUCTION_MISSING",
    title: "Instruction missing",
    message: "The program does not recognize that instruction.",
  },
  101: {
    code: "ANCHOR_INSTRUCTION_FALLBACK_NOT_FOUND",
    title: "Fallback handler missing",
    message: "The program has no fallback for this instruction.",
  },
  102: {
    code: "ANCHOR_INSTRUCTION_DID_NOT_DESERIALIZE",
    title: "Bad instruction payload",
    message: "The program could not decode the submitted instruction.",
  },
  2000: {
    code: "ANCHOR_CONSTRAINT_MUT",
    title: "Account not writable",
    message: "An account that needs to be writable was passed read-only.",
  },
  2001: {
    code: "ANCHOR_CONSTRAINT_HAS_ONE",
    title: "Account relationship mismatch",
    message: "An account does not point to the expected related account.",
  },
  2002: {
    code: "ANCHOR_CONSTRAINT_SIGNER",
    title: "Missing signer",
    message: "An account that must sign the transaction is not signing.",
  },
  2003: {
    code: "ANCHOR_CONSTRAINT_RAW",
    title: "Account check failed",
    message: "A program-side account constraint rejected the transaction.",
  },
  2006: {
    code: "ANCHOR_CONSTRAINT_SEEDS",
    title: "PDA seeds mismatch",
    message: "An account was derived from the wrong seeds.",
  },
  3007: {
    code: "ANCHOR_ACCOUNT_DISCRIMINATOR_MISMATCH",
    title: "Account type mismatch",
    message: "An account did not match the expected program-defined type.",
  },
  3012: {
    code: "ANCHOR_ACCOUNT_NOT_INITIALIZED",
    title: "Account not initialized",
    message: "An account expected to exist has not been created on-chain.",
  },
  4100: {
    code: "ANCHOR_REQUIRE_KEYS_EQ",
    title: "Account key mismatch",
    message: "Two accounts that must match are different.",
  },
};

// Walk an error's cause chain and collect string messages plus any
// `context.causeMessage`. Bounded depth keeps us safe from cycles.
function collectMessages(error: unknown, maxDepth = 8): string[] {
  const out: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < maxDepth) {
    if (typeof current === "string") {
      out.push(current);
      break;
    }
    if (typeof current === "object") {
      const obj = current as {
        message?: unknown;
        cause?: unknown;
        context?: { causeMessage?: unknown };
      };
      if (typeof obj.message === "string") out.push(obj.message);
      if (typeof obj.context?.causeMessage === "string") {
        out.push(obj.context.causeMessage);
      }
      current = obj.cause;
    } else {
      break;
    }
    depth += 1;
  }
  return out;
}

// Walk the cause chain collecting `context.logs: string[]` (the preflight
// logs Anchor emits via `msg!`).
function collectLogs(error: unknown, maxDepth = 8): string[] {
  const out: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < maxDepth) {
    if (typeof current === "object") {
      const obj = current as {
        cause?: unknown;
        context?: { logs?: unknown };
      };
      const logs = obj.context?.logs;
      if (Array.isArray(logs)) {
        for (const entry of logs) if (typeof entry === "string") out.push(entry);
      }
      current = obj.cause;
    } else {
      break;
    }
    depth += 1;
  }
  return out;
}

// Walk the cause chain collecting any `context.statusCode: number` (HTTP
// status from the kit's transport layer).
function collectStatusCodes(error: unknown, maxDepth = 8): number[] {
  const out: number[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < maxDepth) {
    if (typeof current === "object") {
      const obj = current as {
        cause?: unknown;
        context?: { statusCode?: unknown; headers?: unknown };
      };
      const status = obj.context?.statusCode;
      if (typeof status === "number") out.push(status);
      current = obj.cause;
    } else {
      break;
    }
    depth += 1;
  }
  return out;
}

// Walk the cause chain collecting any context object that may carry a
// `code: number`. Used to find Anchor's INSTRUCTION_ERROR__CUSTOM payload
// even when wrapped in a higher-level preflight error.
function findCustomProgramCode(error: unknown, maxDepth = 8): number | null {
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < maxDepth) {
    if (
      isSolanaError(current, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
      typeof current.context?.code === "number"
    ) {
      return current.context.code;
    }
    if (typeof current === "object") {
      const obj = current as { cause?: unknown };
      current = obj.cause;
    } else {
      break;
    }
    depth += 1;
  }
  return null;
}

// Match the Anchor preflight log line that names the framework error number:
//   "Program log: AnchorError caused by account: x. Error Code: X.
//    Error Number: 2003. Error Message: A raw constraint was violated."
function findAnchorFrameworkCode(logs: string[]): number | null {
  for (const line of logs) {
    const match = line.match(/Error Number:\s*(\d+)/);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num) && num < 6000) return num;
    }
  }
  return null;
}

// Pull the "Error Message: …" tail out of the Anchor preflight log so that
// even unmapped errors get a real explanation.
function findAnchorMessage(logs: string[]): string | null {
  for (const line of logs) {
    const match = line.match(
      /AnchorError[^]*?Error Message:\s*([^.]+(?:\.[^.]+)*)/,
    );
    if (match) return match[1].replace(/\.\s*$/, "").trim();
  }
  return null;
}

// Some kits emit "custom program error: 0xNN" in the logs even when
// `context.code` is missing — pull the hex out so we can still report the
// numeric code.
function findCustomProgramHex(logs: string[]): string | null {
  for (const line of logs) {
    const match = line.match(/custom program error:\s*(0x[0-9a-f]+)/i);
    if (match) return match[1];
  }
  return null;
}

function toHex(code: number): string {
  return `0x${code.toString(16)}`;
}

function spotrEntryReport(
  entry: SpotrErrorEntry,
  rawCode: number,
  logs: string[],
): SolanaErrorReport {
  return {
    category: "program",
    code: entry.code,
    title: entry.title,
    message: entry.message,
    hint: entry.hint,
    retriable: entry.retriable,
    rawHex: toHex(rawCode),
    logs: logs.length > 0 ? logs : undefined,
  };
}

function unknownProgramReport(
  rawCode: number,
  anchorMessage: string | null,
  logs: string[],
): SolanaErrorReport {
  const hex = toHex(rawCode);
  return {
    category: "program",
    code: `SPOTR_UNKNOWN_${rawCode}`,
    title: "Program rejected the transaction",
    message:
      anchorMessage ??
      `Program rejected the transaction (code ${hex} / ${rawCode}).`,
    retriable: false,
    rawHex: hex,
    logs: logs.length > 0 ? logs : undefined,
  };
}

function anchorFrameworkReport(
  number: number,
  anchorMessage: string | null,
  logs: string[],
): SolanaErrorReport {
  const known = ANCHOR_FRAMEWORK_ERRORS[number];
  if (known) {
    return {
      category: "anchor_framework",
      code: known.code,
      title: known.title,
      message: anchorMessage ?? known.message,
      retriable: false,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  return {
    category: "anchor_framework",
    code: `ANCHOR_${number}`,
    title: "Account check failed",
    message:
      anchorMessage ?? `Account or constraint check failed (code ${number}).`,
    retriable: false,
    logs: logs.length > 0 ? logs : undefined,
  };
}

function classifyHaystack(haystack: string): SolanaErrorCategory | null {
  if (REJECTION_NEEDLES.some((n) => haystack.includes(n))) return "wallet_rejected";
  if (UNAVAILABLE_NEEDLES.some((n) => haystack.includes(n))) return "wallet_unavailable";
  return null;
}

export function classifySolanaError(error: unknown): SolanaErrorReport {
  const messages = collectMessages(error);
  const logs = collectLogs(error);
  const haystack = messages.join(" | ").toLowerCase();

  // 1. Wallet rejection / unavailability — these come from wallet-standard
  // and never carry program logs.
  const walletCategory = classifyHaystack(haystack);
  if (walletCategory === "wallet_rejected") {
    return {
      category: "wallet_rejected",
      code: "WALLET_REJECTED",
      title: "Cancelled in wallet",
      message: "Transaction cancelled in your wallet.",
      retriable: true,
    };
  }
  if (walletCategory === "wallet_unavailable") {
    return {
      category: "wallet_unavailable",
      code: "WALLET_UNAVAILABLE",
      title: "Wallet unavailable",
      message: "Your wallet is not connected or is locked.",
      hint: "Reconnect your wallet and try again.",
      retriable: true,
    };
  }

  // 2. Spotr program error (custom program error code 6000+).
  const customCode = findCustomProgramCode(error);
  if (customCode != null) {
    if (customCode === 0) {
      return {
        category: "unknown",
        code: "UNKNOWN_PROGRAM_REJECTION",
        title: "Transaction failed",
        message: "The transaction was rejected before the program returned a useful error.",
        hint: "Retry in a moment.",
        retriable: true,
        rawHex: "0x0",
        logs: logs.length > 0 ? logs : undefined,
      };
    }
    const entry = getSpotrErrorEntry(customCode);
    if (entry) return spotrEntryReport(entry, customCode, logs);
    const anchorMessage = findAnchorMessage(logs);
    return unknownProgramReport(customCode, anchorMessage, logs);
  }

  // The kit doesn't always wrap Custom into INSTRUCTION_ERROR__CUSTOM —
  // the preflight error often only shows the hex in logs.
  const hex = findCustomProgramHex(logs);
  if (hex) {
    const code = Number.parseInt(hex, 16);
    if (Number.isFinite(code)) {
      if (code >= 6000) {
        const entry = getSpotrErrorEntry(code);
        const anchorMessage = findAnchorMessage(logs);
        if (entry) return spotrEntryReport(entry, code, logs);
        return unknownProgramReport(code, anchorMessage, logs);
      }
      // Codes < 6000 are Anchor framework errors.
      const anchorMessage = findAnchorMessage(logs);
      return anchorFrameworkReport(code, anchorMessage, logs);
    }
  }

  // 3. Anchor framework error number from the log line.
  const frameworkCode = findAnchorFrameworkCode(logs);
  if (frameworkCode != null) {
    const anchorMessage = findAnchorMessage(logs);
    return anchorFrameworkReport(frameworkCode, anchorMessage, logs);
  }

  // 4. Solana runtime errors (BlockhashNotFound, InsufficientFundsForRent…).
  const runtime = classifyRuntimeError(error, haystack, logs);
  if (runtime) return runtime;

  // 5. RPC transport errors (429, 5xx, fetch failed, RPC offline).
  const rpc = classifyRpcError(error, haystack, logs);
  if (rpc) return rpc;

  // 6. Last-resort generic message — strip the SolanaError prefix and
  //    truncate to keep toasts readable.
  for (const raw of messages) {
    const trimmed = raw
      .replace(/^SolanaError:\s*/i, "")
      .replace(/;\s*Decode this error.*$/is, "")
      .trim();
    if (trimmed) {
      return {
        category: "unknown",
        code: null,
        title: "Transaction failed",
        message: trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed,
        retriable: false,
        logs: logs.length > 0 ? logs : undefined,
      };
    }
  }
  return {
    category: "unknown",
    code: null,
    title: "Transaction failed",
    message: "Transaction failed.",
    retriable: false,
    logs: logs.length > 0 ? logs : undefined,
  };
}

function classifyRuntimeError(
  error: unknown,
  haystack: string,
  logs: string[],
): SolanaErrorReport | null {
  if (
    isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND) ||
    isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED) ||
    STALE_BLOCKHASH_NEEDLES.some((n) => haystack.includes(n))
  ) {
    return {
      category: "runtime",
      code: "STALE_BLOCKHASH",
      title: "Network slipped",
      message: "The transaction expired before confirmation.",
      hint: "Retry — this usually succeeds the second time.",
      retriable: true,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (PENDING_CONFIRMATION_NEEDLES.some((n) => haystack.includes(n))) {
    return {
      category: "runtime",
      code: "TX_NOT_CONFIRMED_YET",
      title: "Confirmation pending",
      message: "The transaction has not reached confirmed status yet.",
      hint: "Retry in a moment.",
      retriable: true,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) {
    return {
      category: "runtime",
      code: "ALREADY_PROCESSED",
      title: "Already processed",
      message: "That transaction was already confirmed on-chain.",
      retriable: false,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (
    isSolanaError(
      error,
      SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
    )
  ) {
    return {
      category: "runtime",
      code: "INSUFFICIENT_FUNDS_FOR_RENT",
      title: "Not enough SOL for rent",
      message: "An account would drop below the rent-exempt minimum.",
      hint: "Top up the account, then retry.",
      retriable: false,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (
    isSolanaError(
      error,
      SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
    )
  ) {
    return {
      category: "runtime",
      code: "INSUFFICIENT_FUNDS_FOR_FEE",
      title: "Fee payer out of SOL",
      message: "The fee payer does not have enough SOL to cover this transaction.",
      hint: "Top up the fee payer wallet.",
      retriable: false,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND)) {
    return {
      category: "runtime",
      code: "ACCOUNT_NOT_FOUND",
      title: "Account not found",
      message: "An account referenced by the transaction does not exist on-chain.",
      retriable: false,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_IN_USE)) {
    return {
      category: "runtime",
      code: "ACCOUNT_IN_USE",
      title: "Account busy",
      message: "An account is locked by another transaction. Try again.",
      retriable: true,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  return null;
}

function classifyRpcError(
  error: unknown,
  haystack: string,
  logs: string[],
): SolanaErrorReport | null {
  // HTTP 429 rate limit — surface as retriable so the caller can back off.
  const statuses = collectStatusCodes(error);
  if (statuses.includes(429) || haystack.includes("429")) {
    return {
      category: "rpc",
      code: "RPC_RATE_LIMITED",
      title: "RPC rate limited",
      message: "The Solana RPC is rate-limiting requests.",
      hint: "Wait a moment and try again.",
      retriable: true,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (statuses.some((s) => s >= 500)) {
    return {
      category: "rpc",
      code: "RPC_UNAVAILABLE",
      title: "RPC unavailable",
      message: "The Solana RPC returned a server error.",
      hint: "Try again in a moment.",
      retriable: true,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) ||
    NETWORK_NEEDLES.some((n) => haystack.includes(n))
  ) {
    return {
      category: "rpc",
      code: "RPC_UNAVAILABLE",
      title: "Cannot reach RPC",
      message: "Could not reach the Solana RPC.",
      hint: "Check your internet connection and try again.",
      retriable: true,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  if (
    isSolanaError(
      error,
      SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
    )
  ) {
    // The preflight failure itself is the wrapper — the *real* error is
    // in the cause chain (a Custom or Anchor error). If we ever land here
    // it means we already failed to classify deeper; fall through with a
    // generic preflight message.
    return {
      category: "rpc",
      code: "PREFLIGHT_FAILURE",
      title: "Preflight failed",
      message: "The transaction was rejected during preflight simulation.",
      retriable: false,
      logs: logs.length > 0 ? logs : undefined,
    };
  }
  return null;
}

// ─── Surface helpers ────────────────────────────────────────────────────────

export type ToastReport = {
  title: string;
  message: string;
  /** "info" for soft cancellations (wallet rejection); "error" otherwise. */
  kind: "info" | "error";
};

export function formatSolanaErrorForToast(error: unknown): ToastReport {
  const report = classifySolanaError(error);
  return {
    title: report.title,
    message: report.hint ? `${report.message} ${report.hint}` : report.message,
    kind: report.category === "wallet_rejected" ? "info" : "error",
  };
}

export type ApiErrorPayload = {
  code: string | null;
  message: string;
  status: number;
  hint?: string;
  category: SolanaErrorCategory;
};

export function formatSolanaErrorForApi(error: unknown): ApiErrorPayload {
  const report = classifySolanaError(error);
  return {
    code: report.code,
    message: report.message,
    hint: report.hint,
    status: pickHttpStatus(report),
    category: report.category,
  };
}

function pickHttpStatus(report: SolanaErrorReport): number {
  switch (report.category) {
    case "wallet_rejected":
      return 400;
    case "wallet_unavailable":
      return 401;
    case "rpc":
      if (report.code === "RPC_RATE_LIMITED") return 429;
      return 503;
    case "runtime":
      return report.retriable ? 503 : 400;
    default:
      return 400;
  }
}

export function isWalletRejection(error: unknown): boolean {
  return classifySolanaError(error).category === "wallet_rejected";
}

// ─── Typed error so route handlers can re-throw without re-parsing ─────────

export class SolanaTxError extends Error {
  readonly code: string | null;
  readonly status: number;
  readonly report: SolanaErrorReport;
  constructor(report: SolanaErrorReport, status: number) {
    super(report.message);
    this.name = "SolanaTxError";
    this.code = report.code;
    this.status = status;
    this.report = report;
  }
}

export function toSolanaTxError(error: unknown): SolanaTxError {
  if (error instanceof SolanaTxError) return error;
  const payload = formatSolanaErrorForApi(error);
  const report = classifySolanaError(error);
  return new SolanaTxError(report, payload.status);
}
