"use client";

import { type ReactNode } from "react";
import { ellipsify } from "../../lib/explorer";
import { WalletAvatar } from "./atoms";
import { EyeBrand } from "./atoms";
import { ProgressRing } from "./system";

export type FillRoomPlayer = {
  address: string;
  status?: ReactNode;
};

export function RoundFillRoom({
  caption,
  current,
  threshold,
  players,
  footer = "Your position is secured. You'll enter automatically when the session fills.",
  starting = false,
}: {
  caption: string;
  current: number;
  threshold: number;
  players: FillRoomPlayer[];
  footer?: string;
  starting?: boolean;
}) {
  const cappedCurrent = Math.min(current, threshold);
  const remaining = Math.max(0, threshold - cappedCurrent);
  const isFull = remaining === 0 || starting;
  // Recent joiners full opacity; older ones fade — last 5 visible.
  const visiblePlayers = players.slice(-5);
  const fadeStart = Math.max(0, visiblePlayers.length - 5);

  return (
    <div className="flex flex-1 flex-col items-center px-6 pb-10 pt-10">
      <EyeBrand size={28} />
      <p className="mt-3 text-center text-[12px] text-white/60">{caption}</p>

      <div className="mt-8">
        <ProgressRing value={cappedCurrent} total={threshold} complete={isFull} />
      </div>

      <h2 className="mt-6 text-center font-display text-[1.4rem] font-bold tracking-[-0.02em] text-white">
        {isFull ? "Session starting…" : "Waiting for players"}
      </h2>
      <p className="mt-1 text-center text-sm text-white/55">
        {isFull
          ? "Locking your seat on Solana."
          : `${remaining} more to fill the session`}
      </p>

      {visiblePlayers.length > 0 ? (
        <div className="mt-7 w-full max-w-[320px]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
            Joining now
          </p>
          <div className="space-y-2">
            {visiblePlayers.map((player, index) => {
              // index 0 = oldest visible, last = newest. Fade older ones.
              const reverseIndex = visiblePlayers.length - 1 - index;
              const opacity = Math.max(0.45, 1 - reverseIndex * 0.13);
              return (
                <div
                  key={`${player.address}-${index + fadeStart}`}
                  className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5"
                  style={{ opacity }}
                >
                  <WalletAvatar seed={player.address} size={28} />
                  <p className="flex-1 truncate font-mono text-[13px] font-semibold tabular-nums text-white">
                    {ellipsify(player.address, 4)}
                  </p>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-success">
                    {player.status ?? "joined"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <p className="mt-auto pt-10 text-center text-xs leading-relaxed text-white/40">
        {footer}
      </p>
    </div>
  );
}

// Backwards-compatible alias for the original call site.
export function WaitingRoom({
  joined,
  threshold,
  players,
  starting = false,
  caption,
}: {
  joined: number;
  threshold: number;
  players: FillRoomPlayer[];
  starting?: boolean;
  caption?: string;
}) {
  return (
    <RoundFillRoom
      caption={caption ?? `Session fills at ${threshold} players`}
      current={joined}
      threshold={threshold}
      players={players}
      starting={starting}
    />
  );
}
