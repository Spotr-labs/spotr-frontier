"use client";

import type { ReactNode } from "react";

type AdminSectionHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function AdminSectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: AdminSectionHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-primary">
          {eyebrow}
        </p>
        <h1 className="font-display text-[1.6rem] font-extrabold tracking-[-0.04em] text-foreground lg:text-[1.9rem]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
