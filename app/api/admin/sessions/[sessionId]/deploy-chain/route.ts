import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/server/db";
import { AdminAuthError } from "../../../_lib/auth";
import { serverSpotrConfig } from "../../../../../lib/spotr-config/server";
import { publicSpotrConfig } from "../../../../../lib/spotr-config/public";
import { SolanaTxError } from "../../../../../lib/wallet/solana-errors";

export const dynamic = "force-dynamic";

type Body = {
  adminWalletAddress?: string;
  chainTxSignature?: string;
  chainSessionNumber?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as Body;

    const adminWalletAddress = body.adminWalletAddress?.trim();
    const chainTxSignature = body.chainTxSignature?.trim();
    const chainSessionNumberStr = body.chainSessionNumber?.trim();

    if (!adminWalletAddress) {
      return NextResponse.json({ error: "adminWalletAddress is required." }, { status: 400 });
    }
    if (!chainTxSignature) {
      return NextResponse.json({ error: "chainTxSignature is required." }, { status: 400 });
    }
    if (!chainSessionNumberStr) {
      return NextResponse.json({ error: "chainSessionNumber is required." }, { status: 400 });
    }

    if (!serverSpotrConfig.adminWallets.includes(adminWalletAddress)) {
      throw new AdminAuthError("Wallet is not configured for admin access.");
    }

    let chainSessionNumber: bigint;
    try {
      chainSessionNumber = BigInt(chainSessionNumberStr);
    } catch {
      return NextResponse.json({ error: "chainSessionNumber must be a valid integer." }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, chainSessionNumber: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    if (session.chainSessionNumber != null) {
      return NextResponse.json({ error: "Session is already deployed on-chain." }, { status: 409 });
    }
    if (session.status !== "PENDING") {
      return NextResponse.json({ error: "Only PENDING sessions can be deployed on-chain." }, { status: 400 });
    }

    const { verifyCreateSessionTx } = await import("../../../../../lib/server/chain-verifier");
    const verified = await verifyCreateSessionTx({
      cluster: publicSpotrConfig.cluster,
      signature: chainTxSignature,
      expectedAdmin: adminWalletAddress,
      expectedSessionNumber: chainSessionNumber,
    });

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        chainSessionNumber,
        chainSessionAddress: verified.sessionAddress,
        chainDeployTxSignature: chainTxSignature,
      },
    });

    await prisma.transactionLog.create({
      data: {
        sessionId,
        walletAddress: adminWalletAddress,
        kind: "admin_deploy_session",
        metadataJson: JSON.stringify({
          chainTxSignature,
          chainSessionNumber: chainSessionNumber.toString(),
          chainSessionAddress: verified.sessionAddress,
          chainSlot: verified.slot,
        }),
      },
    });

    return NextResponse.json({ ok: true, chainSessionAddress: verified.sessionAddress });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof SolanaTxError) {
      return NextResponse.json(
        { error: error.report.message, code: error.code, hint: error.report.hint },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Deploy failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
