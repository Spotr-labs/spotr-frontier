import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { joinSpotrSession } from "../../../lib/server/spotr-store";
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
import { SolanaTxError } from "../../../lib/wallet/solana-errors";
import { prisma } from "../../../lib/server/db";
import { findSpotrSessionPda } from "../../../lib/chain/session-pda";
import { findVaultPda } from "../../../generated/spotr/pdas/vault";
import { findVaultTokensPda } from "../../../generated/spotr/pdas/vaultTokens";
import { getJoinSessionInstructionAsync } from "../../../generated/spotr/instructions/joinSession";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

export const INSUFFICIENT_VAULT_ERROR = "INSUFFICIENT_VAULT";

type JoinBody = {
  sessionId?: string | null;
  referrerWallet?: string | null;
};

async function fetchAccountExists(rpcUrl: string, pda: string): Promise<boolean> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [pda, { encoding: "base64" }],
    }),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { result?: { value: unknown } | null };
  return json.result?.value != null;
}

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
    consumeSignedActionToken(walletAddress, "session/join");

    let body: JoinBody = {};
    try {
      body = (await request.json()) as JoinBody;
    } catch {
      // empty body is fine — sessionId will resolve to the primary session
    }
    const sessionId = body.sessionId?.trim() || null;
    const referrerWallet = body.referrerWallet?.trim() || null;

    const cluster = publicSpotrConfig.cluster;
    const rpcUrl = getSponsorRpcUrl(cluster);

    // Look up the on-chain session number for the target session.
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
      return NextResponse.json(
        {
          error:
            "This session has not been deployed on-chain yet. Ask an admin to deploy it before joining.",
        },
        { status: 400 },
      );
    }

    const sessionNumber = BigInt(sessionRow.chainSessionNumber.toString());
    const buyIn = BigInt(sessionRow.buyInLamports.toString());
    const playerAddr = address(walletAddress);
    const [sessionAddress] = await findSpotrSessionPda(sessionNumber);

    // Vault must exist and have at least the buy-in. Surface a friendly
    // error so the UI can route the player back to /airdrop.
    const [vaultPda] = await findVaultPda({ player: playerAddr });
    const [vaultTokensPda] = await findVaultTokensPda({ player: playerAddr });

    const vaultExists = await fetchAccountExists(rpcUrl, String(vaultPda));
    if (!vaultExists) {
      return NextResponse.json(
        {
          error: INSUFFICIENT_VAULT_ERROR,
          needed: buyIn.toString(),
          have: "0",
        },
        { status: 400 },
      );
    }

    if (buyIn > 0n) {
      const balance = await fetchTokenBalance(rpcUrl, String(vaultTokensPda));
      if (balance < buyIn) {
        return NextResponse.json(
          {
            error: INSUFFICIENT_VAULT_ERROR,
            needed: buyIn.toString(),
            have: balance.toString(),
          },
          { status: 400 },
        );
      }
    }

    const sponsor = await loadSponsorSigner();
    const ix = await getJoinSessionInstructionAsync({
      sponsor,
      player: playerAddr,
      session: sessionAddress,
    });

    const signature = await submitSponsoredTx(cluster, [ix]);

    const responsePayload = await joinSpotrSession({
      walletAddress,
      referrerWallet,
      chainTxSignature: signature,
      sessionId: sessionRow.id,
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
    if (error instanceof SolanaTxError) {
      return NextResponse.json(
        { error: error.report.message, code: error.code, hint: error.report.hint },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to join session." },
      { status: 400 },
    );
  }
}
