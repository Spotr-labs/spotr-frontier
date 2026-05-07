"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { useWallet } from "../../lib/wallet/context";
import { useCluster } from "../cluster-context";
import { createSignedActionRequest } from "../../lib/wallet/signed-request";
import { submitDeploySessionOnChain } from "../../lib/chain/spotr-deploy-session";
import {
  submitAdminCloseRoundOnChain,
  submitAdminCloseSessionOnChain,
  submitCloseRoundOnChain,
  submitCreateRoundOnChain,
  submitFinalizeSessionOnChain,
  submitResolveRoundOnChain,
  submitSettleRoundOnChain,
  submitWithdrawProtocolFeesOnChain,
} from "../../lib/chain/spotr-ops";
import type { SpotrSignedActionName } from "../../lib/spotr-signed-action";

export type AdminMutationOptions = {
  successMessage?: string;
  errorMessage?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Request failed: HTTP ${response.status}`
    );
  }
  return payload;
}

export function useAdminDashboard() {
  const { wallet, signer } = useWallet();
  const { cluster } = useCluster();
  const [isPending, startTransition] = useTransition();
  const walletAddress = wallet?.account.address ?? null;
  const canSign = Boolean(wallet?.signMessage);

  const submitSignedAction = useCallback(
    async <TPayload, TResponse = unknown>(
      url: string,
      action: SpotrSignedActionName,
      payload: TPayload
    ): Promise<TResponse> => {
      if (!walletAddress || !wallet) {
        throw new Error("Connect a wallet before submitting this action.");
      }
      if (!wallet.signMessage) {
        throw new Error("This wallet cannot sign SPOTR requests.");
      }
      const signedRequest = await createSignedActionRequest(
        wallet,
        action,
        payload
      );
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedRequest),
      });
      return readJson<TResponse>(response);
    },
    [wallet, walletAddress]
  );

  const runAction = useCallback(
    <TPayload, TResponse = unknown>(
      url: string,
      action: SpotrSignedActionName,
      payload: TPayload,
      options?: AdminMutationOptions & {
        onSuccess?: (response: TResponse) => void;
      }
    ) => {
      startTransition(() => {
        void (async () => {
          try {
            const response = await submitSignedAction<TPayload, TResponse>(
              url,
              action,
              payload
            );
            if (options?.successMessage) {
              toast.success(options.successMessage);
            }
            options?.onSuccess?.(response);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : options?.errorMessage ?? "Admin action failed.";
            toast.error(message);
          }
        })();
      });
    },
    [submitSignedAction]
  );

  const createRoundOnChain = useCallback(
    async (params: { sessionNumber: bigint; roundIndex: number; pairId: string }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      const pairIdBytes = new Uint8Array(32);
      const encoded = new TextEncoder().encode(params.pairId);
      pairIdBytes.set(encoded.slice(0, 32));
      return submitCreateRoundOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
        roundIndex: params.roundIndex,
        pairId: pairIdBytes,
      });
    },
    [cluster, signer]
  );

  const closeRoundOnChain = useCallback(
    async (params: { sessionNumber: bigint; roundIndex: number }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitCloseRoundOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
        roundIndex: params.roundIndex,
      });
    },
    [cluster, signer]
  );
  const adminCloseRoundOnChain = useCallback(
    async (params: { sessionNumber: bigint; roundIndex: number }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitAdminCloseRoundOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
        roundIndex: params.roundIndex,
      });
    },
    [cluster, signer]
  );
  const adminCloseSessionOnChain = useCallback(
    async (params: {
      sessionNumber: bigint;
      openRoundIndices: number[];
    }): Promise<{ roundSignatures: string[]; sessionSignature: string }> => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      const roundSignatures: string[] = [];
      for (const roundIndex of params.openRoundIndices) {
        const { signature } = await submitAdminCloseRoundOnChain({
          cluster,
          signer,
          sessionNumber: params.sessionNumber,
          roundIndex,
        });
        roundSignatures.push(signature);
      }
      const { signature: sessionSignature } =
        await submitAdminCloseSessionOnChain({
          cluster,
          signer,
          sessionNumber: params.sessionNumber,
        });
      return { roundSignatures, sessionSignature };
    },
    [cluster, signer]
  );
  const resolveRoundOnChain = useCallback(
    async (params: {
      sessionNumber: bigint;
      roundIndex: number;
      winningSide: "A" | "B";
    }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitResolveRoundOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
        roundIndex: params.roundIndex,
        winningSide: params.winningSide,
      });
    },
    [cluster, signer]
  );
  const settleRoundOnChain = useCallback(
    async (params: {
      sessionNumber: bigint;
      roundIndex: number;
      winningPositions: Address[];
    }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitSettleRoundOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
        roundIndex: params.roundIndex,
        winningPositions: params.winningPositions,
      });
    },
    [cluster, signer]
  );
  const finalizeSessionOnChain = useCallback(
    async (params: { sessionNumber: bigint }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitFinalizeSessionOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
      });
    },
    [cluster, signer]
  );
  const withdrawProtocolFeesOnChain = useCallback(
    async (params: { sessionNumber: bigint }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitWithdrawProtocolFeesOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
      });
    },
    [cluster, signer]
  );

  const deploySessionOnChain = useCallback(
    async (params: {
      sessionNumber: bigint;
      startTsSeconds: bigint;
      endTsSeconds: bigint;
      pairIds: string[];
      buyInUsdcUnits?: bigint;
    }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitDeploySessionOnChain({
        cluster,
        admin: signer,
        sessionNumber: params.sessionNumber,
        startTsSeconds: params.startTsSeconds,
        endTsSeconds: params.endTsSeconds,
        pairIds: params.pairIds,
        buyInUsdcUnits: params.buyInUsdcUnits,
      });
    },
    [cluster, signer]
  );

  const deployExistingSessionOnChain = useCallback(
    async (params: {
      sessionId: string;
      startsAtIso: string;
      endsAtIso: string;
      pairIds: string[];
      buyInLamports: number;
    }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      if (!walletAddress) throw new Error("Connect an admin wallet first.");
      const sessionNumber =
        BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      const { signature } = await submitDeploySessionOnChain({
        cluster,
        admin: signer,
        sessionNumber,
        startTsSeconds: BigInt(Math.floor(new Date(params.startsAtIso).getTime() / 1000)),
        endTsSeconds: BigInt(Math.floor(new Date(params.endsAtIso).getTime() / 1000)),
        pairIds: params.pairIds,
        buyInUsdcUnits: BigInt(params.buyInLamports),
      });
      const response = await fetch(
        `/api/admin/sessions/${params.sessionId}/deploy-chain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminWalletAddress: walletAddress,
            chainTxSignature: signature,
            chainSessionNumber: sessionNumber.toString(),
          }),
        }
      );
      return readJson<{ ok: boolean; chainSessionAddress: string }>(response);
    },
    [cluster, signer, walletAddress]
  );

  const fetchAdmin = useCallback(
    async <T>(path: string): Promise<T> => {
      if (!walletAddress) {
        throw new Error("Connect an admin wallet first.");
      }
      const url = path.includes("?")
        ? `${path}&wallet=${encodeURIComponent(walletAddress)}`
        : `${path}?wallet=${encodeURIComponent(walletAddress)}`;
      const response = await fetch(url, { cache: "no-store" });
      return readJson<T>(response);
    },
    [walletAddress]
  );

  return {
    walletAddress,
    canSign,
    isPending,
    cluster,
    signer,
    submitSignedAction,
    runAction,
    createRoundOnChain,
    closeRoundOnChain,
    adminCloseRoundOnChain,
    adminCloseSessionOnChain,
    resolveRoundOnChain,
    settleRoundOnChain,
    finalizeSessionOnChain,
    withdrawProtocolFeesOnChain,
    deploySessionOnChain,
    deployExistingSessionOnChain,
    fetchAdmin,
  };
}
