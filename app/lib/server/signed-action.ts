import "server-only";

import { webcrypto } from "node:crypto";
import { getBase58Codec } from "@solana/codecs-strings";
import {
  buildSpotrSignedActionMessage,
  type SpotrSignedActionName,
} from "../spotr-signed-action";

const ACTION_TTL_MS = 5 * 60 * 1000;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const base58 = getBase58Codec();

const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const seenSignatures = new Map<string, number>();

function pruneSeenSignatures(now: number) {
  if (seenSignatures.size < 1024) return;
  for (const [sig, expiresAt] of seenSignatures) {
    if (expiresAt <= now) seenSignatures.delete(sig);
  }
}

export type SignedActionEnvelope<TPayload> = {
  walletAddress: string;
  publicKeyBase64: string;
  signedMessageBase64: string;
  signatureBase64: string;
  issuedAtIso: string;
  payload: TPayload;
};

function base64ToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export function isValidSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!SOLANA_ADDRESS_PATTERN.test(value)) return false;
  try {
    const bytes = base58.encode(value);
    return bytes.length === ED25519_PUBLIC_KEY_BYTES;
  } catch {
    return false;
  }
}

export async function verifySignedSpotrAction<TPayload>(
  action: SpotrSignedActionName,
  envelope: SignedActionEnvelope<TPayload>
) {
  if (
    typeof envelope.walletAddress !== "string" ||
    typeof envelope.publicKeyBase64 !== "string" ||
    typeof envelope.signedMessageBase64 !== "string" ||
    typeof envelope.signatureBase64 !== "string" ||
    typeof envelope.issuedAtIso !== "string"
  ) {
    throw new Error("Signed request envelope is malformed.");
  }

  if (!isValidSolanaAddress(envelope.walletAddress)) {
    throw new Error("Signed request wallet address is not a valid Solana address.");
  }

  const issuedAt = new Date(envelope.issuedAtIso);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new Error("Signed request timestamp is invalid.");
  }

  const now = Date.now();
  const ageMs = Math.abs(now - issuedAt.getTime());
  if (ageMs > ACTION_TTL_MS) {
    throw new Error("Signed request has expired. Sign it again.");
  }

  const publicKeyBytes = base64ToBytes(envelope.publicKeyBase64);
  if (publicKeyBytes.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error("Signed request public key must be 32 bytes.");
  }

  const signatureBytes = base64ToBytes(envelope.signatureBase64);
  if (signatureBytes.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error("Signed request signature must be 64 bytes.");
  }

  const derivedWalletAddress = base58.decode(publicKeyBytes);
  if (derivedWalletAddress !== envelope.walletAddress) {
    throw new Error("Signed request wallet address does not match the public key.");
  }

  const expectedMessage = new TextEncoder().encode(
    buildSpotrSignedActionMessage(action, envelope.issuedAtIso, envelope.payload)
  );
  const signedMessageBytes = base64ToBytes(envelope.signedMessageBase64);
  if (!bytesEqual(expectedMessage, signedMessageBytes)) {
    throw new Error("Signed request payload does not match the signed message.");
  }

  const replayKey = `${envelope.walletAddress}:${envelope.signatureBase64}`;
  const existing = seenSignatures.get(replayKey);
  if (existing !== undefined && existing > now) {
    throw new Error("Signed request has already been used.");
  }

  const publicKey = await webcrypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    "Ed25519",
    false,
    ["verify"]
  );
  const verified = await webcrypto.subtle.verify(
    "Ed25519",
    publicKey,
    signatureBytes,
    signedMessageBytes
  );
  if (!verified) {
    throw new Error("Signed request verification failed.");
  }

  if (
    typeof envelope.payload === "object" &&
    envelope.payload !== null &&
    "walletAddress" in envelope.payload
  ) {
    const payloadWallet = Reflect.get(envelope.payload, "walletAddress");
    if (
      typeof payloadWallet === "string" &&
      payloadWallet !== envelope.walletAddress
    ) {
      throw new Error("Signed request payload wallet does not match the signer.");
    }
  }

  if (
    typeof envelope.payload === "object" &&
    envelope.payload !== null &&
    "adminWalletAddress" in envelope.payload
  ) {
    const payloadWallet = Reflect.get(envelope.payload, "adminWalletAddress");
    if (
      typeof payloadWallet === "string" &&
      payloadWallet !== envelope.walletAddress
    ) {
      throw new Error("Signed request admin wallet does not match the signer.");
    }
  }

  seenSignatures.set(replayKey, now + ACTION_TTL_MS);
  pruneSeenSignatures(now);

  return {
    walletAddress: envelope.walletAddress,
    payload: envelope.payload,
  };
}
