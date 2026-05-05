import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { recordRoundDeposit } from "../../../lib/server/spotr-store";
import {
  PrivyAuthError,
  getPlayerWalletFromRequest,
} from "../../../lib/server/privy-auth";
import {
  loadSponsorSigner,
  submitSponsoredTx,
  getSponsorRpcUrl,
} from "../../../lib/server/sponsor-tx";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../lib/server/rate-limit";
import { ValidationError } from "../../../lib/server/validators";
import { prisma } from "../../../lib/server/db";
import { findSpotrSessionPda } from "../../../lib/chain/session-pda";
import { findSpotrRoundPda } from "../../../lib/chain/round-pda";
import { findVaultTokensPda } from "../../../generated/spotr/pdas/vaultTokens";
import { getDepositForRoundInstructionAsync } from "../../../generated/spotr/instructions/depositForRound";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

export const INSUFFICIENT_VAULT_ERROR = "INSUFFICIENT_VAULT";

const MIN_DEPOSIT_USDC_UNITS = 1_000_000n;

type DepositBody = {
  roundId?: string;
  amountLamports?: number | string;
};

async function fetchTokenBalance(rpcUrl: string, tokenAccount: string): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountBalance",
      params: [tokenAccount],
    }),
    cache: "no-store",
  });
  if (!res.ok) return 0n;
  const json = (await res.json()) as {
    result?: { value?: { amount?: string } } | null;
  };
  if (!json.result?.value?.amount) return 0n;
  return BigInt(json.result.value.amount);
}

export async function POST(request: Request) {
  try {
    const walletAddress = await getPlayerWalletFromRequest(request);
    consumeSignedActionToken(walletAddress, "rounds/deposit");

    const body = (await request.json()) as DepositBody;
    const roundId = typeof body.roundId === "string" ? body.roundId.trim() : "";
    const amountRaw = body.amountLamports;

    if (!roundId) {
      return NextResponse.json({ error: "roundId is required." }, { status: 400 });
    }
    let amount: bigint;
    try {
      amount = BigInt(amountRaw ?? 0);
    } catch {
      return NextResponse.json(
        { error: "amountLamports must be a positive integer." },
        { status: 400 },
      );
    }
    if (amount < MIN_DEPOSIT_USDC_UNITS) {
      return NextResponse.json(
        { error: `deposit must be at least ${MIN_DEPOSIT_USDC_UNITS} USDC units.` },
        { status: 400 },
      );
    }

    const round = await prisma.sessionRound.findUnique({
      where: { id: roundId },
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
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }
    if (round.session.chainSessionNumber == null) {
      return NextResponse.json(
        { error: "Session has not been deployed on-chain yet." },
        { status: 400 },
      );
    }

    const cluster = publicSpotrConfig.cluster;
    const rpcUrl = getSponsorRpcUrl(cluster);

    const sessionNumber = BigInt(round.session.chainSessionNumber.toString());
    const playerAddr = address(walletAddress);
    const [sessionAddress] = await findSpotrSessionPda(sessionNumber);
    const [roundAddress] = await findSpotrRoundPda({
      session: sessionAddress,
      index: round.roundIndex,
    });
    const [vaultTokensPda] = await findVaultTokensPda({ player: playerAddr });

    const balance = await fetchTokenBalance(rpcUrl, String(vaultTokensPda));
    if (balance < amount) {
      return NextResponse.json(
        {
          error: INSUFFICIENT_VAULT_ERROR,
          needed: amount.toString(),
          have: balance.toString(),
        },
        { status: 400 },
      );
    }

    const sponsor = await loadSponsorSigner();
    const ix = await getDepositForRoundInstructionAsync({
      sponsor,
      player: playerAddr,
      session: sessionAddress,
      round: roundAddress,
      amountUsdcUnits: amount,
    });

    const signature = await submitSponsoredTx(cluster, [ix]);

    const responsePayload = await recordRoundDeposit({
      walletAddress,
      roundId,
      amountLamports: amount,
      chainTxSignature: signature,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (error instanceof PrivyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to deposit." },
      { status: 400 },
    );
  }
}
