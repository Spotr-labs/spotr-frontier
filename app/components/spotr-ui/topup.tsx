"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export function BalanceStatusRow({
  currentUsdc,
  shortfallUsdc,
}: {
  currentUsdc: number;
  shortfallUsdc: number;
}) {
  return (
    <div className="rounded-[16px] bg-black/25 px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-white/55">
          Current
        </span>
        <span className="text-[15px] font-semibold text-white">
          {currentUsdc.toFixed(2)} USDC
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-white/55">
          Short by
        </span>
        <span className="text-[15px] font-semibold text-destructive">
          {shortfallUsdc.toFixed(2)} USDC
        </span>
      </div>
    </div>
  );
}

export function AmountStepper({
  valueUsdc,
  onChange,
  step = 1,
  min = 0,
}: {
  valueUsdc: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[12px] bg-white px-3.5 py-2.5">
      <button
        type="button"
        onClick={() =>
          onChange(Math.max(min, parseFloat((valueUsdc - step).toFixed(2))))
        }
        className="flex h-8 w-8 items-center justify-center text-[var(--category-blue)]"
        aria-label="Decrease"
      >
        <Minus className="h-5 w-5" strokeWidth={3} />
      </button>
      <input
        type="number"
        value={valueUsdc}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={step}
        min={min}
        className="flex-1 bg-transparent text-center text-[18px] font-bold text-[#1a1a1a] outline-none"
      />
      <span className="text-[14px] font-semibold text-[#666]">USDC</span>
      <button
        type="button"
        onClick={() => onChange(parseFloat((valueUsdc + step).toFixed(2)))}
        className="flex h-8 w-8 items-center justify-center text-[var(--category-blue)]"
        aria-label="Increase"
      >
        <Plus className="h-5 w-5" strokeWidth={3} />
      </button>
    </div>
  );
}

export function QuickAmountChips({
  options,
  selected,
  onSelect,
}: {
  options: number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((option) => {
        const isSelected = selected === option;
        return (
          <Button
            key={option}
            type="button"
            variant="outline-light"
            onClick={() => onSelect(option)}
            data-selected={isSelected}
            className={cn(
              "flex-1 min-h-10 rounded-[10px] py-2 text-[13px] font-semibold",
              isSelected && "border-primary bg-primary/15 text-primary"
            )}
          >
            {option} USDC
          </Button>
        );
      })}
    </div>
  );
}

export function ConversionLine({ newBalanceUsdc }: { newBalanceUsdc: number }) {
  return (
    <p className="text-[13px] text-white/60">
      New balance: {newBalanceUsdc.toFixed(2)} USDC
    </p>
  );
}
