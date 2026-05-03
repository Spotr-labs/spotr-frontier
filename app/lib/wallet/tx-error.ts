// Classifies errors thrown by wallet signing / RPC submission so the UI can
// show a friendly message instead of the raw SolanaError dump.

export type TxErrorClass = {
  // True when the user dismissed/rejected the wallet prompt. UI should treat
  // this as a soft "cancelled" state rather than a hard error.
  rejected: boolean;
  // Friendly one-liner safe to render in toasts and notice banners.
  message: string;
};

const REJECTION_NEEDLES = [
  "user rejected",
  "user declined",
  "user denied",
  "rejected the request",
  "request was rejected",
  "rejected by user",
  "cancelled by user",
  "wallet was disconnected",
];

function collectMessages(error: unknown): string[] {
  const out: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < 6) {
    if (typeof current === "string") {
      out.push(current);
      break;
    }
    if (typeof current === "object") {
      const obj = current as {
        message?: unknown;
        cause?: unknown;
        context?: { causeMessage?: unknown };
      };
      if (typeof obj.message === "string") out.push(obj.message);
      if (typeof obj.context?.causeMessage === "string") {
        out.push(obj.context.causeMessage);
      }
      current = obj.cause;
    } else {
      break;
    }
    depth += 1;
  }
  return out;
}

// Walks the SolanaError context chain looking for `logs: string[]` (preflight
// logs from the kit's sendTransaction). Returns the flattened log array.
function collectLogs(error: unknown): string[] {
  const out: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < 6) {
    if (typeof current === "object") {
      const obj = current as {
        cause?: unknown;
        context?: { logs?: unknown };
      };
      const logs = obj.context?.logs;
      if (Array.isArray(logs)) {
        for (const entry of logs) if (typeof entry === "string") out.push(entry);
      }
      current = obj.cause;
    } else {
      break;
    }
    depth += 1;
  }
  return out;
}

// Pulls the human-readable Anchor error message out of preflight logs, if
// present. Anchor emits a line like:
//   "Program log: AnchorError thrown in <file>:<line>. Error Code: X. Error
//    Number: 1234. Error Message: <human message>."
function extractAnchorMessage(logs: string[]): string | null {
  for (const line of logs) {
    const match = line.match(/AnchorError[^]*?Error Message:\s*([^.]+(?:\.[^.]+)*)/);
    if (match) return match[1].replace(/\.\s*$/, "").trim();
  }
  return null;
}

// "custom program error: 0x1773" → 0x1773 is the Anchor error number 6003
// (Anchor offsets custom errors by 6000). Extract the line so we can at least
// show the program's discriminator in the absence of a friendlier log.
function extractCustomProgramError(logs: string[]): string | null {
  for (const line of logs) {
    if (line.includes("custom program error:")) {
      const match = line.match(/custom program error:\s*(0x[0-9a-f]+)/i);
      if (match) return `Program rejected the transaction (code ${match[1]}).`;
      return "Program rejected the transaction.";
    }
  }
  return null;
}

export function classifyTxError(error: unknown): TxErrorClass {
  const messages = collectMessages(error);
  const haystack = messages.join(" | ").toLowerCase();
  const rejected = REJECTION_NEEDLES.some((needle) => haystack.includes(needle));
  if (rejected) {
    return { rejected: true, message: "Transaction cancelled in your wallet." };
  }

  // Prefer the Anchor program's own human-readable message if it's in the
  // preflight logs — that's almost always the most useful explanation.
  const logs = collectLogs(error);
  const anchorMessage = extractAnchorMessage(logs);
  if (anchorMessage) return { rejected: false, message: anchorMessage };

  const customProgramMessage = extractCustomProgramError(logs);
  if (customProgramMessage) return { rejected: false, message: customProgramMessage };

  // Fall back to the topmost message, but strip the SolanaError prefix and
  // the giant base64 decode-instructions tail.
  for (const raw of messages) {
    const trimmed = raw
      .replace(/^SolanaError:\s*/i, "")
      .replace(/;\s*Decode this error.*$/is, "")
      .trim();
    if (trimmed) return { rejected: false, message: trimmed };
  }
  return { rejected: false, message: "Transaction failed." };
}
