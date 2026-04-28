"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
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

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [cluster, setClusterState] = useState<ClusterMoniker>(DEFAULT_CLUSTER);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ClusterMoniker | null;
    if (stored && (CLUSTERS as string[]).includes(stored)) {
      setClusterState(stored);
    }
  }, []);

  const setCluster = useCallback((next: ClusterMoniker) => {
    setClusterState(next);
    localStorage.setItem(STORAGE_KEY, next);
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
