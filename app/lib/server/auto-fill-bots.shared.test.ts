import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  readAutoFillBotsConfig,
  shouldScheduleAutoFill,
} from "./auto-fill-bots.shared";

test("auto-fill bot config defaults to disabled with expected timings", () => {
  const config = readAutoFillBotsConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.initialDelayMs, 3000);
  assert.equal(config.trickleDelayMs, 1200);
  assert.equal(config.depositLamports, 1_000_000n);
  assert.deepEqual(config.botWallets, []);
});

test("auto-fill bot config reads env overrides", () => {
  const config = readAutoFillBotsConfig({
    SPOTR_AUTO_FILL_BOTS_ENABLED: "true",
    SPOTR_AUTO_FILL_BOTS_INITIAL_DELAY_MS: "5000",
    SPOTR_AUTO_FILL_BOTS_TRICKLE_DELAY_MS: "2000",
    SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS: "2000000",
    SPOTR_AUTO_FILL_BOT_WALLETS:
      "11111111111111111111111111111112,11111111111111111111111111111113",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.initialDelayMs, 5000);
  assert.equal(config.trickleDelayMs, 2000);
  assert.equal(config.depositLamports, 2_000_000n);
  assert.deepEqual(config.botWallets, [
    "11111111111111111111111111111112",
    "11111111111111111111111111111113",
  ]);
});

test("enabled bots require a fixed wallet list", () => {
  assert.throws(
    () =>
      readAutoFillBotsConfig({
        SPOTR_AUTO_FILL_BOTS_ENABLED: "true",
      }),
    /SPOTR_AUTO_FILL_BOT_WALLETS must contain at least one wallet/,
  );
});

test("should schedule auto-fill only after first real deposit into upcoming round", () => {
  assert.equal(
    shouldScheduleAutoFill({
      enabled: true,
      cluster: "localnet",
      actor: "player",
      previousStatus: "UPCOMING",
      previousDepositsCount: 0,
      newDepositsCount: 1,
      fillThreshold: 7,
    }),
    true,
  );
  assert.equal(
    shouldScheduleAutoFill({
      enabled: true,
      cluster: "devnet",
      actor: "player",
      previousStatus: "UPCOMING",
      previousDepositsCount: 1,
      newDepositsCount: 2,
      fillThreshold: 7,
    }),
    false,
  );
  assert.equal(
    shouldScheduleAutoFill({
      enabled: true,
      cluster: "devnet",
      actor: "bot",
      previousStatus: "UPCOMING",
      previousDepositsCount: 0,
      newDepositsCount: 1,
      fillThreshold: 7,
    }),
    false,
  );
  assert.equal(
    shouldScheduleAutoFill({
      enabled: true,
      cluster: "mainnet",
      actor: "player",
      previousStatus: "UPCOMING",
      previousDepositsCount: 0,
      newDepositsCount: 1,
      fillThreshold: 7,
    }),
    false,
  );
});
