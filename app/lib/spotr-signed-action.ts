export type SpotrSignedActionName =
  | "join-session"
  | "enter-round"
  | "claim-round-proceeds"
  | "claim-session-balance"
  | "admin-import-pairs"
  | "admin-toggle-pair"
  | "admin-toggle-pair-bulk"
  | "admin-edit-pair"
  | "admin-deploy-session"
  | "admin-chain-deploy-session"
  | "admin-payout-referrals"
  | "admin-payout-referrals-bulk"
  | "admin-assign-reward"
  | "admin-assign-reward-bulk"
  | "admin-update-reward-status"
  | "admin-expire-session"
  | "admin-finalize-session"
  | "admin-close-round"
  | "admin-sweep-orphans"
  | "admin-withdraw-protocol-fees"
  | "admin-assign-card-pack"
  | "admin-sync-sessions";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalizeJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, JsonValue>>((accumulator, key) => {
        const nestedValue = (value as Record<string, unknown>)[key];
        if (nestedValue !== undefined) {
          accumulator[key] = normalizeJsonValue(nestedValue);
        }
        return accumulator;
      }, {});
  }

  throw new Error("Signed SPOTR actions only support JSON payloads.");
}

export function stableStringify(value: unknown) {
  return JSON.stringify(normalizeJsonValue(value));
}

export function buildSpotrSignedActionMessage<TPayload>(
  action: SpotrSignedActionName,
  issuedAtIso: string,
  payload: TPayload
) {
  return `SPOTR|${action}|${issuedAtIso}|${stableStringify(payload)}`;
}
