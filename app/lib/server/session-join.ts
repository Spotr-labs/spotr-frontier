import { address } from "@solana/kit";
import { prisma } from "./db";
import { findSpotrSessionPda } from "../chain/session-pda";
import { findPlayerSessionPda } from "../../generated/spotr/pdas/playerSession";
import { findVaultPda } from "../../generated/spotr/pdas/vault";
import { findVaultTokensPda } from "../../generated/spotr/pdas/vaultTokens";
import { getJoinSessionInstructionAsync } from "../../generated/spotr/instructions/joinSession";
import { publicSpotrConfig } from "../spotr-config/public";
import {
  loadSponsorSigner,
  submitSponsoredTx,
  getSponsorRpcUrl,
} from "./sponsor-tx";
import { joinSpotrSession } from "./spotr-store";
import { fetchAccountExists, fetchTokenBalance } from "./rpc-account";
import { shouldReturnMutationPayload } from "./auto-fill-bots.shared";

export const INSUFFICIENT_VAULT_ERROR = "INSUFFICIENT_VAULT";

export class InsufficientVaultError extends Error {
  readonly needed: string;
  readonly have: string;

  constructor(needed: bigint, have: bigint) {
    super(INSUFFICIENT_VAULT_ERROR);
    this.name = "InsufficientVaultError";
    this.needed = needed.toString();
    this.have = have.toString();
  }
}

export async function executeSessionJoin(input: {
  walletAddress: string;
  referrerWallet?: string | null;
  sessionId?: string | null;
  actor?: "player" | "bot";
  returnPayload?: boolean;
}) {
  const sessionId = input.sessionId?.trim() || null;
  const referrerWallet = input.referrerWallet?.trim() || null;

  const cluster = publicSpotrConfig.cluster;
  const rpcUrl = getSponsorRpcUrl(cluster);

  const sessionRow = sessionId
    ? await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          chainSessionNumber: true,
          chainSessionAddress: true,
          buyInLamports: true,
        },
      })
    : await prisma.session.findFirst({
        where: { chainSessionNumber: { not: null } },
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          chainSessionNumber: true,
          chainSessionAddress: true,
          buyInLamports: true,
        },
      });

  if (!sessionRow || sessionRow.chainSessionNumber == null) {
    throw new Error(
      "This session has not been deployed on-chain yet. Ask an admin to deploy it before joining."
    );
  }

  const sessionNumber = BigInt(sessionRow.chainSessionNumber.toString());
  const buyIn = BigInt(sessionRow.buyInLamports.toString());
  const playerAddr = address(input.walletAddress);
  const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
  const [playerSessionPda] = await findPlayerSessionPda({
    session: sessionAddress,
    player: playerAddr,
  });
  const playerSessionExists = await fetchAccountExists(
    rpcUrl,
    String(playerSessionPda)
  );

  let signature = "already-joined";
  if (!playerSessionExists) {
    const [vaultPda] = await findVaultPda({ player: playerAddr });
    const [vaultTokensPda] = await findVaultTokensPda({ player: playerAddr });

    const vaultExists = await fetchAccountExists(rpcUrl, String(vaultPda));
    if (!vaultExists) {
      throw new InsufficientVaultError(buyIn, 0n);
    }

    if (buyIn > 0n) {
      const balance = await fetchTokenBalance(rpcUrl, String(vaultTokensPda));
      if (balance < buyIn) {
        throw new InsufficientVaultError(buyIn, balance);
      }
    }

    const sponsor = await loadSponsorSigner();
    const ix = await getJoinSessionInstructionAsync({
      sponsor,
      player: playerAddr,
      session: sessionAddress,
    });

    signature = await submitSponsoredTx(cluster, [ix]);
  }

  return joinSpotrSession({
    walletAddress: input.walletAddress,
    referrerWallet,
    chainTxSignature: signature,
    sessionId: sessionRow.id,
    actor: input.actor ?? "player",
    returnPayload: shouldReturnMutationPayload(
      input.actor,
      input.returnPayload
    ),
  });
}
