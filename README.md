# SPOTR Markets

SPOTR is a mobile-first Solana opinion market. This repo now contains:

- a branded Next.js shell for the SPOTR session flow
- a Prisma-backed session, pair-library, reward, referral, and transaction backend
- an Anchor settlement program for session escrow, round entry, lazy redistribution, claims, and protocol fees
- a Codama-generated TypeScript client under `app/generated/spotr`
- an env-only numeric configuration layer so launch-sensitive values are not hard-coded

## Getting Started

1. Install dependencies.

   ```bash
   npm install
   ```

2. Copy the env file and set the launch config.

   ```bash
   cp .env.example .env.local
   ```

3. Push the database schema and seed the launch session.

   ```bash
   npm run db:push
   npm run db:seed
   ```

4. Build the Anchor program and regenerate the client.

   ```bash
   npm run setup
   ```

5. Start the app.

   ```bash
   npm run dev
   ```

Open `http://localhost:3000`.

## Env-Only Numeric Config

All unstable product numbers are sourced from env variables. The frontend and program scaffolding read values from the typed config loader in `app/lib/spotr-config`.

Key vars:

- `NEXT_PUBLIC_SPOTR_SESSION_MIN_WALLETS`
- `NEXT_PUBLIC_SPOTR_SESSION_MIN_TOTAL_LAMPORTS`
- `NEXT_PUBLIC_SPOTR_SESSION_BUY_IN_LAMPORTS`
- `NEXT_PUBLIC_SPOTR_ROUND_MIN_STAKE_LAMPORTS`
- `NEXT_PUBLIC_SPOTR_ROUND_COUNT`
- `NEXT_PUBLIC_SPOTR_ROUND_DURATION_SECONDS`
- `NEXT_PUBLIC_SPOTR_PROTOCOL_FEE_BPS`
- `NEXT_PUBLIC_SPOTR_REFERRAL_CUT_BPS`
- `NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_START_HOUR_UTC`
- `NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC`
- `NEXT_PUBLIC_SPOTR_LOW_PAIR_ALERT_THRESHOLD`
- `NEXT_PUBLIC_SPOTR_PAYOUT_CADENCE_DAYS`
- `NEXT_PUBLIC_SPOTR_CARD_REWARD_SLOTS`

Amounts are represented in lamports and percentages in basis points.

## Project Structure

```text
spotr/
├── app/
│   ├── components/spotr-shell.tsx
│   ├── generated/spotr/
│   ├── lib/spotr-config/
│   ├── lib/server/spotr-store.ts
│   └── page.tsx
├── anchor/
│   └── programs/spotr_markets/
├── data/
│   └── fault-line-catalog.json
├── prisma/
│   └── schema.prisma
└── .env.example
```

## Commands

```bash
npm run anchor-build
npm run anchor-test
npm run codama:js
npm run db:push
npm run db:seed
npm run build
```

## Current Scope

- The frontend is SPOTR-branded and reads live dashboard data from the backend.
- The backend persists pair library state, session lifecycle, participant escrow, reward inventory, referral accruals, referral payout batches, and transaction logs in Prisma.
- Admin routes support pair CSV imports, pair activation toggles, session deployment, reward assignment/status changes, and referral payout batching.
- Wallet writes are guarded by signed message verification, and admin writes require the signer wallet to match `SPOTR_ADMIN_WALLETS`.
- The Anchor program models SPOTR sessions, rounds, player positions, lazy side rewards, claim flows, and protocol fee withdrawal.

## Remaining Gaps

- Privy and embedded-wallet identity are still not wired in; the app currently uses wallet-standard plus signed requests.
- Frontend actions still update the off-chain backend, not the on-chain program directly.
- There are no automated backend integration tests yet beyond lint/build/setup verification.

## Notes

- Use `avm use 0.32.1` if your local Anchor CLI drifts from the repo’s `anchor-lang` version.
- After changing the Rust program, run `npm run setup` to rebuild and regenerate the JS client.
