# SPOTR Anchor Program

The SPOTR on-chain program lives in `anchor/programs/spotr_markets` and currently covers:

- protocol config initialization and updates
- session creation and join escrow
- round creation and close
- single-entry round positions per player
- lazy redistribution accounting for same-side entrants
- round claims, session balance claims, and protocol fee withdrawal

Program ID:

```text
F4jZpgbtTb6RWNWq6v35fUeiAsRJMrDczVPv9U23yXjB
```

## Build

```bash
cd anchor
anchor build
```

## Test

```bash
cd anchor
anchor test --skip-deploy
```

## Regenerate the JS Client

```bash
cd ..
npm run codama:js
```

This regenerates `app/generated/spotr/` from `anchor/target/idl/spotr_markets.json`.

## Changing the Program ID

1. Generate a new keypair.

   ```bash
   cd anchor
   solana-keygen new -o target/deploy/spotr_markets-keypair.json
   ```

2. Get the new address.

   ```bash
   solana address -k target/deploy/spotr_markets-keypair.json
   ```

3. Update:

- `anchor/Anchor.toml`
- `anchor/programs/spotr_markets/src/lib.rs`

4. Rebuild and regenerate the client.

   ```bash
   anchor build
   cd ..
   npm run codama:js
   ```
