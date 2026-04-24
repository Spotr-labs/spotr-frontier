import type { WalletSession } from "./types";
import {
  buildSpotrSignedActionMessage,
  type SpotrSignedActionName,
} from "../spotr-signed-action";

export type SignedActionRequest<TPayload> = {
  walletAddress: string;
  publicKeyBase64: string;
  signedMessageBase64: string;
  signatureBase64: string;
  issuedAtIso: string;
  payload: TPayload;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function createSignedActionRequest<TPayload>(
  wallet: WalletSession,
  action: SpotrSignedActionName,
  payload: TPayload
): Promise<SignedActionRequest<TPayload>> {
  if (!wallet.signMessage) {
    throw new Error("This wallet cannot sign messages.");
  }

  const issuedAtIso = new Date().toISOString();
  const unsignedMessage = new TextEncoder().encode(
    buildSpotrSignedActionMessage(action, issuedAtIso, payload)
  );
  const { signedMessage, signature } = await wallet.signMessage(unsignedMessage);

  return {
    walletAddress: wallet.account.address,
    publicKeyBase64: bytesToBase64(wallet.account.publicKey),
    signedMessageBase64: bytesToBase64(signedMessage),
    signatureBase64: bytesToBase64(signature),
    issuedAtIso,
    payload,
  };
}
