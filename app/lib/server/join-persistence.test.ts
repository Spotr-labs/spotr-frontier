import { strict as assert } from "node:assert";
import { test } from "node:test";

import { getJoinChainPersistence } from "./join-persistence";

test("getJoinChainPersistence keeps real signature and player session address", () => {
  const result = getJoinChainPersistence({
    chainTxSignature: "4J6m2F8xV4wK3U6x7m4y9VvT8m2A4n6P2h5L7k9Q1r3s",
    playerSessionAddress: "8Gp6U8w3v17XKj4mY1Fh1rM2t3Qe9ZpN5y6Aa7Bb8Cc",
  });

  assert.deepEqual(result, {
    chainJoinTxSignature: "4J6m2F8xV4wK3U6x7m4y9VvT8m2A4n6P2h5L7k9Q1r3s",
    chainPlayerSessionAddress: "8Gp6U8w3v17XKj4mY1Fh1rM2t3Qe9ZpN5y6Aa7Bb8Cc",
  });
});

test("getJoinChainPersistence drops already-joined sentinel signature", () => {
  const result = getJoinChainPersistence({
    chainTxSignature: "already-joined",
    playerSessionAddress: "8Gp6U8w3v17XKj4mY1Fh1rM2t3Qe9ZpN5y6Aa7Bb8Cc",
  });

  assert.deepEqual(result, {
    chainJoinTxSignature: null,
    chainPlayerSessionAddress: "8Gp6U8w3v17XKj4mY1Fh1rM2t3Qe9ZpN5y6Aa7Bb8Cc",
  });
});
