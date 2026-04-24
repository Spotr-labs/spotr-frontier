"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { ClusterMoniker } from "../lib/solana-client";
import { CLUSTERS, DEFAULT_CLUSTER } from "../lib/solana-client";
import { getExplorerUrl } from "../lib/explorer";

type ClusterContextValue = {
  cluster: ClusterMoniker;
  setCluster: (cluster: ClusterMoniker) => void;
  getExplorerUrl: (path: string) => string;
};

const ClusterContext = createContext<ClusterContextValue | null>(null);

export { CLUSTERS };

export function ClusterProvider({ children }: { children: ReactNode }) {
  const cluster = DEFAULT_CLUSTER;
  const setCluster: ClusterContextValue["setCluster"] = useCallback(() => {
    // SPOTR is deployed against a single cluster chosen at build time.
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
