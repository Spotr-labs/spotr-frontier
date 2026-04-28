const MICRO_USDC = 1_000_000n;

export function microUsdcToString(amount: bigint | number, maxDecimals = 2): string {
  const big = typeof amount === "bigint" ? amount : BigInt(Math.round(amount));
  const whole = big / MICRO_USDC;
  const fractional = big % MICRO_USDC;

  if (fractional === 0n) return whole.toString();

  const decimals = fractional
    .toString()
    .padStart(6, "0")
    .slice(0, maxDecimals);

  const trimmed = decimals.replace(/0+$/, "");
  if (trimmed === "") return whole.toString();

  return `${whole}.${trimmed}`;
}

export function microUsdcToDisplay(micro: number, decimals = 2): string {
  return (micro / 1_000_000).toLocaleString("en-US", {
    maximumFractionDigits: decimals,
  });
}

export function formatSignedMicroUsdc(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${microUsdcToDisplay(Math.abs(value))} USDC`;
}
