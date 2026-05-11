import { NextResponse } from "next/server";
import {
  PrivyAuthError,
  getPlayerWalletFromRequest,
} from "../../../lib/server/privy-auth";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../lib/server/rate-limit";
import { ValidationError } from "../../../lib/server/validators";
import { SolanaTxError } from "../../../lib/wallet/solana-errors";
import {
  executeRoundDeposit,
  INSUFFICIENT_VAULT_ERROR,
  InsufficientRoundVaultError,
  MIN_DEPOSIT_USDC_UNITS,
} from "../../../lib/server/round-deposit";
import {
  queueDueAutoFillForRound,
  scheduleAutoFillForRound,
} from "../../../lib/server/auto-fill-bots";

export const dynamic = "force-dynamic";

type DepositBody = {
  roundId?: string;
  amountLamports?: number | string;
};

export async function POST(request: Request) {
  try {
    const walletAddress = await getPlayerWalletFromRequest(request);
    consumeSignedActionToken(walletAddress, "rounds/deposit");

    const body = (await request.json()) as DepositBody;
    const roundId = typeof body.roundId === "string" ? body.roundId.trim() : "";
    const amountRaw = body.amountLamports;

    if (!roundId) {
      return NextResponse.json(
        { error: "roundId is required." },
        { status: 400 }
      );
    }
    let amount: bigint;
    try {
      amount = BigInt(amountRaw ?? 0);
    } catch {
      return NextResponse.json(
        { error: "amountLamports must be a positive integer." },
        { status: 400 }
      );
    }
    if (amount < MIN_DEPOSIT_USDC_UNITS) {
      return NextResponse.json(
        {
          error: `deposit must be at least ${MIN_DEPOSIT_USDC_UNITS} USDC units.`,
        },
        { status: 400 }
      );
    }
    const result = await executeRoundDeposit({
      walletAddress,
      roundId,
      amountLamports: amount,
      actor: "player",
    });
    const scheduled = await scheduleAutoFillForRound({
      ...result.summary,
      actor: "player",
    });
    if (scheduled) {
      queueDueAutoFillForRound({
        roundId: result.summary.roundId,
        sessionId: result.summary.sessionId,
      });
    }

    return NextResponse.json(result.payload);
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
    if (error instanceof InsufficientRoundVaultError) {
      return NextResponse.json(
        {
          error: INSUFFICIENT_VAULT_ERROR,
          needed: error.needed,
          have: error.have,
        },
        { status: 400 }
      );
    }
    if (error instanceof SolanaTxError) {
      return NextResponse.json(
        {
          error: error.report.message,
          code: error.code,
          hint: error.report.hint,
        },
        { status: error.status }
      );
    }
    if (error instanceof Error && error.message === "Round not found.") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to deposit." },
      { status: 400 }
    );
  }
}
