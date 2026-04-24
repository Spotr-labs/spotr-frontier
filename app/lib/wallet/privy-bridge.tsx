"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";
import { address } from "@solana/kit";
import { usePrivy, useLogin, useLogout } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { useWallet, STORAGE_KEY } from "./context";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { useCluster } from "../../components/cluster-context";
import { WalletProvider } from "./context";
import type { WalletConnector, WalletSession } from "./types";

export const PRIVY_ID = "spotr:privy";

function sessionFromPrivyWallet(
  wallet: ConnectedStandardSolanaWallet,
  chain: string,
  onDisconnect: () => Promise<void>
): WalletSession {
  const addr = address(wallet.address as string);
  const features = wallet.standardWallet?.features ?? {};
  const publicKey =
    wallet.standardWallet?.accounts?.[0]?.publicKey ?? new Uint8Array();

  return {
    account: {
      address: addr,
      publicKey: new Uint8Array(publicKey),
      label: "Privy",
    },
    connector: {
      id: PRIVY_ID,
      name: "Privy",
    },
    disconnect: onDisconnect,
    signMessage: async (message) => {
      const result = await wallet.signMessage({ message });
      return {
        signedMessage: new Uint8Array(result.signedMessage),
        signature: new Uint8Array(result.signature),
      };
    },
    signTransaction: async (transaction, txChain) => {
      const result = await wallet.signTransaction({
        transaction,
        chain: (txChain || chain) as `${string}:${string}`,
      });
      return new Uint8Array(result.signedTransaction);
      // features ref kept to narrow unused-var warnings when wallet-standard
      // features are inspected by future callers.
      void features;
    },
    sendTransaction: async (transaction, txChain) => {
      const signAndSend = wallet.standardWallet.features?.[
        "solana:signAndSendTransaction"
      ] as
        | {
            signAndSendTransaction: (input: {
              account: unknown;
              transaction: Uint8Array;
              chain: string;
            }) => Promise<Array<{ signature: Uint8Array }>>;
          }
        | undefined;
      if (!signAndSend) {
        throw new Error("This Privy wallet cannot submit transactions directly.");
      }
      const [result] = await signAndSend.signAndSendTransaction({
        account: wallet.standardWallet.accounts[0],
        transaction,
        chain: txChain || chain,
      });
      return new Uint8Array(result.signature);
    },
  };
}

/**
 * Lives inside WalletProvider so it has access to useWallet(). Silently
 * re-establishes the Privy session on page reload if Privy is already
 * authenticated and the user previously connected via Privy.
 */
function PrivyAutoReconnect() {
  const { status, connect } = useWallet();
  const { authenticated } = usePrivy();
  const { wallets } = useSolanaWallets();
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    if (status !== "disconnected") return;
    if (!authenticated || wallets.length === 0) return;
    if (localStorage.getItem(STORAGE_KEY) !== PRIVY_ID) return;
    doneRef.current = true;
    connect(PRIVY_ID).catch(() => localStorage.removeItem(STORAGE_KEY));
  }, [authenticated, wallets, status, connect]);

  return null;
}

/**
 * Registers Privy as a WalletConnector inside WalletProvider. The connector's
 * `connect()` opens the Privy login modal and resolves as soon as a Solana
 * wallet (embedded or linked) is available.
 */
function PrivyConnectorBridge({ children }: PropsWithChildren) {
  const { authenticated } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { wallets } = useSolanaWallets();
  const { cluster } = useCluster();
  const chain = `solana:${cluster}`;

  const walletsRef = useRef(wallets);
  const authRef = useRef(authenticated);
  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);
  useEffect(() => {
    authRef.current = authenticated;
  }, [authenticated]);

  const waitForWallet = useCallback(
    async (timeoutMs = 60_000): Promise<ConnectedStandardSolanaWallet> => {
      const start = Date.now();
      while (Date.now() - start <= timeoutMs) {
        const next = walletsRef.current[0];
        if (next) return next;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("Timed out waiting for Privy wallet.");
    },
    []
  );

  const disconnect = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* ignore */
    }
  }, [logout]);

  const connector: WalletConnector = useMemo(
    () => ({
      id: PRIVY_ID,
      name: "Privy (email, social, embedded)",
      connect: async () => {
        if (!authRef.current) {
          login();
        }
        const wallet = await waitForWallet();
        return sessionFromPrivyWallet(wallet, chain, disconnect);
      },
    }),
    [chain, disconnect, login, waitForWallet]
  );

  const extraConnectors = useMemo(() => [connector], [connector]);

  return (
    <WalletProvider extraConnectors={extraConnectors}>
      <PrivyAutoReconnect />
      {children}
    </WalletProvider>
  );
}

export { PrivyConnectorBridge };
