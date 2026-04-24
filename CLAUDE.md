# SPOTR MARKETS — agent directives

## Quality bar

- **No mocks, placeholders, or stubs.** Ship real code that hits real
  dependencies (real Solana RPC, real Prisma tables, real signers). If the
  real thing cannot be implemented inside the current turn, do not fake it —
  either finish it end-to-end or leave the existing working code untouched
  and say so honestly. Anything labelled `TODO`, `FIXME`, `unimplemented`,
  stub strings like "not implemented yet", or no-op handlers that return
  fake data is a regression.
- Prefer touching less surface area over breadth-first half-finishing.
  Finish one feature rail (e.g. the join-session path end-to-end) before
  starting the next.
- When a code path depends on a signing key, RPC, or a secret that is not
  yet available in this workspace, surface that blocker to the user in plain
  text rather than inserting a placeholder.

## Testing

- Rust unit tests for `anchor/programs/spotr_markets` live in `lib.rs`
  under `#[cfg(test)] mod tests`. The PRD §3.6 worked example (1.5 / 0.5 /
  0 SOL split + orphan) MUST continue to pass. Run with
  `cargo test -p spotr_markets --lib --manifest-path anchor/Cargo.toml`.
- TypeScript must pass `npx tsc --noEmit` clean on every commit. ESLint
  must pass on touched files.
- End-to-end test: `npm run test:e2e`. Starts surfpool on
  `127.0.0.1:8899`, deploys the compiled program via `solana program
  deploy`, then runs `tests/e2e/spotr-onchain.test.ts` under `tsx`.
  Asserts the full initialize→create→join→round→enter→close→claim→sweep
  flow against a real SVM. Requires `surfpool`, `solana` CLI, and a
  built program at `anchor/target/deploy/spotr_markets.so`.

## Domain

- On-chain program: `anchor/programs/spotr_markets/src/lib.rs`. Claim
  math is lazy per-deposit as specified in PRD §3.6.3; see the Rust tests
  for the canonical example. `sweep_orphans`, `close_round`, and
  `finalize_session` are intentionally permissionless.
- Signed-action envelope: `app/lib/server/signed-action.ts`. Every
  write endpoint must pass through `verifySignedSpotrAction` AND
  `consumeSignedActionToken` before mutating state.
- Private Privy credentials live in `.env` (`NEXT_PUBLIC_PRIVY_APP_ID`,
  `PRIVY_APP_SECRET`). `.env.example` documents both.
