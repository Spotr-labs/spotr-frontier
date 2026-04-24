import "server-only";

import { isValidSolanaAddress } from "./signed-action";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {}
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ValidationError(`${key} must be a string.`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new ValidationError(
      `${key} must be at most ${options.maxLength} characters.`
    );
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {}
): string | undefined {
  if (record[key] === undefined || record[key] === null) return undefined;
  return requireString(record, key, options);
}

function requireWallet(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key, { maxLength: 64 });
  if (!isValidSolanaAddress(value)) {
    throw new ValidationError(`${key} is not a valid Solana wallet address.`);
  }
  return value;
}

function optionalWallet(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${key} must be a string or null.`);
  }
  if (!isValidSolanaAddress(value)) {
    throw new ValidationError(`${key} is not a valid Solana wallet address.`);
  }
  return value;
}

function requireIsoDateString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = requireString(record, key, { maxLength: 48 });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${key} is not a valid ISO timestamp.`);
  }
  return value;
}

function requireBase64(
  record: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = { maxLength: 4096 }
): string {
  const value = requireString(record, key, options);
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    throw new ValidationError(`${key} must be base64-encoded.`);
  }
  return value;
}

export type SignedEnvelopeFields<TPayload> = {
  walletAddress: string;
  publicKeyBase64: string;
  signedMessageBase64: string;
  signatureBase64: string;
  issuedAtIso: string;
  payload: TPayload;
};

export function parseSignedEnvelope<TPayload>(
  body: unknown,
  parsePayload: (payload: Record<string, unknown>) => TPayload
): SignedEnvelopeFields<TPayload> {
  const record = requireRecord(body, "request body");
  const walletAddress = requireWallet(record, "walletAddress");
  const publicKeyBase64 = requireBase64(record, "publicKeyBase64", {
    maxLength: 128,
  });
  const signedMessageBase64 = requireBase64(record, "signedMessageBase64", {
    maxLength: 4096,
  });
  const signatureBase64 = requireBase64(record, "signatureBase64", {
    maxLength: 256,
  });
  const issuedAtIso = requireIsoDateString(record, "issuedAtIso");
  const payload = parsePayload(requireRecord(record.payload, "payload"));

  return {
    walletAddress,
    publicKeyBase64,
    signedMessageBase64,
    signatureBase64,
    issuedAtIso,
    payload,
  };
}

function requireTxSignature(record: Record<string, unknown>, key: string) {
  const value = requireString(record, key, { maxLength: 128 });
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value)) {
    throw new ValidationError(`${key} is not a valid Solana transaction signature.`);
  }
  return value;
}

export function parseJoinSessionPayload(record: Record<string, unknown>) {
  const walletAddress = requireWallet(record, "walletAddress");
  const referrerWallet = optionalWallet(record, "referrerWallet");
  const chainTxSignature = requireTxSignature(record, "chainTxSignature");
  return { walletAddress, referrerWallet, chainTxSignature };
}

export function parseEnterRoundPayload(record: Record<string, unknown>) {
  const walletAddress = requireWallet(record, "walletAddress");
  const roundId = requireString(record, "roundId", { maxLength: 128 });
  if (!/^[A-Za-z0-9_-]+$/.test(roundId)) {
    throw new ValidationError("roundId contains invalid characters.");
  }
  const sideRaw = requireString(record, "side", { maxLength: 1 });
  if (sideRaw !== "A" && sideRaw !== "B") {
    throw new ValidationError("side must be 'A' or 'B'.");
  }
  return { walletAddress, roundId, side: sideRaw as "A" | "B" };
}

export function parseWalletOnlyPayload(record: Record<string, unknown>) {
  const walletAddress = requireWallet(record, "walletAddress");
  return { walletAddress };
}

export function parseAdminChainDeployPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const sessionId = requireString(record, "sessionId", { maxLength: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new ValidationError("sessionId contains invalid characters.");
  }
  const chainTxSignature = requireString(record, "chainTxSignature", {
    maxLength: 128,
  });
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(chainTxSignature)) {
    throw new ValidationError("chainTxSignature is not a valid signature.");
  }
  const chainSessionNumber = requireString(record, "chainSessionNumber", {
    maxLength: 32,
  });
  if (!/^\d+$/.test(chainSessionNumber)) {
    throw new ValidationError("chainSessionNumber must be an integer string.");
  }
  return { adminWalletAddress, sessionId, chainTxSignature, chainSessionNumber };
}

export {
  requireRecord,
  requireString,
  requireWallet,
  optionalString,
  optionalWallet,
  requireIsoDateString,
  requireBase64,
};
