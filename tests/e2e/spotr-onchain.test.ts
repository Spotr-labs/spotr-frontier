/**
 * End-to-end test for the SPOTR Markets on-chain program against a real SVM.
 *
 * Verifies the PRD §3.6 lazy per-deposit split, denominated in micro-USDC:
 *
 *   3 players on side A, 1 USDC each, 0% fee, 3 min wallets, 20-second round.
 *
 * Expected vault deltas (vs. pre-join vault balance):
 *   player1 = +0.5 USDC, player2 = -0.5 USDC, player3 = -1.0 USDC.
 * Orphan swept to protocol_treasury_tokens = 1 USDC.
 *
 * Also verifies the user-vault rail end-to-end:
 *   - init_user_vault, deposit_to_vault before joining.
 *   - withdraw_from_vault is rejected with VaultLocked while a session is live.
 *   - claim_session_balance releases the vault lock; subsequent withdraw succeeds.
 *
 * Requires surfpool with the SPOTR program deployed and the mock USDC mint
 * already created (run-e2e.sh handles both, then sets SPOTR_E2E_USDC_MINT and
 * SPOTR_E2E_USDC_AUTHORITY_KEYPAIR).
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  type Address,
  type TransactionSigner,
  address,
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  generateKeyPairSigner,
  createSolanaRpc,
  lamports,
} from "@solana/kit";
import { createKeyPairSignerFromBytes } from "@solana/signers";
import { createClient } from "@solana/kit-client-rpc";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
} from "@solana-program/token";
import {
  getClaimRoundInstructionAsync,
  getClaimSessionBalanceInstructionAsync,
  getCloseRoundInstruction,
  getCreateRoundInstruction,
  getCreateSessionInstructionAsync,
  getDepositToVaultInstructionAsync,
  getEnterPositionInstructionAsync,
  getInitUserVaultInstructionAsync,
  getInitializeConfigInstructionAsync,
  getJoinSessionInstructionAsync,
  getSweepOrphansInstructionAsync,
  getWithdrawFromVaultInstructionAsync,
} from "../../app/generated/spotr/instructions/index";
import {
  findProtocolTreasuryPda,
  findProtocolTreasuryTokensPda,
} from "../../app/generated/spotr/pdas/index";
import { findVaultTokensPda } from "../../app/generated/spotr/pdas/vaultTokens";
import { SPOTR_MARKETS_PROGRAM_ADDRESS } from "../../app/generated/spotr/programs/index";
import { SideSelection } from "../../app/generated/spotr/types/index";
import { findSpotrSessionPda } from "../../app/lib/chain/session-pda";

const RPC_URL = process.env.SPOTR_E2E_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS = process.env.SPOTR_E2E_RPC_WS ?? "ws://127.0.0.1:8900";
const USDC_MINT_STR = process.env.SPOTR_E2E_USDC_MINT;
const USDC_AUTH_KP_PATH = process.env.SPOTR_E2E_USDC_AUTHORITY_KEYPAIR;
if (!USDC_MINT_STR || !USDC_AUTH_KP_PATH) {
  throw new Error(
    "SPOTR_E2E_USDC_MINT and SPOTR_E2E_USDC_AUTHORITY_KEYPAIR must be set (run-e2e.sh provides both)."
  );
}
const USDC_MINT: Address = address(USDC_MINT_STR);

const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
const MICRO_USDC_PER_USDC = BigInt(1_000_000);
const SESSION_NUMBER = BigInt(1);
const BUY_IN_USDC_UNITS = MICRO_USDC_PER_USDC; // 1 USDC
const ROUND_STAKE_USDC_UNITS = MICRO_USDC_PER_USDC; // 1 USDC
const ROUND_DURATION_SECONDS = BigInt(20);
const TOLERANCE_USDC_UNITS = BigInt(1_000); // 0.001 USDC

const rpc = createSolanaRpc(RPC_URL);

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function airdropSol(target: Address, solAmount: number) {
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

async function getTokenAmount(account: Address): Promise<bigint> {
  try {
    const result = await rpc.getTokenAccountBalance(account).send();
    return BigInt(result.value.amount);
  } catch {
    return 0n;
  }
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

async function deriveAta(owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata;
}

async function deriveVaultTokens(owner: Address): Promise<Address> {
  const [pda] = await findVaultTokensPda({ player: owner });
  return pda;
}

function loadKeypairBytes(path: string): Uint8Array {
  const raw = readFileSync(path, "utf8");
  const arr = JSON.parse(raw) as number[];
  return Uint8Array.from(arr);
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

async function expectError<T>(
  action: () => Promise<T>,
  matcher: RegExp,
  description: string
) {
  try {
    await action();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (matcher.test(text)) return;
    throw new Error(
      `${description}: caught error did not match ${matcher}: ${text}`
    );
  }
  throw new Error(`${description}: expected throw, got success`);
}

async function main() {
  console.log(`[e2e] rpc: ${RPC_URL}`);
  console.log(`[e2e] program: ${SPOTR_MARKETS_PROGRAM_ADDRESS}`);
  console.log(`[e2e] usdc mint: ${USDC_MINT}`);

  // ── 0. wallets + funding ───────────────────────────────────────────────
  const admin = await generateKeyPairSigner();
  const player1 = await generateKeyPairSigner();
  const player2 = await generateKeyPairSigner();
  const player3 = await generateKeyPairSigner();
  const players = [player1, player2, player3];
  console.log(`[e2e] admin: ${admin.address}`);
  console.log(
    `[e2e] players: ${player1.address} / ${player2.address} / ${player3.address}`
  );
  await Promise.all([
    airdropSol(admin.address, 10),
    airdropSol(player1.address, 5),
    airdropSol(player2.address, 5),
    airdropSol(player3.address, 5),
  ]);

  // ── 1. fund every player's USDC ATA from the mint authority ─────────────
  const usdcAuthority = await createKeyPairSignerFromBytes(
    loadKeypairBytes(USDC_AUTH_KP_PATH!)
  );
  await airdropSol(usdcAuthority.address, 5);
  const FUND_PER_PLAYER = BUY_IN_USDC_UNITS + ROUND_STAKE_USDC_UNITS; // 2 USDC each — covers buy-in + one round
  for (const player of players) {
    const ata = await deriveAta(player.address);
    const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync(
      {
        payer: usdcAuthority,
        owner: player.address,
        mint: USDC_MINT,
      }
    );
    const mintIx = getMintToInstruction({
      mint: USDC_MINT,
      token: ata,
      mintAuthority: usdcAuthority,
      amount: FUND_PER_PLAYER,
    });
    const sig = await sendIxs(usdcAuthority, [createAtaIx, mintIx]);
    console.log(`[e2e] funded ${player.address} (${FUND_PER_PLAYER} μUSDC) → ${sig}`);
  }

  // ── 2. admin: initialize_config + create_session ───────────────────────
  const [sessionPda] = await findSpotrSessionPda(SESSION_NUMBER);
  const initIx = await getInitializeConfigInstructionAsync({
    authority: admin,
    usdcMint: USDC_MINT,
    input: {
      protocolFeeBps: 0,
      referralCutBps: 0,
      roundCount: 1,
      roundDurationSeconds: ROUND_DURATION_SECONDS,
      buyInUsdcUnits: BUY_IN_USDC_UNITS,
    },
  });
  const createIx = await getCreateSessionInstructionAsync({
    authority: admin,
    session: sessionPda,
    usdcMint: USDC_MINT,
    sessionNumber: SESSION_NUMBER,
    roundCount: 1,
    roundDurationSeconds: ROUND_DURATION_SECONDS,
    buyInUsdcUnits: BigInt(0), // free join — wager paid per-round at enter_position
    protocolFeeBps: 0,
    referralCutBps: 0,
    minWallets: 3,
    minTotalUsdcUnits: BigInt(0),
    startTs: BigInt(0),
    endTs: BigInt(2_000_000_000),
  });
  const bootSig = await sendIxs(admin, [initIx, createIx]);
  console.log(`[e2e] config + session created: ${bootSig}`);

  // ── 3. each player: init_user_vault + deposit_to_vault ─────────────────
  for (const player of players) {
    const ata = await deriveAta(player.address);
    const initVaultIx = await getInitUserVaultInstructionAsync({
      owner: player,
      usdcMint: USDC_MINT,
    });
    const depositIx = await getDepositToVaultInstructionAsync({
      owner: player,
      ownerTokenAccount: ata,
      amount: FUND_PER_PLAYER,
    });
    const sig = await sendIxs(player, [initVaultIx, depositIx]);
    console.log(
      `[e2e] init+deposit ${player.address} (${FUND_PER_PLAYER} μUSDC) → ${sig}`
    );
  }

  // Snapshot vault balances post-deposit, pre-join.
  const vaultPdas = await Promise.all(
    players.map((p) => deriveVaultTokens(p.address))
  );
  const vaultPreJoin = await Promise.all(
    vaultPdas.map((pda) => getTokenAmount(pda))
  );

  // ── 4. players: join_session ───────────────────────────────────────────
  for (const player of players) {
    const ix = await getJoinSessionInstructionAsync({
      player,
      session: sessionPda,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] join ${player.address} → ${sig}`);
  }

  // ── 5. while active, withdraw_from_vault must fail with VaultLocked ────
  const player1Ata = await deriveAta(player1.address);
  await expectError(
    async () => {
      const lockedIx = await getWithdrawFromVaultInstructionAsync({
        owner: player1,
        ownerTokenAccount: player1Ata,
        amount: BigInt(1),
      });
      await sendIxs(player1, [lockedIx]);
    },
    /VaultLocked|0x1810|6160/i,
    "withdraw_from_vault while session active should be rejected"
  );
  console.log("[e2e] ✓  withdraw_from_vault correctly rejected mid-session");

  // ── 6. admin: create_round (index 0) ───────────────────────────────────
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

  // ── 7. players: enter_position (all on side A, 1 USDC wager each) ────────
  for (const player of players) {
    const ix = await getEnterPositionInstructionAsync({
      player,
      session: sessionPda,
      round: roundPda,
      side: SideSelection.A,
      wagerUsdcUnits: ROUND_STAKE_USDC_UNITS,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] enter ${player.address} → ${sig}`);
  }

  // ── 8. wait for round to close ─────────────────────────────────────────
  await sleep(Number(ROUND_DURATION_SECONDS) * 1000 + 1500);
  const closeIx = getCloseRoundInstruction({
    session: sessionPda,
    round: roundPda,
  });
  const closeSig = await sendIxs(admin, [closeIx]);
  console.log(`[e2e] round closed: ${closeSig}`);

  // ── 9. players claim round winnings (deposited to their vaults) ────────
  for (const player of players) {
    const ix = await getClaimRoundInstructionAsync({
      player,
      session: sessionPda,
      round: roundPda,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] claim_round ${player.address} → ${sig}`);
  }

  // ── 10. each player: claim_session_balance (releases lock) ─────────────
  for (const player of players) {
    const ix = await getClaimSessionBalanceInstructionAsync({
      player,
      session: sessionPda,
    });
    const sig = await sendIxs(player, [ix]);
    console.log(`[e2e] claim_session ${player.address} → ${sig}`);
  }

  // ── 11. assert vault deltas match the 1.5 / 0.5 / 0 USDC payout split ──
  // Per-player flow: vault pre-join = FUND_PER_PLAYER (2 USDC). join_session
  // is free (buy_in = 0). enter_position debits 1 USDC wager from vault into
  // session_treasury_tokens. claim_round credits winnings (1.5 / 0.5 / 0)
  // back to the vault. claim_session_balance releases the vault lock (no
  // refund since remaining_escrow = 0). Net delta vs pre-join =
  // winnings − wager = +0.5 / -0.5 / -1 USDC.
  const vaultAfter = await Promise.all(
    vaultPdas.map((pda) => getTokenAmount(pda))
  );
  const deltas = vaultAfter.map((after, i) => after - vaultPreJoin[i]);
  console.log(
    `[e2e] vault deltas vs pre-join: p1=${deltas[0]} p2=${deltas[1]} p3=${deltas[2]}`
  );
  assertNearEqual(
    deltas[0],
    MICRO_USDC_PER_USDC / 2n,
    TOLERANCE_USDC_UNITS,
    "player1 vault delta ≈ +0.5 USDC (1.5 claim − 1 wager)"
  );
  assertNearEqual(
    deltas[1],
    -(MICRO_USDC_PER_USDC / 2n),
    TOLERANCE_USDC_UNITS,
    "player2 vault delta ≈ -0.5 USDC (0.5 claim − 1 wager)"
  );
  assertNearEqual(
    deltas[2],
    -MICRO_USDC_PER_USDC,
    TOLERANCE_USDC_UNITS,
    "player3 vault delta ≈ -1 USDC (0 claim − 1 wager)"
  );

  // ── 12. sweep_orphans → protocol_treasury_tokens receives 1 USDC ───────
  const [protocolTreasuryPda] = await findProtocolTreasuryPda();
  const [protocolTreasuryTokensPda] = await findProtocolTreasuryTokensPda();
  const protocolBefore = await getTokenAmount(protocolTreasuryTokensPda);
  const sweepIx = await getSweepOrphansInstructionAsync({
    session: sessionPda,
    round: roundPda,
    protocolTreasury: protocolTreasuryPda,
  });
  const sweepSig = await sendIxs(admin, [sweepIx]);
  console.log(`[e2e] sweep_orphans: ${sweepSig}`);
  const protocolAfter = await getTokenAmount(protocolTreasuryTokensPda);
  const sweptUnits = protocolAfter - protocolBefore;
  console.log(`[e2e] orphan swept: ${sweptUnits} μUSDC`);
  assertNearEqual(
    sweptUnits,
    MICRO_USDC_PER_USDC,
    TOLERANCE_USDC_UNITS,
    "sweep_orphans moved first-depositor stake (1 USDC) to protocol treasury"
  );

  // ── 13. now that session ended, withdraw_from_vault should succeed ─────
  const player1VaultBefore = await getTokenAmount(vaultPdas[0]);
  const player1AtaBefore = await getTokenAmount(player1Ata);
  const withdrawAmount = player1VaultBefore;
  if (withdrawAmount > 0n) {
    const wIx = await getWithdrawFromVaultInstructionAsync({
      owner: player1,
      ownerTokenAccount: player1Ata,
      amount: withdrawAmount,
    });
    const wSig = await sendIxs(player1, [wIx]);
    console.log(`[e2e] withdraw_from_vault player1 (${withdrawAmount}) → ${wSig}`);
    const player1VaultAfter = await getTokenAmount(vaultPdas[0]);
    const player1AtaAfter = await getTokenAmount(player1Ata);
    assert.equal(player1VaultAfter, 0n, "vault drained to zero after withdraw");
    assert.equal(
      player1AtaAfter - player1AtaBefore,
      withdrawAmount,
      "wallet ATA increased by withdrawn amount"
    );
  } else {
    console.log("[e2e] player1 vault was empty after settlement — skipping withdraw");
  }

  console.log("[e2e] all assertions passed ✓");
}

main().catch((error) => {
  console.error("[e2e] failed:", error);
  process.exit(1);
});
