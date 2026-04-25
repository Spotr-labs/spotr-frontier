"use client";

import { JoinedPlayerRow } from "./atoms";
import { ProgressRing } from "./system";

export function WaitingRoom({
  joined,
  capacity,
  players,
  starting = false,
}: {
  joined: number;
  capacity: number;
  players: { address: string; status?: string }[];
  starting?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center px-6 pb-6 pt-8">
      <ProgressRing value={joined} total={capacity} complete={starting} />
      <h2 className="mt-6 text-center font-display text-[1.6rem] font-bold tracking-[-0.02em] text-white">
        {starting ? "Session starting…" : "Waiting for the table to fill"}
      </h2>
      <p className="mt-2 max-w-xs text-center text-sm text-white/60">
        {starting
          ? "Locking your seat on Solana."
          : `${joined} of ${capacity} players in. Round 1 opens once the table is full.`}
      </p>

      <div className="mt-8 w-full space-y-2">
        {players.map((player) => (
          <JoinedPlayerRow
            key={player.address}
            address={player.address}
            status={player.status}
          />
        ))}
      </div>

      <p className="mt-auto pt-8 text-center text-xs text-white/40">
        Your buy-in stays in your wallet until the table locks.
      </p>
    </div>
  );
}
