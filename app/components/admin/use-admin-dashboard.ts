"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import { useWallet } from "../../lib/wallet/context";
import { useCluster } from "../cluster-context";
import { createSignedActionRequest } from "../../lib/wallet/signed-request";
import { submitDeploySessionOnChain } from "../../lib/chain/spotr-deploy-session";
import {
  submitCloseRoundOnChain,
  submitFinalizeSessionOnChain,
  submitSweepOrphansOnChain,
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
  const sweepOrphansOnChain = useCallback(
    async (params: { sessionNumber: bigint; roundIndex: number }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitSweepOrphansOnChain({
        cluster,
        signer,
        sessionNumber: params.sessionNumber,
        roundIndex: params.roundIndex,
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
    }) => {
      if (!signer) throw new Error("Connect an admin wallet that can sign.");
      return submitDeploySessionOnChain({
        cluster,
        admin: signer,
        sessionNumber: params.sessionNumber,
        startTsSeconds: params.startTsSeconds,
        endTsSeconds: params.endTsSeconds,
      });
    },
    [cluster, signer]
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
    closeRoundOnChain,
    sweepOrphansOnChain,
    finalizeSessionOnChain,
    withdrawProtocolFeesOnChain,
    deploySessionOnChain,
    fetchAdmin,
  };
}
