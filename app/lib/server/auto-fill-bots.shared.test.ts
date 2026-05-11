import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  readAutoFillBotsConfig,
  shouldProcessAutoFillFromHeartbeat,
  shouldReturnMutationPayload,
  shouldScheduleAutoFill,
} from "./auto-fill-bots.shared";

test("auto-fill bot config defaults to disabled with expected timings", () => {
  const config = readAutoFillBotsConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.initialDelayMs, 1500);
  assert.equal(config.trickleDelayMs, 600);
  assert.equal(config.workerLeaseMs, 120000);
  assert.equal(config.depositLamports, 1_000_000n);
  assert.deepEqual(config.botWallets, []);
});

test("auto-fill bot config reads env overrides", () => {
  const config = readAutoFillBotsConfig({
    SPOTR_AUTO_FILL_BOTS_ENABLED: "true",
    SPOTR_AUTO_FILL_BOTS_INITIAL_DELAY_MS: "5000",
    SPOTR_AUTO_FILL_BOTS_TRICKLE_DELAY_MS: "2000",
    SPOTR_AUTO_FILL_BOTS_WORKER_LEASE_MS: "90000",
    SPOTR_AUTO_FILL_BOTS_DEPOSIT_LAMPORTS: "2000000",
    SPOTR_AUTO_FILL_BOT_WALLETS:
      "11111111111111111111111111111112,11111111111111111111111111111113",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.initialDelayMs, 5000);
  assert.equal(config.trickleDelayMs, 2000);
  assert.equal(config.workerLeaseMs, 90000);
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
    /SPOTR_AUTO_FILL_BOT_WALLETS must contain at least one wallet/
  );
});

test("should schedule auto-fill after real player deposits into upcoming unfilled round", () => {
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
    true
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
    true
  );
  assert.equal(
    shouldScheduleAutoFill({
      enabled: false,
      cluster: "devnet",
      actor: "player",
      previousStatus: "UPCOMING",
      previousDepositsCount: 1,
      newDepositsCount: 2,
      fillThreshold: 7,
    }),
    false
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
    false
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
    false
  );
});

test("bot mutations skip dashboard payload refresh unless explicitly overridden", () => {
  assert.equal(shouldReturnMutationPayload("player"), true);
  assert.equal(shouldReturnMutationPayload(undefined), true);
  assert.equal(shouldReturnMutationPayload("bot"), false);
  assert.equal(shouldReturnMutationPayload("bot", true), true);
  assert.equal(shouldReturnMutationPayload("player", false), false);
});

test("heartbeat only processes due auto-fill rounds on supported clusters", () => {
  const now = new Date("2026-05-11T12:00:00.000Z");
  const due = new Date("2026-05-11T11:59:55.000Z");
  const future = new Date("2026-05-11T12:00:05.000Z");

  assert.equal(
    shouldProcessAutoFillFromHeartbeat({
      enabled: true,
      cluster: "devnet",
      status: "UPCOMING",
      scheduledAt: due,
      completedAt: null,
      now,
    }),
    true
  );

  assert.equal(
    shouldProcessAutoFillFromHeartbeat({
      enabled: true,
      cluster: "devnet",
      status: "UPCOMING",
      scheduledAt: future,
      completedAt: null,
      now,
    }),
    false
  );

  assert.equal(
    shouldProcessAutoFillFromHeartbeat({
      enabled: true,
      cluster: "devnet",
      status: "OPEN",
      scheduledAt: due,
      completedAt: null,
      now,
    }),
    false
  );

  assert.equal(
    shouldProcessAutoFillFromHeartbeat({
      enabled: true,
      cluster: "mainnet",
      status: "UPCOMING",
      scheduledAt: due,
      completedAt: null,
      now,
    }),
    false
  );

  assert.equal(
    shouldProcessAutoFillFromHeartbeat({
      enabled: true,
      cluster: "devnet",
      status: "UPCOMING",
      scheduledAt: due,
      completedAt: new Date("2026-05-11T12:00:00.000Z"),
      now,
    }),
    false
  );
});
