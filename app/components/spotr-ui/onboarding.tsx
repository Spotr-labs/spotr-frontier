"use client";

import { AlertTriangle, Check, Eye } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function OnboardingHero({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-white">
        {title}
      </h1>
      <p className="max-w-sm text-[16px] leading-[1.5] text-white/65">{body}</p>
    </div>
  );
}

export function CenteredHero({
  logo,
  title,
  body,
  action,
  footer,
}: {
  logo?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      {logo ? <div className="mb-8">{logo}</div> : null}
      <h1 className="mb-4 max-w-[340px] font-display text-[40px] font-bold leading-[1.1] text-balance text-white">
        {title}
      </h1>
      <p className="mb-10 max-w-[320px] text-[16px] leading-[1.55] text-white/60">
        {body}
      </p>
      {action ? <div className="w-full max-w-[340px]">{action}</div> : null}
      {footer ? (
        <p className="mt-8 max-w-[300px] text-[13px] leading-[1.5] text-white/50">
          {footer}
        </p>
      ) : null}
    </div>
  );
}

export function StatusIcon({
  tone,
}: {
  tone: "success" | "error" | "neutral";
}) {
  const ring =
    tone === "success"
      ? "border-success bg-success/15 text-success"
      : tone === "error"
        ? "border-destructive bg-destructive/15 text-destructive"
        : "border-primary bg-primary/15 text-primary";
  const Icon = tone === "success" ? Check : tone === "error" ? AlertTriangle : Eye;
  return (
    <div
      className={cn(
        "flex h-20 w-20 items-center justify-center rounded-full border-2",
        ring
      )}
    >
      <Icon className="h-9 w-9" strokeWidth={2.4} />
    </div>
  );
}
