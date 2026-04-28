import { microUsdcToDisplay } from "../../lib/usdc";
import { formatUtc } from "../../lib/format";

export function formatUsdc(lamports: number, options: { compact?: boolean } = {}) {
  const value = microUsdcToDisplay(lamports);
  if (options.compact) {
    return `${value} USDC`;
  }
  return `${value} USDC`;
}

export { formatUtc };

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const diff = ms - Date.now();
  const absSec = Math.abs(diff) / 1000;
  if (absSec < 60) return diff <= 0 ? "just now" : "in <1m";
  const min = absSec / 60;
  if (min < 60)
    return diff <= 0 ? `${Math.round(min)}m ago` : `in ${Math.round(min)}m`;
  const hr = min / 60;
  if (hr < 48)
    return diff <= 0 ? `${Math.round(hr)}h ago` : `in ${Math.round(hr)}h`;
  const days = hr / 24;
  return diff <= 0
    ? `${Math.round(days)}d ago`
    : `in ${Math.round(days)}d`;
}

export function shortenAddress(value: string | null | undefined, count = 4): string {
  if (!value) return "—";
  if (value.length <= count * 2 + 3) return value;
  return `${value.slice(0, count)}…${value.slice(-count)}`;
}

export function isoToInputDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
