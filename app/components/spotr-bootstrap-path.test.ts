import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildSpotrBootstrapPath } from "./spotr-bootstrap-path";

test("builds bare bootstrap path with no params", () => {
  assert.equal(buildSpotrBootstrapPath({}), "/api/bootstrap");
});

test("builds wallet-scoped bootstrap path", () => {
  assert.equal(
    buildSpotrBootstrapPath({ walletAddress: "wallet-1" }),
    "/api/bootstrap?wallet=wallet-1"
  );
});

test("builds session-pinned bootstrap path", () => {
  assert.equal(
    buildSpotrBootstrapPath({ walletAddress: "wallet-1", sessionId: "session-7" }),
    "/api/bootstrap?wallet=wallet-1&session=session-7"
  );
});
