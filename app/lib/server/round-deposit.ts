import { address } from "@solana/kit";
import { prisma } from "./db";
import { publicSpotrConfig } from "../spotr-config/public";
import { findSpotrSessionPda } from "../chain/session-pda";
import { findSpotrRoundPda } from "../chain/round-pda";
import { findRoundDepositPda } from "../../generated/spotr/pdas/roundDeposit";
import { findVaultTokensPda } from "../../generated/spotr/pdas/vaultTokens";
import { getDepositForRoundInstructionAsync } from "../../generated/spotr/instructions/depositForRound";
import {
  getSponsorRpcUrl,
  loadSponsorSigner,
  submitSponsoredTx,
} from "./sponsor-tx";
import { fetchAccountExists, fetchTokenBalance } from "./rpc-account";
import { getSpotrDashboardPayload, recordRoundDeposit } from "./spotr-store";
import { shouldReturnMutationPayload } from "./auto-fill-bots.shared";
import { SolanaTxError } from "../wallet/solana-errors";

export const INSUFFICIENT_VAULT_ERROR = "INSUFFICIENT_VAULT";
export const MIN_DEPOSIT_USDC_UNITS = 1_000_000n;

export class InsufficientRoundVaultError extends Error {
  readonly needed: string;
  readonly have: string;

  constructor(needed: bigint, have: bigint) {
    super(INSUFFICIENT_VAULT_ERROR);
    this.name = "InsufficientRoundVaultError";
    this.needed = needed.toString();
    this.have = have.toString();
  }
}

function isRoundDepositAlreadyOnChainError(error: unknown) {
  return (
    error instanceof SolanaTxError &&
    error.report.logs?.some(
      (line) =>
        line.includes("Allocate: account") && line.includes("already in use")
    ) === true
  );
}

export async function reconcileExistingRoundDeposit(input: {
  walletAddress: string;
  roundId: string;
  amountLamports: bigint;
  actor?: "player" | "bot";
  returnPayload?: boolean;
}) {
  const round = await prisma.sessionRound.findUnique({
    where: { id: input.roundId },
    include: {
      session: {
        select: {
          id: true,
          chainSessionNumber: true,
          roundFillThreshold: true,
        },
      },
    },
  });
  if (!round || round.session.chainSessionNumber == null) {
    return null;
  }

  const cluster = publicSpotrConfig.cluster;
  const rpcUrl = getSponsorRpcUrl(cluster);
  const playerAddr = address(input.walletAddress);
  const sessionNumber = BigInt(round.session.chainSessionNumber.toString());
  const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress,
    index: round.roundIndex,
  });
  const [roundDepositPda] = await findRoundDepositPda({
    round: roundAddress,
    player: playerAddr,
  });
  const existsOnChain = await fetchAccountExists(rpcUrl, String(roundDepositPda));
  if (!existsOnChain) {
    return null;
  }

  const existingDbDeposit = await prisma.roundDeposit.findFirst({
    where: {
      roundId: input.roundId,
      walletAddress: input.walletAddress,
    },
    select: { id: true },
  });
  if (existingDbDeposit) {
    const payload =
      input.returnPayload === false
        ? null
        : await getSpotrDashboardPayload(input.walletAddress, round.session.id);
    return {
      payload,
      summary: {
        roundId: round.id,
        sessionId: round.session.id,
        previousStatus: round.status,
        statusAfter: round.status,
        previousDepositsCount: round.depositsCount,
        newDepositsCount: round.depositsCount,
        fillThreshold: round.session.roundFillThreshold,
      },
    };
  }

  return recordRoundDeposit({
    walletAddress: input.walletAddress,
    roundId: input.roundId,
    amountLamports: input.amountLamports,
    actor: input.actor,
    returnPayload: input.returnPayload,
  });
}

export async function executeRoundDeposit(input: {
  walletAddress: string;
  roundId: string;
  amountLamports: bigint;
  actor?: "player" | "bot";
  returnPayload?: boolean;
}) {
  if (input.amountLamports < MIN_DEPOSIT_USDC_UNITS) {
    throw new Error(
      `deposit must be at least ${MIN_DEPOSIT_USDC_UNITS} USDC units.`
    );
  }

  const round = await prisma.sessionRound.findUnique({
    where: { id: input.roundId },
    include: {
      session: {
        select: {
          id: true,
          chainSessionNumber: true,
        },
      },
    },
  });
  if (!round) {
    throw new Error("Round not found.");
  }
  if (round.session.chainSessionNumber == null) {
    throw new Error("Session has not been deployed on-chain yet.");
  }

  const cluster = publicSpotrConfig.cluster;
  const rpcUrl = getSponsorRpcUrl(cluster);

  const sessionNumber = BigInt(round.session.chainSessionNumber.toString());
  const playerAddr = address(input.walletAddress);
  const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
  const [roundAddress] = await findSpotrRoundPda({
    session: sessionAddress,
    index: round.roundIndex,
  });
  const [vaultTokensPda] = await findVaultTokensPda({ player: playerAddr });

  const balance = await fetchTokenBalance(rpcUrl, String(vaultTokensPda));
  if (balance < input.amountLamports) {
    throw new InsufficientRoundVaultError(input.amountLamports, balance);
  }

  const sponsor = await loadSponsorSigner();
  const ix = await getDepositForRoundInstructionAsync({
    sponsor,
    player: playerAddr,
    session: sessionAddress,
    round: roundAddress,
    amountUsdcUnits: input.amountLamports,
  });

  let signature: string;
  try {
    signature = await submitSponsoredTx(cluster, [ix]);
  } catch (error) {
    if (isRoundDepositAlreadyOnChainError(error)) {
      const reconciled = await reconcileExistingRoundDeposit(input);
      if (reconciled) {
        return reconciled;
      }
    }
    throw error;
  }

  return recordRoundDeposit({
    walletAddress: input.walletAddress,
    roundId: input.roundId,
    amountLamports: input.amountLamports,
    chainTxSignature: signature,
    actor: input.actor ?? "player",
    returnPayload: shouldReturnMutationPayload(
      input.actor,
      input.returnPayload
    ),
  });
}
