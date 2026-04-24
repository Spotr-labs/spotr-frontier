/**
 * End-to-end test for the SPOTR Markets on-chain program, verifying the
 * PRD §3.6 lazy per-deposit split:
 *
 *   3 players on side A, 1 SOL each, 0% fee, 3 min wallets, 1-second round.
 *
 * Expected claim deltas: player1 = +1.5 SOL, player2 = +0.5 SOL, player3 = 0.
 * Orphan swept to protocol treasury = 1 SOL.
 *
 * Requires surfpool running at SPOTR_E2E_RPC_URL with the program deployed.
 */
import { strict as assert } from "node:assert";
import {
  type Address,
  type TransactionSigner,
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  generateKeyPairSigner,
  createSolanaRpc,
  lamports,
} from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import {
  getClaimRoundInstructionAsync,
  getCloseRoundInstruction,
  getCreateRoundInstruction,
  getCreateSessionInstructionAsync,
  getEnterPositionInstructionAsync,
  getInitializeConfigInstructionAsync,
  getJoinSessionInstructionAsync,
  getSweepOrphansInstructionAsync,
} from "../../app/generated/spotr/instructions/index";
import { findProtocolTreasuryPda } from "../../app/generated/spotr/pdas/index";
import { SPOTR_MARKETS_PROGRAM_ADDRESS } from "../../app/generated/spotr/programs/index";
import { SideSelection } from "../../app/generated/spotr/types/index";
import { findSpotrSessionPda } from "../../app/lib/chain/session-pda";

const RPC_URL = process.env.SPOTR_E2E_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS = process.env.SPOTR_E2E_RPC_WS ?? "ws://127.0.0.1:8900";
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
const SESSION_NUMBER = BigInt(1);
const BUY_IN_LAMPORTS = LAMPORTS_PER_SOL;
const ROUND_STAKE_LAMPORTS = LAMPORTS_PER_SOL;
const ROUND_DURATION_SECONDS = BigInt(20);
const FEE_TOLERANCE_LAMPORTS = BigInt(50_000_000);

const rpc = createSolanaRpc(RPC_URL);

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function airdrop(target: Address, solAmount: number) {
  const requested = BigInt(solAmount) * LAMPORTS_PER_SOL;
  const sig = await rpc.requestAirdrop(target, lamports(requested)).send();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = (await rpc.getSignatureStatuses([sig]).send()).value[0];
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`airdrop to ${target} did not confirm`);
}

async function getLamportsBalance(addr: Address): Promise<bigint> {
  const { value } = await rpc.getBalance(addr).send();
  return BigInt(value);
}

function bootTxClient(payer: TransactionSigner) {
  return createClient({
    url: RPC_URL,
    rpcSubscriptionsConfig: { url: RPC_WS },
    payer,
  });
}

async function sendIxs(
  payer: TransactionSigner,
  instructions: Parameters<
    ReturnType<typeof bootTxClient>["sendTransaction"]
  >[0]
) {
  const client = bootTxClient(payer);
  const result = await client.sendTransaction(instructions);
  return String(result.context.signature);
}

async function deriveRoundPda(
  session: Address,
  index: number
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SPOTR_MARKETS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(new Uint8Array([114, 111, 117, 110, 100])),
      getAddressEncoder().encode(session),
      new Uint8Array([index]),
    ],
  });
  return pda as Address;
}

function assertNearEqual(
  actual: bigint,
  expected: bigint,
  tolerance: bigint,
  message: string
) {
  const diff = actual > expected ? actual - expected : expected - actual;
  assert.ok(
    diff <= tolerance,
    `${message}: actual=${actual} expected≈${expected} diff=${diff} > tol=${tolerance}`
  );
}

async function main() {
  console.log(`[e2e] rpc: ${RPC_URL}`);
  console.log(`[e2e] program: ${SPOTR_MARKETS_PROGRAM_ADDRESS}`);

  // ── 0. wallets + funding ───────────────────────────────────────────────
  const admin = await generateKeyPairSigner();
  const player1 = await generateKeyPairSigner();
  const player2 = await generateKeyPairSigner();
  const player3 = await generateKeyPairSigner();
  console.log(`[e2e] admin: ${admin.address}`);
  console.log(
    `[e2e] players: ${player1.address} / ${player2.address} / ${player3.address}`
  );
  await Promise.all([
    airdrop(admin.address, 10),
    airdrop(player1.address, 5),
    airdrop(player2.address, 5),
    airdrop(player3.address, 5),
  ]);
  const balancesPreJoin = await Promise.all(
    [player1, player2, player3].map((p) => getLamportsBalance(p.address))
  );

  // ── 1. admin: initialize_config + create_session ───────────────────────
  const [sessionPda] = await findSpotrSessionPda(SESSION_NUMBER);
  const initIx = await getInitializeConfigInstructionAsync({
    authority: admin,
    input: {
      protocolFeeBps: 0,
      referralCutBps: 0,
      roundCount: 1,
      roundDurationSeconds: ROUND_DURATION_SECONDS,
      buyInLamports: BUY_IN_LAMPORTS,
      roundStakeLamports: ROUND_STAKE_LAMPORTS,
    },
  });
  const createIx = await getCreateSessionInstructionAsync({
    authority: admin,
    session: sessionPda,
    sessionNumber: SESSION_NUMBER,
    roundCount: 1,
    roundDurationSeconds: ROUND_DURATION_SECONDS,
    buyInLamports: BUY_IN_LAMPORTS,
    roundStakeLamports: ROUND_STAKE_LAMPORTS,
    protocolFeeBps: 0,
    referralCutBps: 0,
    minWallets: 3,
    minTotalLamports: BigInt(0),
    startTs: BigInt(0),
    endTs: BigInt(2_000_000_000),
  });
  const bootSig = await sendIxs(admin, [initIx, createIx]);
  console.log(`[e2e] config + session created: ${bootSig}`);

  // ── 2. players: join_session ───────────────────────────────────────────
  for (const player of [player1, player2, player3]) {
    const ix = await getJoinSessionInstructionAsync({
      player,
      session: sessionPda,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] join ${player.address} → ${sig}`);
  }

  // ── 3. admin: create_round (index 0) ───────────────────────────────────
  const pairId = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) pairId[i] = i + 1;
  const roundPda = await deriveRoundPda(sessionPda, 0);
  const createRoundIx = getCreateRoundInstruction({
    authority: admin,
    session: sessionPda,
    round: roundPda,
    index: 0,
    pairId,
  });
  const createRoundSig = await sendIxs(admin, [createRoundIx]);
  console.log(`[e2e] round created: ${createRoundSig}`);

  // ── 4. players: enter_position (all on side A) ─────────────────────────
  for (const player of [player1, player2, player3]) {
    const ix = await getEnterPositionInstructionAsync({
      player,
      session: sessionPda,
      round: roundPda,
      side: SideSelection.A,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] enter ${player.address} → ${sig}`);
  }

  // ── 5. wait for round to close ─────────────────────────────────────────
  await sleep(Number(ROUND_DURATION_SECONDS) * 1000 + 1500);
  const closeIx = getCloseRoundInstruction({
    session: sessionPda,
    round: roundPda,
  });
  const closeSig = await sendIxs(admin, [closeIx]);
  console.log(`[e2e] round closed: ${closeSig}`);

  // ── 6. players claim ──────────────────────────────────────────────────
  const balancesBeforeClaim: Record<string, bigint> = {};
  for (const player of [player1, player2, player3]) {
    balancesBeforeClaim[player.address] = await getLamportsBalance(
      player.address
    );
    const ix = await getClaimRoundInstructionAsync({
      player,
      session: sessionPda,
      round: roundPda,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] claim ${player.address} → ${sig}`);
  }

  // ── 7. assert 1.5 / 0.5 / 0 SOL split ─────────────────────────────────
  const p1Net =
    (await getLamportsBalance(player1.address)) -
    balancesBeforeClaim[player1.address];
  const p2Net =
    (await getLamportsBalance(player2.address)) -
    balancesBeforeClaim[player2.address];
  const p3Net =
    (await getLamportsBalance(player3.address)) -
    balancesBeforeClaim[player3.address];
  console.log(`[e2e] claim deltas: p1=${p1Net} p2=${p2Net} p3=${p3Net}`);
  assertNearEqual(
    p1Net,
    (LAMPORTS_PER_SOL * BigInt(3)) / BigInt(2),
    FEE_TOLERANCE_LAMPORTS,
    "player1 claim delta ≈ +1.5 SOL"
  );
  assertNearEqual(
    p2Net,
    LAMPORTS_PER_SOL / BigInt(2),
    FEE_TOLERANCE_LAMPORTS,
    "player2 claim delta ≈ +0.5 SOL"
  );
  assertNearEqual(
    p3Net,
    BigInt(0),
    FEE_TOLERANCE_LAMPORTS,
    "player3 claim delta ≈ 0"
  );

  const p1End =
    (await getLamportsBalance(player1.address)) - balancesPreJoin[0];
  const p2End =
    (await getLamportsBalance(player2.address)) - balancesPreJoin[1];
  const p3End =
    (await getLamportsBalance(player3.address)) - balancesPreJoin[2];
  console.log(`[e2e] net vs pre-join: p1=${p1End} p2=${p2End} p3=${p3End}`);
  // Each player paid BUY_IN_LAMPORTS at join; claim gave them back their
  // share of the pool; net vs pre-join = claim − buy_in (ignoring tx fees).
  assertNearEqual(
    p1End,
    LAMPORTS_PER_SOL / BigInt(2),
    FEE_TOLERANCE_LAMPORTS,
    "player1 net vs pre-join ≈ +0.5 SOL (1.5 claim − 1 buy-in)"
  );
  assertNearEqual(
    p2End,
    -(LAMPORTS_PER_SOL / BigInt(2)),
    FEE_TOLERANCE_LAMPORTS,
    "player2 net vs pre-join ≈ -0.5 SOL (0.5 claim − 1 buy-in)"
  );
  assertNearEqual(
    p3End,
    -LAMPORTS_PER_SOL,
    FEE_TOLERANCE_LAMPORTS,
    "player3 net vs pre-join ≈ -1 SOL (0 claim − 1 buy-in)"
  );

  // ── 8. sweep_orphans → protocol_treasury receives 1 SOL ───────────────
  const [protocolTreasuryPda] = await findProtocolTreasuryPda();
  const protocolBefore = await getLamportsBalance(protocolTreasuryPda);
  const sweepIx = await getSweepOrphansInstructionAsync({
    session: sessionPda,
    round: roundPda,
    protocolTreasury: protocolTreasuryPda,
  });
  const sweepSig = await sendIxs(admin, [sweepIx]);
  console.log(`[e2e] sweep_orphans: ${sweepSig}`);
  const protocolAfter = await getLamportsBalance(protocolTreasuryPda);
  const sweptLamports = protocolAfter - protocolBefore;
  console.log(`[e2e] orphan swept: ${sweptLamports} lamports`);
  assertNearEqual(
    sweptLamports,
    LAMPORTS_PER_SOL,
    FEE_TOLERANCE_LAMPORTS,
    "sweep_orphans moved first-depositor stake (1 SOL) to protocol treasury"
  );

  console.log("[e2e] all assertions passed ✓");
}

main().catch((error) => {
  console.error("[e2e] failed:", error);
  process.exit(1);
});
