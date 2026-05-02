import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const projectDir = __dirname;
loadEnvConfig(projectDir);

function requirePublicEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Define it in spotr/.env or override it in spotr/.env.local. See spotr/.env.example for the expected shape.`
    );
  }
  return value;
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SPOTR_APP_NAME: requirePublicEnv("NEXT_PUBLIC_SPOTR_APP_NAME"),
    NEXT_PUBLIC_SPOTR_SEASON_LABEL: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_SEASON_LABEL"
    ),
    NEXT_PUBLIC_SPOTR_CLUSTER: requirePublicEnv("NEXT_PUBLIC_SPOTR_CLUSTER"),
    NEXT_PUBLIC_SPOTR_LAUNCH_ISO: requirePublicEnv("NEXT_PUBLIC_SPOTR_LAUNCH_ISO"),
    NEXT_PUBLIC_SPOTR_SESSION_MIN_WALLETS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_SESSION_MIN_WALLETS"
    ),
    NEXT_PUBLIC_SPOTR_SESSION_MIN_TOTAL_LAMPORTS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_SESSION_MIN_TOTAL_LAMPORTS"
    ),
    NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS"
    ),
    NEXT_PUBLIC_SPOTR_ROUND_COUNT: requirePublicEnv("NEXT_PUBLIC_SPOTR_ROUND_COUNT"),
    NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS"
    ),
    NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS"
    ),
    NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS"
    ),
    NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_START_HOUR_UTC: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_START_HOUR_UTC"
    ),
    NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC"
    ),
    NEXT_PUBLIC_SPOTR_LOW_PAIR_ALERT_THRESHOLD: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_LOW_PAIR_ALERT_THRESHOLD"
    ),
    NEXT_PUBLIC_SPOTR_PAYOUT_CADENCE_DAYS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_PAYOUT_CADENCE_DAYS"
    ),
    NEXT_PUBLIC_SPOTR_MIN_PAID_SESSIONS_FOR_REFERRAL: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_MIN_PAID_SESSIONS_FOR_REFERRAL"
    ),
    NEXT_PUBLIC_SPOTR_CONVICTION_HOLD_MS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_CONVICTION_HOLD_MS"
    ),
    NEXT_PUBLIC_SPOTR_CARD_REWARD_SLOTS: requirePublicEnv(
      "NEXT_PUBLIC_SPOTR_CARD_REWARD_SLOTS"
    ),
  },
  serverExternalPackages: ["ws"],
  // Stub Node.js-only modules that pino/walletconnect drag into the browser bundle.
  turbopack: {
    resolveAlias: {
      // fs is only needed on the server; stub it for browser bundles only
      fs: { browser: "./empty-module.js" },
      // pino transport and thread-stream are Node-only; WalletConnect uses
      // them for logging but they must not reach the browser or SSR bundle.
      "thread-stream": "./empty-module.js",
      "pino/lib/transport": "./empty-module.js",
      "why-is-node-running": "./empty-module.js",
      "pino-elasticsearch": "./empty-module.js",
      "pino-pretty": "./empty-module.js",
      tap: "./empty-module.js",
      tape: "./empty-module.js",
      desm: "./empty-module.js",
      fastbench: "./empty-module.js",
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        worker_threads: false,
      };
      const emptyModule = require.resolve("./empty-module.js");
      // Stub Node.js-only packages dragged in by pino/walletconnect
      const nodeOnlyModules = [
        "thread-stream",
        "pino/lib/transport",
        "why-is-node-running",
        "pino-elasticsearch",
        "pino-pretty",
        "tap",
        "tape",
        "desm",
        "fastbench",
      ];
      nodeOnlyModules.forEach((mod) => {
        config.resolve.alias[mod] = emptyModule;
      });
    }
    return config;
  },
};

export default nextConfig;
