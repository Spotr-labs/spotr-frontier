"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ClusterMoniker } from "../lib/solana-client";
import { CLUSTERS, DEFAULT_CLUSTER } from "../lib/solana-client";
import { getExplorerUrl } from "../lib/explorer";

const STORAGE_KEY = "spotr-cluster";

type ClusterContextValue = {
  cluster: ClusterMoniker;
  setCluster: (cluster: ClusterMoniker) => void;
  getExplorerUrl: (path: string) => string;
};

const ClusterContext = createContext<ClusterContextValue | null>(null);

export { CLUSTERS };

// External store that bridges localStorage into React. Used via
// `useSyncExternalStore` so we never need to mirror localStorage into
// component state inside an effect (which trips react-hooks/set-state-in-effect
// and is a recognised React-19 anti-pattern).
const clusterListeners = new Set<() => void>();

function subscribeToClusterStore(callback: () => void): () => void {
  clusterListeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    clusterListeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function getClusterSnapshot(): ClusterMoniker {
  if (typeof window === "undefined") return DEFAULT_CLUSTER;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (CLUSTERS as readonly string[]).includes(stored)) {
    return stored as ClusterMoniker;
  }
  return DEFAULT_CLUSTER;
}

function getClusterServerSnapshot(): ClusterMoniker {
  return DEFAULT_CLUSTER;
}

function notifyClusterListeners() {
  for (const cb of clusterListeners) cb();
}

export function ClusterProvider({ children }: { children: ReactNode }) {
  const cluster = useSyncExternalStore(
    subscribeToClusterStore,
    getClusterSnapshot,
    getClusterServerSnapshot,
  );

  const setCluster = useCallback((next: ClusterMoniker) => {
    localStorage.setItem(STORAGE_KEY, next);
    notifyClusterListeners();
  }, []);

  const explorerUrl = useMemo(
    () => (path: string) => getExplorerUrl(path, cluster),
    [cluster]
  );

  return (
    <ClusterContext.Provider
      value={{ cluster, setCluster, getExplorerUrl: explorerUrl }}
    >
      {children}
    </ClusterContext.Provider>
  );
}

export function useCluster() {
  const ctx = useContext(ClusterContext);
  if (!ctx) throw new Error("useCluster must be used within ClusterProvider");
  return ctx;
}
