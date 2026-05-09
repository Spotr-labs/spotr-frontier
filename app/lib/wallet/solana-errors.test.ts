// Run with:
//   node --import tsx --test app/lib/wallet/solana-errors.test.ts
//
// Covers one fixture per category supported by `classifySolanaError`.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  SolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
} from "@solana/kit";
import {
  classifySolanaError,
  formatSolanaErrorForApi,
  isWalletRejection,
} from "./solana-errors";

test("custom program error 11 → SPOTR_INVALID_ENTRY_INDEX", () => {
  const err = new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, {
    code: 0x177b,
    index: 0,
  });
  const report = classifySolanaError(err);
  assert.equal(report.category, "program");
  assert.equal(report.code, "SPOTR_INVALID_ENTRY_INDEX");
  assert.equal(report.title, "Round entry conflict");
  assert.equal(report.retriable, true);
  assert.equal(report.rawHex, "0x177b");
});

test("custom program error 9 → SPOTR_INSUFFICIENT_ESCROW", () => {
  const err = new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, {
    code: 0x1779,
    index: 0,
  });
  const report = classifySolanaError(err);
  assert.equal(report.code, "SPOTR_INSUFFICIENT_ESCROW");
  assert.equal(report.category, "program");
  assert.equal(report.retriable, false);
});

test("Anchor framework code 2003 from log → ANCHOR_CONSTRAINT_RAW", () => {
  // Build a faux SolanaError-like object with a logs array on its context;
  // the classifier does not require a real SolanaError — it walks the
  // cause/context chain looking for `logs`.
  const err = Object.assign(new Error("preflight failure"), {
    context: {
      logs: [
        "Program log: AnchorError caused by account: vault. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated.",
      ],
    },
  });
  const report = classifySolanaError(err);
  assert.equal(report.category, "anchor_framework");
  assert.equal(report.code, "ANCHOR_CONSTRAINT_RAW");
});

test("BlockhashNotFound runtime error → STALE_BLOCKHASH, retriable", () => {
  const err = new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND);
  const report = classifySolanaError(err);
  assert.equal(report.category, "runtime");
  assert.equal(report.code, "STALE_BLOCKHASH");
  assert.equal(report.retriable, true);
});

test("Wallet rejection → category wallet_rejected", () => {
  const err = new Error("User rejected the request.");
  const report = classifySolanaError(err);
  assert.equal(report.category, "wallet_rejected");
  assert.equal(report.code, "WALLET_REJECTED");
  assert.equal(isWalletRejection(err), true);
});

test("HTTP 429 from kit transport → RPC_RATE_LIMITED, status 429", () => {
  const err = new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    headers: new Headers(),
    message: "Too Many Requests",
    statusCode: 429,
  });
  const report = classifySolanaError(err);
  assert.equal(report.category, "rpc");
  assert.equal(report.code, "RPC_RATE_LIMITED");
  assert.equal(report.retriable, true);

  const apiPayload = formatSolanaErrorForApi(err);
  assert.equal(apiPayload.status, 429);
});

test("Unknown Custom(99) → graceful fallback with hex", () => {
  const err = new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, {
    code: 99,
    index: 0,
  });
  const report = classifySolanaError(err);
  assert.equal(report.category, "program");
  assert.equal(report.rawHex, "0x63");
  assert.equal(report.code, "SPOTR_UNKNOWN_99");
  assert.match(report.message, /code 0x63 \/ 99/);
});

test("pending confirmation verifier message → retriable runtime classification", () => {
  const err = new Error("Transaction is not confirmed yet; retry in a moment.");
  const report = classifySolanaError(err);
  assert.equal(report.category, "runtime");
  assert.equal(report.code, "TX_NOT_CONFIRMED_YET");
  assert.equal(report.retriable, true);
});

test("Custom(0) → opaque retryable failure instead of raw program rejection", () => {
  const err = new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, {
    code: 0,
    index: 0,
  });
  const report = classifySolanaError(err);
  assert.equal(report.category, "unknown");
  assert.equal(report.code, "UNKNOWN_PROGRAM_REJECTION");
  assert.equal(report.rawHex, "0x0");
  assert.equal(report.retriable, true);
});
