import { NextResponse } from "next/server";
import { deployAdminSessionWithChain } from "../../../../lib/server/spotr-store";

export const dynamic = "force-dynamic";

type DeployRequestBody = {
  adminWalletAddress?: string;
  title?: string | null;
  pairIds?: string[];
  startsAtIso?: string;
  endsAtIso?: string;
  buyInLamports?: number | null;
  cardPackItems?: Array<{
    kind: "nft" | "merch" | "gift-card" | "voucher";
    title: string;
    subtitle: string;
  }>;
  chainTxSignature?: string;
  chainSessionNumber?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DeployRequestBody;

    if (!body.adminWalletAddress) {
      return NextResponse.json(
        { error: "adminWalletAddress is required." },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.pairIds) || body.pairIds.length === 0) {
      return NextResponse.json(
        { error: "pairIds is required." },
        { status: 400 }
      );
    }
    if (!body.startsAtIso || !body.endsAtIso) {
      return NextResponse.json(
        { error: "startsAtIso and endsAtIso are required." },
        { status: 400 }
      );
    }
    if (!body.chainTxSignature || !body.chainSessionNumber) {
      return NextResponse.json(
        { error: "chainTxSignature and chainSessionNumber are required." },
        { status: 400 }
      );
    }

    const responsePayload = await deployAdminSessionWithChain({
      adminWalletAddress: body.adminWalletAddress,
      title: body.title ?? null,
      pairIds: body.pairIds,
      startsAtIso: body.startsAtIso,
      endsAtIso: body.endsAtIso,
      buyInLamports: body.buyInLamports ?? null,
      cardPackItems: body.cardPackItems,
      chainTxSignature: body.chainTxSignature,
      chainSessionNumber: body.chainSessionNumber,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to deploy session.",
      },
      { status: 400 }
    );
  }
}
