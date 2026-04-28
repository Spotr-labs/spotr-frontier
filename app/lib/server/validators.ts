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

function requirePositiveInt(
  record: Record<string, unknown>,
  key: string,
  options: { min?: number } = {}
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${key} must be a positive integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ValidationError(`${key} must be at least ${options.min}.`);
  }
  return value;
}

function requireTxSignature(record: Record<string, unknown>, key: string) {
  const value = requireString(record, key, { maxLength: 128 });
  // "already-joined" is a sentinel emitted by the client when the on-chain
  // PlayerSession PDA already exists; the server verifies the PDA directly.
  if (value === "already-joined") return value;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value)) {
    throw new ValidationError(`${key} is not a valid Solana transaction signature.`);
  }
  return value;
}

export function parseJoinSessionPayload(record: Record<string, unknown>) {
  const walletAddress = requireWallet(record, "walletAddress");
  const referrerWallet = optionalWallet(record, "referrerWallet");
  const chainTxSignature = requireTxSignature(record, "chainTxSignature");
  const sessionId = optionalString(record, "sessionId", { maxLength: 128 });
  return { walletAddress, referrerWallet, chainTxSignature, sessionId };
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
  const wagerLamports = requirePositiveInt(record, "wagerLamports", { min: 1_000_000 });
  const chainTxSignature = requireTxSignature(record, "chainTxSignature");
  return { walletAddress, roundId, side: sideRaw as "A" | "B", wagerLamports, chainTxSignature };
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

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  if (typeof record[key] !== "boolean") {
    throw new ValidationError(`${key} must be a boolean.`);
  }
  return record[key] as boolean;
}

function requireRewardKind(
  record: Record<string, unknown>,
  key: string
): "nft" | "merch" | "gift-card" | "voucher" {
  const value = requireString(record, key, { maxLength: 24 });
  if (value !== "nft" && value !== "merch" && value !== "gift-card" && value !== "voucher") {
    throw new ValidationError("kind must be nft, merch, gift-card, or voucher.");
  }
  return value;
}

function optionalIsoDateString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  return requireIsoDateString(record, key);
}

function requireSessionId(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key, { maxLength: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError(`${key} contains invalid characters.`);
  }
  return value;
}

function optionalSessionId(
  record: Record<string, unknown>,
  key: string
): string | null {
  if (record[key] === undefined || record[key] === null || record[key] === "")
    return null;
  return requireSessionId(record, key);
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  options: { maxItems?: number; itemMaxLength?: number } = {}
): string[] {
  const raw = record[key];
  if (!Array.isArray(raw)) {
    throw new ValidationError(`${key} must be an array of strings.`);
  }
  const max = options.maxItems ?? 200;
  if (raw.length > max) {
    throw new ValidationError(`${key} must contain at most ${max} entries.`);
  }
  const items: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (typeof value !== "string") {
      throw new ValidationError(`${key}[${index}] must be a string.`);
    }
    if (
      options.itemMaxLength !== undefined &&
      value.length > options.itemMaxLength
    ) {
      throw new ValidationError(
        `${key}[${index}] must be at most ${options.itemMaxLength} characters.`
      );
    }
    items.push(value);
  }
  return items;
}

export function parseAdminEditPairPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const id = requireString(record, "id", { maxLength: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new ValidationError("id contains invalid characters.");
  }
  const category = optionalString(record, "category", { maxLength: 64 });
  const sideA = optionalString(record, "sideA", { maxLength: 200 });
  const sideB = optionalString(record, "sideB", { maxLength: 200 });
  const crowdLabel = optionalString(record, "crowdLabel", { maxLength: 64 });
  let defaultSideAPct: number | undefined;
  if (record.defaultSideAPct !== undefined && record.defaultSideAPct !== null) {
    if (typeof record.defaultSideAPct !== "number") {
      throw new ValidationError("defaultSideAPct must be a number.");
    }
    defaultSideAPct = record.defaultSideAPct;
  }
  return {
    adminWalletAddress,
    id,
    category,
    sideA,
    sideB,
    crowdLabel,
    defaultSideAPct,
  };
}

export function parseAdminTogglePairBulkPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const pairIds = requireStringArray(record, "pairIds", {
    maxItems: 200,
    itemMaxLength: 64,
  });
  for (let index = 0; index < pairIds.length; index += 1) {
    if (!/^[A-Za-z0-9_-]+$/.test(pairIds[index])) {
      throw new ValidationError(`pairIds[${index}] contains invalid characters.`);
    }
  }
  const active = requireBoolean(record, "active");
  return { adminWalletAddress, pairIds, active };
}

export function parseAdminExpireSessionPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const sessionId = requireSessionId(record, "sessionId");
  return { adminWalletAddress, sessionId };
}

export function parseAdminCloseRoundPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const sessionId = requireSessionId(record, "sessionId");
  const roundId = requireSessionId(record, "roundId");
  const chainTxSignature = requireString(record, "chainTxSignature", {
    maxLength: 128,
  });
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(chainTxSignature)) {
    throw new ValidationError(
      "chainTxSignature is not a valid Solana signature."
    );
  }
  return { adminWalletAddress, sessionId, roundId, chainTxSignature };
}

export function parseAdminSweepOrphansPayload(record: Record<string, unknown>) {
  return parseAdminCloseRoundPayload(record);
}

export function parseAdminFinalizeSessionPayload(
  record: Record<string, unknown>
) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const sessionId = requireSessionId(record, "sessionId");
  const chainTxSignature = requireString(record, "chainTxSignature", {
    maxLength: 128,
  });
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(chainTxSignature)) {
    throw new ValidationError(
      "chainTxSignature is not a valid Solana signature."
    );
  }
  return { adminWalletAddress, sessionId, chainTxSignature };
}

export function parseAdminWithdrawFeesPayload(record: Record<string, unknown>) {
  return parseAdminFinalizeSessionPayload(record);
}

function parseCardPackItem(value: unknown, label: string) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ValidationError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    kind: requireRewardKind(record, "kind"),
    title: requireString(record, "title", { maxLength: 120 }),
    subtitle: requireString(record, "subtitle", { maxLength: 240 }),
  };
}

export function parseAdminAssignCardPackPayload(
  record: Record<string, unknown>
) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const sessionId = requireSessionId(record, "sessionId");
  const itemsRaw = record.items;
  if (!Array.isArray(itemsRaw)) {
    throw new ValidationError("items must be an array.");
  }
  if (itemsRaw.length === 0) {
    throw new ValidationError("items must contain at least one entry.");
  }
  if (itemsRaw.length > 50) {
    throw new ValidationError("items must contain at most 50 entries.");
  }
  const items = itemsRaw.map((value, index) =>
    parseCardPackItem(value, `items[${index}]`)
  );
  return { adminWalletAddress, sessionId, items };
}

export function parseAdminPayoutBulkPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const referrerWallets = requireStringArray(record, "referrerWallets", {
    maxItems: 200,
    itemMaxLength: 64,
  });
  for (let index = 0; index < referrerWallets.length; index += 1) {
    if (!isValidSolanaAddress(referrerWallets[index])) {
      throw new ValidationError(
        `referrerWallets[${index}] is not a valid Solana address.`
      );
    }
  }
  return { adminWalletAddress, referrerWallets };
}

export function parseAdminAssignRewardBulkPayload(
  record: Record<string, unknown>
) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const itemsRaw = record.items;
  if (!Array.isArray(itemsRaw)) {
    throw new ValidationError("items must be an array.");
  }
  if (itemsRaw.length === 0) {
    throw new ValidationError("items must contain at least one entry.");
  }
  if (itemsRaw.length > 100) {
    throw new ValidationError("items must contain at most 100 entries.");
  }
  const items = itemsRaw.map((value, index) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new ValidationError(`items[${index}] must be an object.`);
    }
    const item = value as Record<string, unknown>;
    return {
      targetWalletAddress: requireWallet(item, "targetWalletAddress"),
      title: requireString(item, "title", { maxLength: 120 }),
      subtitle: requireString(item, "subtitle", { maxLength: 240 }),
      kind: requireRewardKind(item, "kind"),
      sessionId: optionalSessionId(item, "sessionId"),
    };
  });
  return { adminWalletAddress, items };
}

export function parseAdminDeploySessionPayload(record: Record<string, unknown>) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  const title = optionalString(record, "title", { maxLength: 200 });
  const pairIds = requireStringArray(record, "pairIds", {
    maxItems: 32,
    itemMaxLength: 64,
  });
  for (let index = 0; index < pairIds.length; index += 1) {
    if (!/^[A-Za-z0-9_-]+$/.test(pairIds[index])) {
      throw new ValidationError(`pairIds[${index}] contains invalid characters.`);
    }
  }
  const overrideStartsAtIso = optionalIsoDateString(record, "overrideStartsAtIso");
  const overrideEndsAtIso = optionalIsoDateString(record, "overrideEndsAtIso");
  const cardPackItemsRaw = record.cardPackItems;
  let cardPackItems:
    | Array<{ kind: "nft" | "merch" | "gift-card" | "voucher"; title: string; subtitle: string }>
    | undefined;
  if (cardPackItemsRaw !== undefined && cardPackItemsRaw !== null) {
    if (!Array.isArray(cardPackItemsRaw)) {
      throw new ValidationError("cardPackItems must be an array.");
    }
    if (cardPackItemsRaw.length > 50) {
      throw new ValidationError("cardPackItems must contain at most 50 entries.");
    }
    cardPackItems = cardPackItemsRaw.map((value, index) =>
      parseCardPackItem(value, `cardPackItems[${index}]`)
    );
  }
  return {
    adminWalletAddress,
    title: title ?? null,
    pairIds,
    overrideStartsAtIso,
    overrideEndsAtIso,
    cardPackItems,
  };
}

export function parseAdminSyncSessionsPayload(
  record: Record<string, unknown>
) {
  const adminWalletAddress = requireWallet(record, "adminWalletAddress");
  return { adminWalletAddress };
}

export {
  requireRecord,
  requireString,
  requireWallet,
  optionalString,
  optionalWallet,
  requireIsoDateString,
  requireBase64,
  requireBoolean,
  requireRewardKind,
};
