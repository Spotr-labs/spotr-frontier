import { getAddressFromPublicKey } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { WalletConnector, WalletSession } from "./types";

export const EPHEMERAL_ID = "spotr:ephemeral";
const STORAGE_KEY = "spotr:ephemeral-wallet-v1";

type StoredWallet = {
  privateKeyJwk: JsonWebKey;
  publicKeyBase64: string;
  address: string;
};

function base64FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function bytesFromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function generateAndStore(): Promise<StoredWallet> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    /* extractable */ true,
    ["sign", "verify"]
  );

  const [publicKeyBytes, privateKeyJwk, address] = await Promise.all([
    crypto.subtle
      .exportKey("raw", keyPair.publicKey)
      .then((buf) => new Uint8Array(buf)),
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
    getAddressFromPublicKey(keyPair.publicKey),
  ]);

  const stored: StoredWallet = {
    privateKeyJwk,
    publicKeyBase64: base64FromBytes(publicKeyBytes),
    address,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

function loadStored(): StoredWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredWallet) : null;
  } catch {
    return null;
  }
}

/** Returns the address of an existing browser wallet, or null if none. */
export function getSavedWalletAddress(): string | null {
  return loadStored()?.address ?? null;
}

/**
 * Ensures a browser wallet exists (generates one if not) and returns its
 * address for display before the user confirms connecting.
 */
export async function prepareEphemeralWallet(): Promise<string> {
  const existing = loadStored();
  if (existing) return existing.address;
  const stored = await generateAndStore();
  return stored.address;
}

/** Wipes the stored wallet. Call when the user explicitly discards it. */
export function discardEphemeralWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createEphemeralConnector(): WalletConnector {
  return {
    id: EPHEMERAL_ID,
    name: "Browser wallet",
    icon: undefined,
    connect: async () => {
      const stored = loadStored() ?? (await generateAndStore());

      const privateKey = await crypto.subtle.importKey(
        "jwk",
        stored.privateKeyJwk,
        { name: "Ed25519" },
        false,
        ["sign"]
      );

      const publicKeyBytes = bytesFromBase64(stored.publicKeyBase64);

      const session: WalletSession = {
        account: {
          address: stored.address as Address,
          publicKey: publicKeyBytes,
        },
        connector: { id: EPHEMERAL_ID, name: "Browser wallet" },
        disconnect: async () => {
          // Keep the key in storage so auto-reconnect works on reload.
        },
        signMessage: async (message: Uint8Array) => {
          // Web Crypto requires a plain ArrayBuffer. Copying through a new
          // Uint8Array guarantees a fresh ArrayBuffer regardless of the source.
          const buf: ArrayBuffer = new Uint8Array(message).buffer as ArrayBuffer;
          const sig = await crypto.subtle.sign(
            { name: "Ed25519" },
            privateKey,
            buf
          );
          return { signedMessage: message, signature: new Uint8Array(sig) };
        },
      };

      return session;
    },
  };
}
