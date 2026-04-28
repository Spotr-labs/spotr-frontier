"use client";

import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

type SegmentItem<T extends string> = { value: T; label: string };

export function FilterSegment<T extends string>(props: {
  label: string;
  options: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-[1rem] border border-white/12 bg-black/16 p-1">
      <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
        {props.label}
      </span>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => props.onChange(option.value)}
          className={cn(
            "rounded-[0.7rem] px-3 py-1 text-xs font-semibold transition",
            option.value === props.value
              ? "bg-primary/15 text-primary"
              : "text-muted hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SearchInput(props: {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="search"
      placeholder={props.placeholder ?? "Search…"}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className="h-9 w-[260px] max-w-full border-white/12 bg-black/22 text-sm"
    />
  );
}

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
}) {
  const className =
    tone === "success"
      ? "border-success/35 bg-success/10 text-success"
      : tone === "warning"
        ? "border-amber-500/35 bg-amber-500/10 text-amber-400"
        : tone === "danger"
          ? "border-destructive/35 bg-destructive/10 text-destructive"
          : tone === "primary"
            ? "border-primary/35 bg-primary/10 text-primary"
            : "border-white/12 bg-white/4 text-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em]",
        className
      )}
    >
      {label}
    </span>
  );
}
