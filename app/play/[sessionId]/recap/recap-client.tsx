"use client";

import { useState, useEffect } from "react";
import { useWallet } from "../../../lib/wallet/context";
import { SessionEndedScreen } from "../../../components/spotr-shell";
import type { SpotrDashboardPayload, SpotrPublicConfig } from "../../../lib/spotr-types";

export function RecapClient({
  config,
  sessionId,
  initialData,
}: {
  config: SpotrPublicConfig;
  sessionId: string;
  initialData: SpotrDashboardPayload;
}) {
  const { wallet } = useWallet();
  const walletAddress = wallet?.account.address ?? null;
  const [data, setData] = useState(initialData);

  useEffect(() => {
    const params = new URLSearchParams({ session: sessionId });
    if (walletAddress) params.set("wallet", walletAddress);
    fetch(`/api/bootstrap?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => setData(payload as SpotrDashboardPayload))
      .catch(() => {});
  }, [walletAddress, sessionId]);

  return (
    <SessionEndedScreen
      session={data.session}
      profile={data.profile}
      faultLines={data.faultLines}
      config={config}
    />
  );
}
