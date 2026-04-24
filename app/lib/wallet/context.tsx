"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type PropsWithChildren,
} from "react";
import type { TransactionSigner } from "@solana/kit";
import type { WalletConnector, WalletSession } from "./types";
import { discoverWallets, watchWallets } from "./standard";
import { createEphemeralConnector } from "./ephemeral";
import { createWalletSigner } from "./signer";
import { useCluster } from "../../components/cluster-context";

const WALLET_STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
} as const;

type WalletStatus = (typeof WALLET_STATUS)[keyof typeof WALLET_STATUS];

type WalletContextValue = {
  connectors: WalletConnector[];
  status: WalletStatus;
  wallet: WalletSession | undefined;
  signer: TransactionSigner | undefined;
  error: unknown;
  connect: (connectorId: string) => Promise<void>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  isReady: boolean;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export const STORAGE_KEY = "solana:last-connector";
const CONNECT_TIMEOUT_MS = 10_000;

type WalletProviderProps = PropsWithChildren<{
  /**
   * Additional WalletConnectors injected from above (e.g. the Privy bridge).
   * Identity is preserved across renders; swap in a new array only when the
   * identities change.
   */
  extraConnectors?: WalletConnector[];
}>;

export function WalletProvider({ children, extraConnectors }: WalletProviderProps) {
  const { cluster } = useCluster();
  const chain = `solana:${cluster}`;

  const [discovered, setDiscovered] = useState<WalletConnector[]>(() =>
    typeof window === "undefined" ? [] : discoverWallets()
  );
  const connectors = useMemo(
    () => [
      ...(extraConnectors ?? []),
      ...discovered,
      createEphemeralConnector(),
    ],
    [discovered, extraConnectors]
  );
  const [session, setSession] = useState<WalletSession | undefined>();
  const [status, setStatus] = useState<WalletStatus>(
    WALLET_STATUS.DISCONNECTED
  );
  const [error, setError] = useState<unknown>();
  const isReady = typeof window !== "undefined";

  const connectorsRef = useRef<WalletConnector[]>(connectors);
  useEffect(() => {
    connectorsRef.current = connectors;
  }, [connectors]);
  const attemptIdRef = useRef(0);

  // Track extra-connector IDs so auto-reconnect can skip them — those
  // connectors (e.g. Privy) restore their own session independently.
  const extraIdsRef = useRef<Set<string>>(
    new Set(extraConnectors?.map((c) => c.id) ?? [])
  );
  useEffect(() => {
    extraIdsRef.current = new Set(extraConnectors?.map((c) => c.id) ?? []);
  }, [extraConnectors]);

  const autoConnectDoneRef = useRef(false);

  const handleWalletsChanged = useCallback((updated: WalletConnector[]) => {
    setDiscovered(updated);
    console.log(
      "[wallet] discovered",
      updated.map((c) => c.id)
    );
  }, []);

  useEffect(() => {
    console.log(
      "[wallet] initial connectors",
      connectorsRef.current.map((c) => c.id)
    );
    const unsubscribe = watchWallets(handleWalletsChanged);
    return unsubscribe;
  }, [handleWalletsChanged]);

  const connect = useCallback(async (connectorId: string) => {
    const connector = connectorsRef.current.find((c) => c.id === connectorId);
    if (!connector) {
      console.error("[wallet] unknown connector", connectorId);
      throw new Error(`Unknown connector: ${connectorId}`);
    }

    const myAttempt = ++attemptIdRef.current;
    console.log(
      `[wallet] connect attempt #${myAttempt} -> ${connectorId}`,
      connector
    );
    setStatus(WALLET_STATUS.CONNECTING);
    setError(undefined);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `No response from ${connectorId} after ${CONNECT_TIMEOUT_MS / 1000}s. Open the extension from your browser toolbar — it may be locked or the popup may be hidden.`
            )
          );
        }, CONNECT_TIMEOUT_MS);
      });

      console.log(`[wallet] calling ${connectorId}.connect()`);
      const s = await Promise.race([connector.connect(), timeoutPromise]);

      if (myAttempt !== attemptIdRef.current) {
        console.log(
          `[wallet] attempt #${myAttempt} superseded, discarding result`
        );
        return;
      }
      console.log(
        `[wallet] attempt #${myAttempt} resolved: ${s.account.address}`
      );
      setSession(s);
      setStatus(WALLET_STATUS.CONNECTED);
      localStorage.setItem(STORAGE_KEY, connectorId);
    } catch (err) {
      if (myAttempt !== attemptIdRef.current) {
        console.log(`[wallet] attempt #${myAttempt} errored but superseded`);
        return;
      }
      console.error(`[wallet] attempt #${myAttempt} failed:`, err);
      setError(err);
      setStatus(WALLET_STATUS.ERROR);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }, []);

  const cancelConnect = useCallback(() => {
    console.log("[wallet] cancelConnect");
    ++attemptIdRef.current;
    setStatus(WALLET_STATUS.DISCONNECTED);
    setError(undefined);
  }, []);

  useEffect(() => {
    if (autoConnectDoneRef.current) return;
    autoConnectDoneRef.current = true;
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (!savedId) return;
    if (extraIdsRef.current.has(savedId)) return;
    connect(savedId).catch(() => {
      setStatus(WALLET_STATUS.DISCONNECTED);
      setError(undefined);
      localStorage.removeItem(STORAGE_KEY);
    });
  }, [connect]);

  const disconnect = useCallback(async () => {
    ++attemptIdRef.current;
    if (session) {
      try {
        await session.disconnect();
      } catch {
        /* ignore */
      }
    }
    setSession(undefined);
    setStatus(WALLET_STATUS.DISCONNECTED);
    setError(undefined);
    localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  const signer = useMemo(
    () => (session ? createWalletSigner(session, chain) : undefined),
    [session, chain]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      connectors,
      status,
      wallet: session,
      signer,
      error,
      connect,
      cancelConnect,
      disconnect,
      isReady,
    }),
    [
      connectors,
      status,
      session,
      signer,
      error,
      connect,
      cancelConnect,
      disconnect,
      isReady,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
