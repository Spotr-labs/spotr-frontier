"use client";

import { Input } from "../ui/input";

type DateRangePickerProps = {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
};

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2 rounded-[1rem] border border-white/12 bg-black/16 px-3 py-1.5">
      <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        From
        <Input
          type="date"
          value={from}
          onChange={(event) => onChange({ from: event.target.value, to })}
          className="h-8 w-[140px] border-white/10 bg-transparent text-xs"
        />
      </label>
      <span className="text-muted">→</span>
      <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        To
        <Input
          type="date"
          value={to}
          onChange={(event) => onChange({ from, to: event.target.value })}
          className="h-8 w-[140px] border-white/10 bg-transparent text-xs"
        />
      </label>
    </div>
  );
}
