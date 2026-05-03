"use client";

import { JoinedPlayerRow } from "./atoms";
import { ProgressRing } from "./system";

export function WaitingRoom({
  joined,
  startsAtIso,
  players,
  starting = false,
}: {
  joined: number;
  startsAtIso: string;
  players: { address: string; status?: string }[];
  starting?: boolean;
}) {
  const startsAt = new Date(startsAtIso);
  const formatted = startsAt.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="flex flex-1 flex-col items-center px-6 pb-6 pt-8">
      <ProgressRing value={starting ? 1 : 0} total={1} complete={starting} />
      <h2 className="mt-6 text-center font-display text-[1.6rem] font-bold tracking-[-0.02em] text-white">
        {starting ? "Session starting…" : "Waiting for the session to open"}
      </h2>
      <p className="mt-2 max-w-xs text-center text-sm text-white/60">
        {starting
          ? "Locking your seat on Solana."
          : `${joined} player${joined === 1 ? "" : "s"} in. Round 1 opens at ${formatted}.`}
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
