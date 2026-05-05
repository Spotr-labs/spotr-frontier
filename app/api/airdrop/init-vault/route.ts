import "server-only";
import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import {
  loadSponsorSigner,
  submitSponsoredTx,
  getSponsorRpcUrl,
} from "../../../lib/server/sponsor-tx";
import { getInitUserVaultInstructionAsync } from "../../../generated/spotr/instructions/initUserVault";
import { findVaultPda } from "../../../generated/spotr/pdas/vault";
import { publicSpotrConfig } from "../../../lib/spotr-config/public";

export const dynamic = "force-dynamic";

type Body = { wallet?: string };

async function vaultExists(rpcUrl: string, pda: string): Promise<boolean> {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.wallet) {
      return NextResponse.json(
        { error: "wallet is required." },
        { status: 400 },
      );
    }
    const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT_ADDRESS;
    if (!usdcMint) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_USDC_MINT_ADDRESS is not set." },
        { status: 500 },
      );
    }

    const cluster = publicSpotrConfig.cluster;
    const rpcUrl = getSponsorRpcUrl(cluster);
    const playerAddr = address(body.wallet);

    const [vaultPda] = await findVaultPda({ player: playerAddr });
    if (await vaultExists(rpcUrl, String(vaultPda))) {
      return NextResponse.json({ alreadyInitialized: true });
    }

    const sponsor = await loadSponsorSigner();
    const ix = await getInitUserVaultInstructionAsync({
      sponsor,
      owner: playerAddr,
      usdcMint: address(usdcMint),
    });

    const signature = await submitSponsoredTx(cluster, [ix]);
    return NextResponse.json({ signature });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to init vault.",
      },
      { status: 500 },
    );
  }
}
