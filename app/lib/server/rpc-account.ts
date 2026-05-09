export async function fetchAccountExists(
  rpcUrl: string,
  pda: string,
): Promise<boolean> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [pda, { encoding: "base64" }],
    }),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { result?: { value: unknown } | null };
  return json.result?.value != null;
}

export async function fetchTokenBalance(
  rpcUrl: string,
  tokenAccount: string,
): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountBalance",
      params: [tokenAccount],
    }),
    cache: "no-store",
  });
  if (!res.ok) return 0n;
  const json = (await res.json()) as {
    result?: { value?: { amount?: string } } | null;
  };
  if (!json.result?.value?.amount) return 0n;
  return BigInt(json.result.value.amount);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForAccountExists(
  rpcUrl: string,
  pda: string,
  options: { attempts?: number; delayMs?: number } = {},
) {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 300;
  for (let i = 0; i < attempts; i += 1) {
    if (await fetchAccountExists(rpcUrl, pda)) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}

export async function waitForTokenBalanceAtLeast(
  rpcUrl: string,
  tokenAccount: string,
  minimum: bigint,
  options: { attempts?: number; delayMs?: number } = {},
) {
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 300;
  for (let i = 0; i < attempts; i += 1) {
    const balance = await fetchTokenBalance(rpcUrl, tokenAccount);
    if (balance >= minimum) return balance;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return fetchTokenBalance(rpcUrl, tokenAccount);
}
