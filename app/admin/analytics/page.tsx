"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminSectionHeader } from "../../components/admin/section-header";
import { DateRangePicker } from "../../components/admin/date-range-picker";
import { useAdminDashboard } from "../../components/admin/use-admin-dashboard";
import {
  formatUsdc,
  isoToInputDate,
  shortenAddress,
} from "../../components/admin/format";
import { microUsdcToDisplay } from "../../lib/usdc";
import type {
  AdminAnalytics,
  AdminTimePoint,
} from "../../lib/spotr-types";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  });
}

export default function AdminAnalyticsPage() {
  const { walletAddress } = useAdminDashboard();
  const today = new Date();
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setUTCDate(today.getUTCDate() - 13);
  const [range, setRange] = useState({
    from: isoToInputDate(fourteenDaysAgo.toISOString()),
    to: isoToInputDate(today.toISOString()),
  });

  const swrKey = walletAddress
    ? `/api/admin/analytics?wallet=${encodeURIComponent(walletAddress)}${
        range.from ? `&from=${new Date(range.from).toISOString()}` : ""
      }${
        range.to
          ? `&to=${new Date(`${range.to}T23:59:59Z`).toISOString()}`
          : ""
      }`
    : null;
  const { data } = useSWR<AdminAnalytics>(swrKey, fetcher, {
    refreshInterval: 60_000,
  });

  return (
    <div>
      <AdminSectionHeader
        eyebrow="Analytics"
        title="Volume, fees, joins, expiry rate, top referrers"
        description="Time-series, side distribution, and referrer leaderboard. Click a date range to refresh."
        actions={
          <DateRangePicker
            from={range.from}
            to={range.to}
            onChange={setRange}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Volume per UTC day">
          <VolumeChart data={data?.volumeByDay ?? []} />
        </Panel>
        <Panel title="Protocol fees per UTC day">
          <FeesChart data={data?.feesByDay ?? []} />
        </Panel>
        <Panel title="New participants per day">
          <JoinsChart data={data?.joinsByDay ?? []} />
        </Panel>
        <Panel title="Session expiry rate per day (%)">
          <ExpiryChart data={data?.expiryRateByDay ?? []} />
        </Panel>
        <Panel title="Side distribution (last 12 rounds)">
          <SideDistribution data={data?.sideDistribution ?? []} />
        </Panel>
        <Panel title="Top 10 referrers by balance due">
          <TopReferrers data={data?.topReferrers ?? []} />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.1rem] border border-white/10 bg-black/22 p-4">
      <h2 className="mb-3 font-display text-base font-extrabold text-foreground">
        {title}
      </h2>
      <div className="h-[260px]">{children}</div>
    </section>
  );
}

function VolumeChart({ data }: { data: AdminTimePoint[] }) {
  const formatted = data.map((point) => ({
    label: dayLabel(point.dateIso),
    value: point.value,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5c800" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#f5c800" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(value) => microUsdcToDisplay(Number(value))}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => formatUsdc(Number(value))}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#f5c800"
          strokeWidth={2}
          fill="url(#volumeFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function FeesChart({ data }: { data: AdminTimePoint[] }) {
  const formatted = data.map((point) => ({
    label: dayLabel(point.dateIso),
    value: point.value,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(value) => microUsdcToDisplay(Number(value))}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => formatUsdc(Number(value))}
        />
        <Bar dataKey="value" fill="#fb923c" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function JoinsChart({ data }: { data: AdminTimePoint[] }) {
  const formatted = data.map((point) => ({
    label: dayLabel(point.dateIso),
    value: point.value,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#34d399"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ExpiryChart({ data }: { data: AdminTimePoint[] }) {
  const formatted = data.map((point) => ({
    label: dayLabel(point.dateIso),
    value: point.value,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => `${Number(value).toFixed(1)}%`}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#f87171"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SideDistribution({
  data,
}: {
  data: Array<{
    roundId: string;
    sessionTitle: string;
    roundIndex: number;
    category: string;
    sideACount: number;
    sideBCount: number;
  }>;
}) {
  const formatted = data.map((point) => ({
    label: `${shortLabel(point.sessionTitle)} R${point.roundIndex + 1}`,
    sideA: point.sideACount,
    sideB: point.sideBCount,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="sideA"
          name="Side A"
          fill="#34d399"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="sideB"
          name="Side B"
          fill="#f5c800"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TopReferrers({
  data,
}: {
  data: Array<{
    referrerWallet: string;
    referredCount: number;
    balanceDueLamports: number;
    totalAccruedLamports: number;
  }>;
}) {
  const formatted = data.map((row) => ({
    label: shortenAddress(row.referrerWallet, 4),
    balance: row.balanceDueLamports,
  }));
  if (formatted.length === 0) {
    return (
      <p className="text-sm text-muted">No referrers yet.</p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={formatted}
        layout="vertical"
        margin={{ top: 8, right: 8, bottom: 0, left: 60 }}
      >
        <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(value) => microUsdcToDisplay(Number(value))}
        />
        <YAxis
          dataKey="label"
          type="category"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => formatUsdc(Number(value))}
        />
        <Bar dataKey="balance" fill="#f5c800" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function shortLabel(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 12)}…`;
}

const tooltipStyle = {
  background: "#0a1023",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  fontSize: 11,
};
