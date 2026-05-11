export function buildSpotrBootstrapPath(input: {
  walletAddress?: string | null;
  sessionId?: string | null;
}) {
  const params = new URLSearchParams();
  if (input.walletAddress) {
    params.set("wallet", input.walletAddress);
  }
  if (input.sessionId) {
    params.set("session", input.sessionId);
  }
  const query = params.toString();
  return query ? `/api/bootstrap?${query}` : "/api/bootstrap";
}

