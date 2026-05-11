import { strict as assert } from "node:assert";
import { test } from "node:test";

import { preserveUpcomingRoundStatus } from "./round-status.shared";

test("live sessions preserve upcoming rounds even if wall clock derived them closed", () => {
  assert.equal(
    preserveUpcomingRoundStatus("UPCOMING", "CLOSED", "LIVE"),
    "UPCOMING"
  );
});

test("live sessions preserve upcoming rounds even if wall clock derived them open", () => {
  assert.equal(
    preserveUpcomingRoundStatus("UPCOMING", "OPEN", "LIVE"),
    "UPCOMING"
  );
});

test("completed sessions allow upcoming rounds to settle closed", () => {
  assert.equal(
    preserveUpcomingRoundStatus("UPCOMING", "CLOSED", "COMPLETED"),
    "CLOSED"
  );
});

test("non-upcoming stored rounds use the derived status", () => {
  assert.equal(
    preserveUpcomingRoundStatus("OPEN", "CLOSED", "LIVE"),
    "CLOSED"
  );
});
