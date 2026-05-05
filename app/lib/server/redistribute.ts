/**
 * Pure-JS mirror of the on-chain `redistribute` helper in
 * `anchor/programs/spotr_markets/src/lib.rs`. Takes pari-mutuel payouts
 * for the winning side (already sorted by deposit_index ascending) and
 * rewrites each entry to its post-redistribution `final_payout`.
 *
 * No-op when N < 3.
 *
 * BigInt throughout to mirror the Rust u64 / u128 math without rounding
 * surprises. Caller passes BigInt PM_i values; receives BigInt finals.
 */

const TOP_BPS = 6_000n;
const MID_BPS = 4_000n;
const DECAY_CUT_BPS = 2_000n;
const TOP_BOUNDARY_BPS = 2_000n;
const DECAY_TIER_BPS = 4_000n;
const BPS_SCALE = 10_000n;

export function redistributeFinalPayouts(payouts: bigint[]): bigint[] {
  const n = BigInt(payouts.length);
  if (n < 3n) {
    return [...payouts];
  }

  const topEnd = (() => {
    const raw = (n * TOP_BOUNDARY_BPS) / BPS_SCALE;
    return raw < 1n ? 1n : raw;
  })();
  const decayCount = (n * DECAY_TIER_BPS) / BPS_SCALE;
  let decayStart = n - decayCount;
  if (decayStart < topEnd) decayStart = topEnd;

  const topEndIdx = Number(topEnd);
  const decayStartIdx = Number(decayStart);

  let r = 0n;
  for (let i = decayStartIdx; i < payouts.length; i++) {
    r += (payouts[i] * DECAY_CUT_BPS) / BPS_SCALE;
  }

  const topCount = topEnd;
  const midCount = decayStart - topEnd;
  const topBonus = (r * TOP_BPS) / BPS_SCALE / topCount;
  const midBonus =
    midCount > 0n ? (r * MID_BPS) / BPS_SCALE / midCount : 0n;

  return payouts.map((pm, i) => {
    if (i < topEndIdx) {
      return pm + topBonus;
    }
    if (i < decayStartIdx) {
      return pm + midBonus;
    }
    return (pm * (BPS_SCALE - DECAY_CUT_BPS)) / BPS_SCALE;
  });
}
