"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useMemo, type PropsWithChildren } from "react";
import { PrivyProvider, type WalletListEntry } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { ClusterProvider } from "./cluster-context";
import { WalletProvider } from "../lib/wallet/context";
import { PrivyConnectorBridge } from "../lib/wallet/privy-bridge";
import { SolanaClientProvider } from "../lib/solana-client-context";
import { publicSpotrConfig } from "../lib/spotr-config/public";

const SOLANA_WALLET_LIST: WalletListEntry[] = [
  "phantom",
  "solflare",
  "backpack",
  "detected_solana_wallets",
  "wallet_connect_qr_solana",
];

function ClusterAwarePrivy({ children }: PropsWithChildren) {
  const solanaConnectors = useMemo(
    () => toSolanaWalletConnectors({ shouldAutoConnect: true }),
    []
  );

  return (
    <PrivyProvider
      appId={publicSpotrConfig.privyAppId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#f5c800",
          walletList: SOLANA_WALLET_LIST,
          walletChainType: "solana-only",
          showWalletLoginFirst: false,
          landingHeader: "Sign in to SPOTR",
          loginMessage:
            "Email or social, or bring a Solana wallet. Your SOL stays yours.",
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        loginMethods: ["email", "google", "twitter", "wallet"],
      }}
    >
      <PrivyConnectorBridge>{children}</PrivyConnectorBridge>
    </PrivyProvider>
  );
}

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      forcedTheme="dark"
    >
      <ClusterProvider>
        <SolanaClientProvider>
          {publicSpotrConfig.privyAppId ? (
            <ClusterAwarePrivy>{children}</ClusterAwarePrivy>
          ) : (
            <WalletProvider>{children}</WalletProvider>
          )}
        </SolanaClientProvider>
        <Toaster position="bottom-right" richColors />
      </ClusterProvider>
    </ThemeProvider>
  );
}
