"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SparklineProps = {
  data: Array<{ dateIso: string; value: number }>;
  color?: string;
  height?: number;
  format?: (value: number) => string;
};

export function Sparkline({
  data,
  color = "#f5c800",
  height = 56,
  format,
}: SparklineProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="dateIso" hide />
        <YAxis hide domain={[0, "dataMax + 1"]} />
        <Tooltip
          cursor={false}
          contentStyle={{
            background: "#0a1023",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            fontSize: 11,
          }}
          formatter={(value) => {
            const numeric = typeof value === "number" ? value : Number(value ?? 0);
            return format ? format(numeric) : numeric.toLocaleString();
          }}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-GB", { timeZone: "UTC" })
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill="url(#sparkFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
