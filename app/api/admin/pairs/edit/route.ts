import { NextResponse } from "next/server";
import { editAdminPair } from "../../../../lib/server/spotr-store";
import { verifySignedSpotrAction } from "../../../../lib/server/signed-action";
import {
  ValidationError,
  parseAdminEditPairPayload,
  parseSignedEnvelope,
} from "../../../../lib/server/validators";
import {
  RateLimitError,
  consumeSignedActionToken,
} from "../../../../lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const envelope = parseSignedEnvelope(body, parseAdminEditPairPayload);
    consumeSignedActionToken(envelope.walletAddress, "admin/pairs/edit");
    const { payload } = await verifySignedSpotrAction(
      "admin-edit-pair",
      envelope
    );
    await editAdminPair({
      adminWalletAddress: payload.adminWalletAddress,
      id: payload.id,
      category: payload.category,
      sideA: payload.sideA,
      sideB: payload.sideB,
      crowdLabel: payload.crowdLabel,
      defaultSideAPct: payload.defaultSideAPct,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof ValidationError
        ? 400
        : error instanceof RateLimitError
          ? 429
          : 400;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to edit pair.",
      },
      { status }
    );
  }
}
