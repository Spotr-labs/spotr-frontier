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
  ChainVerificationError,
  PendingChainVerificationError,
} from "../../../lib/server/chain-verifier";
import {
  executeSessionJoin,
  INSUFFICIENT_VAULT_ERROR,
  InsufficientVaultError,
} from "../../../lib/server/session-join";

export const dynamic = "force-dynamic";

type JoinBody = {
  sessionId?: string | null;
  referrerWallet?: string | null;
};

export async function POST(request: Request) {
  try {
    const walletAddress = await getPlayerWalletFromRequest(request);
    consumeSignedActionToken(walletAddress, "session/join");

    let body: JoinBody = {};
    try {
      body = (await request.json()) as JoinBody;
    } catch {
      // empty body is fine — sessionId will resolve to the primary session
    }
    const sessionId = body.sessionId?.trim() || null;
    const referrerWallet = body.referrerWallet?.trim() || null;
    const responsePayload = await executeSessionJoin({
      walletAddress,
      referrerWallet,
      sessionId,
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
    if (error instanceof InsufficientVaultError) {
      return NextResponse.json(
        {
          error: INSUFFICIENT_VAULT_ERROR,
          needed: error.needed,
          have: error.have,
        },
        { status: 400 },
      );
    }
    if (error instanceof SolanaTxError) {
      return NextResponse.json(
        { error: error.report.message, code: error.code, hint: error.report.hint },
        { status: error.status },
      );
    }
    if (error instanceof PendingChainVerificationError) {
      return NextResponse.json(
        { error: error.message, code: "JOIN_TX_PENDING", hint: "Retry in a moment." },
        { status: 503 },
      );
    }
    if (error instanceof ChainVerificationError) {
      return NextResponse.json(
        { error: error.message, code: "CHAIN_VERIFICATION_FAILED" },
        { status: error.retriable ? 503 : 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to join session." },
      { status: 400 },
    );
  }
}
