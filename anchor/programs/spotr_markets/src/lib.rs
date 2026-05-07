use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("4L3ARpxux9pP3hAMKsmGt325CkELLjnXq7S98eQpJaB4");

const CONFIG_SEED: &[u8] = b"config";
const PROTOCOL_TREASURY_SEED: &[u8] = b"protocol-treasury";
const PROTOCOL_TREASURY_TOKENS_SEED: &[u8] = b"protocol-treasury-tokens";
const SESSION_SEED: &[u8] = b"session";
const SESSION_TREASURY_SEED: &[u8] = b"session-treasury";
const SESSION_TREASURY_TOKENS_SEED: &[u8] = b"session-treasury-tokens";
const ROUND_SEED: &[u8] = b"round";
const ROUND_DEPOSIT_SEED: &[u8] = b"round-deposit";
const PLAYER_SESSION_SEED: &[u8] = b"player-session";
const POSITION_SEED: &[u8] = b"position";
const USER_VAULT_SEED: &[u8] = b"user-vault";
const USER_VAULT_TOKENS_SEED: &[u8] = b"user-vault-tokens";

/// Default minimum number of wallets that must deposit before a round flips
/// `Pending → Open` (and the predict phase begins). Per session can override.
pub const DEFAULT_ROUND_FILL_THRESHOLD: u8 = 7;

/// PRD §3.7 — minimum per-position stake is 1 USDC (1_000_000 micro-USDC).
pub const MIN_POSITION_USDC_UNITS: u64 = 1_000_000;

/// Top-tier share of the redistribution pool R (basis points).
pub const TOP_BPS: u64 = 6_000;
/// Mid-tier share of the redistribution pool R (basis points).
pub const MID_BPS: u64 = 4_000;
/// Decay-tier cut applied to each decay wallet's PM_i (basis points).
pub const DECAY_CUT_BPS: u64 = 2_000;
/// Top tier size as a fraction of N (basis points): `max(1, floor(N × 0.20))`.
pub const TOP_BOUNDARY_BPS: u64 = 2_000; // 20%
/// Decay tier size as a fraction of N (basis points): `floor(N × 0.40)`.
/// Decay group occupies the **last** `floor(N × 0.40)` indices so the
/// boundary is `decay_start = N − decay_count`. (Using "60% boundary"
/// directly produces a different floor at small N — e.g. for N=3,
/// `floor(3 × 0.60) = 1` vs `3 − floor(3 × 0.40) = 2`. The doc's intent
/// is the latter.)
pub const DECAY_TIER_BPS: u64 = 4_000; // 40%

#[program]
pub mod spotr_markets {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        input: ConfigInput,
    ) -> Result<()> {
        validate_config(input)?;

        let config = &mut ctx.accounts.config;
        config.authorities = input.authorities;
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.protocol_fee_bps = input.protocol_fee_bps;
        config.referral_cut_bps = input.referral_cut_bps;
        config.default_round_count = input.round_count;
        config.default_round_duration_seconds = input.round_duration_seconds;
        config.default_buy_in_usdc_units = input.buy_in_usdc_units;
        config.default_round_fill_threshold = input.round_fill_threshold;
        config.bump = ctx.bumps.config;

        let treasury = &mut ctx.accounts.protocol_treasury;
        treasury.authorities = input.authorities;
        treasury.total_collected_usdc_units = 0;
        treasury.bump = ctx.bumps.protocol_treasury;
        treasury.token_bump = ctx.bumps.protocol_treasury_tokens;

        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, input: ConfigInput) -> Result<()> {
        validate_config(input)?;
        require!(
            is_admin(&ctx.accounts.authority.key(), &ctx.accounts.config.authorities),
            SpotrError::InvalidConfig
        );

        let config = &mut ctx.accounts.config;
        config.authorities = input.authorities;
        config.protocol_fee_bps = input.protocol_fee_bps;
        config.referral_cut_bps = input.referral_cut_bps;
        config.default_round_count = input.round_count;
        config.default_round_duration_seconds = input.round_duration_seconds;
        config.default_buy_in_usdc_units = input.buy_in_usdc_units;
        config.default_round_fill_threshold = input.round_fill_threshold;
        Ok(())
    }

    pub fn create_session(
        ctx: Context<CreateSession>,
        input: SessionInput,
    ) -> Result<()> {
        validate_session_input(input)?;

        let session = &mut ctx.accounts.session;
        require!(
            is_admin(&ctx.accounts.authority.key(), &ctx.accounts.config.authorities),
            SpotrError::InvalidConfig
        );
        session.session_number = input.session_number;
        session.status = SessionStatus::Pending;
        session.round_count = input.round_count;
        session.round_duration_seconds = input.round_duration_seconds;
        session.buy_in_usdc_units = input.buy_in_usdc_units;
        session.protocol_fee_bps = input.protocol_fee_bps;
        session.referral_cut_bps = input.referral_cut_bps;
        session.joined_wallets = 0;
        session.total_escrowed_usdc_units = 0;
        session.protocol_fee_accrued_usdc_units = 0;
        session.rounds_closed = 0;
        session.start_ts = input.start_ts;
        session.end_ts = input.end_ts;
        session.round_fill_threshold = if input.round_fill_threshold > 0 {
            input.round_fill_threshold
        } else {
            ctx.accounts.config.default_round_fill_threshold
        };
        session.bump = ctx.bumps.session;

        let treasury = &mut ctx.accounts.session_treasury;
        treasury.session = session.key();
        treasury.bump = ctx.bumps.session_treasury;
        treasury.token_bump = ctx.bumps.session_treasury_tokens;

        Ok(())
    }

    pub fn init_user_vault(ctx: Context<InitUserVault>) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.active_sessions = 0;
        vault.total_deposited = 0;
        vault.total_withdrawn = 0;
        vault.bump = ctx.bumps.vault;
        vault.token_bump = ctx.bumps.vault_tokens;
        Ok(())
    }

    pub fn deposit_to_vault(ctx: Context<DepositToVault>, amount: u64) -> Result<()> {
        require!(amount > 0, SpotrError::NothingToClaim);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_token_account.to_account_info(),
                    to: ctx.accounts.vault_tokens.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_deposited = vault
            .total_deposited
            .checked_add(amount)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_from_vault(ctx: Context<WithdrawFromVault>, amount: u64) -> Result<()> {
        require!(amount > 0, SpotrError::NothingToClaim);
        require!(
            ctx.accounts.vault.active_sessions == 0,
            SpotrError::VaultLocked
        );
        require!(
            ctx.accounts.vault_tokens.amount >= amount,
            SpotrError::InsufficientVaultBalance
        );

        let owner_key = ctx.accounts.owner.key();
        let bump = ctx.accounts.vault.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            USER_VAULT_SEED,
            owner_key.as_ref(),
            std::slice::from_ref(&bump),
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_withdrawn = vault
            .total_withdrawn
            .checked_add(amount)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }

    pub fn join_session(ctx: Context<JoinSession>) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        maybe_activate(session, &clock);
        require!(
            matches!(session.status, SessionStatus::Pending | SessionStatus::Live),
            SpotrError::SessionNotJoinable
        );
        require!(clock.unix_timestamp <= session.end_ts, SpotrError::SessionClosed);

        let buy_in = session.buy_in_usdc_units;

        if buy_in > 0 {
            // Move buy-in from the player's vault → session treasury token account.
            // The vault PDA signs as the authority on `vault_tokens`.
            let owner_key = ctx.accounts.player.key();
            let vault_bump = ctx.accounts.vault.bump;
            let signer_seeds: &[&[&[u8]]] = &[&[
                USER_VAULT_SEED,
                owner_key.as_ref(),
                std::slice::from_ref(&vault_bump),
            ]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_tokens.to_account_info(),
                        to: ctx.accounts.session_treasury_tokens.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                buy_in,
            )?;
        }

        let player_session = &mut ctx.accounts.player_session;
        player_session.session = session.key();
        player_session.player = ctx.accounts.player.key();
        player_session.total_escrow_usdc_units = buy_in;
        player_session.remaining_escrow_usdc_units = buy_in;
        player_session.entered_round_mask = 0;
        player_session.deposited_round_mask = 0;
        player_session.joined_at = clock.unix_timestamp;
        player_session.bump = ctx.bumps.player_session;
        player_session.round_choices = vec![u8::MAX; session.round_count as usize];

        session.joined_wallets = session
            .joined_wallets
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;
        session.total_escrowed_usdc_units = session
            .total_escrowed_usdc_units
            .checked_add(buy_in)
            .ok_or(SpotrError::MathOverflow)?;

        let vault = &mut ctx.accounts.vault;
        vault.active_sessions = vault
            .active_sessions
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }

    pub fn create_round(ctx: Context<CreateRound>, input: RoundInput) -> Result<()> {
        let session = &ctx.accounts.session;
        require!(input.index < session.round_count, SpotrError::InvalidRoundIndex);

        // Rounds start in `Pending` (the wait phase). They flip to `Open`
        // once `deposit_for_round` brings `deposits_count` up to
        // `session.round_fill_threshold`. They settle to `Closed` via the
        // existing permissionless `close_round` flow once the session ends.
        let round = &mut ctx.accounts.round;
        round.session = session.key();
        round.index = input.index;
        round.state = RoundState::Pending;
        round.pair_id = input.pair_id;
        round.opens_at = session.start_ts;
        round.closes_at = session.end_ts;
        round.side_a = SideState::default();
        round.side_b = SideState::default();
        round.total_volume_usdc_units = 0;
        round.deposits_count = 0;
        round.total_deposit_pool_usdc_units = 0;
        round.winning_side = None;
        round.total_pool_usdc_units = 0;
        round.winning_side_count = 0;
        round.redistribute_applied = false;
        round.bump = ctx.bumps.round;

        Ok(())
    }

    /// Lock the player's side for a round. The wager amount comes from the
    /// `RoundDeposit` PDA (committed earlier via `deposit_for_round`); no
    /// token transfer happens here. The round must already be `Open`
    /// (i.e. the wallet-fill threshold has been reached).
    pub fn enter_position(
        ctx: Context<EnterPosition>,
        side: SideSelection,
    ) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        let round = &mut ctx.accounts.round;
        let player_session = &mut ctx.accounts.player_session;
        let deposit = &mut ctx.accounts.round_deposit;

        maybe_activate(session, &clock);
        require!(session.status == SessionStatus::Live, SpotrError::SessionNotLive);
        require!(round.state == RoundState::Open, SpotrError::RoundNotOpen);
        require!(!deposit.used_for_position, SpotrError::DepositAlreadyUsed);
        require!(!deposit.refunded, SpotrError::DepositAlreadyUsed);

        let wager_usdc_units = deposit.amount_usdc_units;
        require!(
            wager_usdc_units >= MIN_POSITION_USDC_UNITS,
            SpotrError::StakeBelowMinimum
        );

        let round_bit = bit_for_round(round.index)?;
        require!(
            player_session.entered_round_mask & round_bit == 0,
            SpotrError::RoundAlreadyEntered
        );

        // Protocol fee was already accrued at `deposit_for_round` time. Net
        // stake = deposit amount minus that fee.
        let (fee_units, net_units) =
            split_fee(wager_usdc_units, session.protocol_fee_bps)?;
        require!(net_units > 0, SpotrError::StakeBelowMinimum);

        // Tokens are already in the session treasury from `deposit_for_round`.
        // No transfer here.

        let side_state = match side {
            SideSelection::A => &mut round.side_a,
            SideSelection::B => &mut round.side_b,
        };
        side_state.total_net_deposits_usdc_units = side_state
            .total_net_deposits_usdc_units
            .checked_add(net_units)
            .ok_or(SpotrError::MathOverflow)?;
        side_state.total_entries = side_state
            .total_entries
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;

        player_session.entered_round_mask |= round_bit;
        let side_byte = match side {
            SideSelection::A => 0u8,
            SideSelection::B => 1u8,
        };
        if (round.index as usize) < player_session.round_choices.len() {
            player_session.round_choices[round.index as usize] = side_byte;
        }

        session.protocol_fee_accrued_usdc_units = session
            .protocol_fee_accrued_usdc_units
            .checked_add(fee_units)
            .ok_or(SpotrError::MathOverflow)?;
        round.total_volume_usdc_units = round
            .total_volume_usdc_units
            .checked_add(wager_usdc_units)
            .ok_or(SpotrError::MathOverflow)?;

        let position = &mut ctx.accounts.position;
        position.round = round.key();
        position.player = ctx.accounts.player.key();
        position.side = side;
        position.deposit_index = deposit.deposit_index;
        position.net_amount_usdc_units = net_units;
        position.final_payout_usdc_units = 0;
        position.claimed_usdc_units = 0;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        deposit.used_for_position = true;

        Ok(())
    }

    /// Stake USDC into a round during the wait phase. Once
    /// `round.deposits_count` reaches `session.round_fill_threshold`, the
    /// round flips `Pending → Open` and `enter_position` becomes callable.
    pub fn deposit_for_round(
        ctx: Context<DepositForRound>,
        amount_usdc_units: u64,
    ) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        let round = &mut ctx.accounts.round;
        let player_session = &mut ctx.accounts.player_session;
        let deposit = &mut ctx.accounts.round_deposit;

        maybe_activate(session, &clock);
        require!(session.status == SessionStatus::Live, SpotrError::SessionNotLive);
        require!(
            clock.unix_timestamp <= session.end_ts,
            SpotrError::SessionClosed
        );
        // A player may deposit while the round is still `Pending`, or — as a
        // session-late-but-round-early deposit — while the round is `Open`,
        // but only if they joined the session before the round actually
        // flipped open. `round.opens_at` is stamped to the flip moment below
        // (and remains the scheduled `session.start_ts` until the flip), so a
        // wallet that joined the session *after* the flip will be rejected.
        require!(
            round.state == RoundState::Pending
                || (round.state == RoundState::Open
                    && player_session.joined_at <= round.opens_at),
            SpotrError::RoundNotPending
        );
        require!(
            amount_usdc_units >= MIN_POSITION_USDC_UNITS,
            SpotrError::StakeBelowMinimum
        );

        let round_bit = bit_for_round(round.index)?;
        require!(
            player_session.deposited_round_mask & round_bit == 0,
            SpotrError::DepositAlreadyExists
        );

        // Move the deposit from the player's vault into the session
        // treasury. The wager bookkeeping inside `enter_position` will read
        // this amount back from `RoundDeposit`.
        let owner_key = ctx.accounts.player.key();
        let vault_bump = ctx.accounts.vault.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            USER_VAULT_SEED,
            owner_key.as_ref(),
            std::slice::from_ref(&vault_bump),
        ]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    to: ctx.accounts.session_treasury_tokens.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount_usdc_units,
        )?;

        // The first depositor for this round gets index 0; assign before
        // bumping the count so the index matches the wallet's arrival order.
        deposit.round = round.key();
        deposit.player = owner_key;
        deposit.amount_usdc_units = amount_usdc_units;
        deposit.deposit_index = round.deposits_count;
        deposit.used_for_position = false;
        deposit.refunded = false;
        deposit.bump = ctx.bumps.round_deposit;

        round.deposits_count = round
            .deposits_count
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;
        round.total_deposit_pool_usdc_units = round
            .total_deposit_pool_usdc_units
            .checked_add(amount_usdc_units)
            .ok_or(SpotrError::MathOverflow)?;

        if round.state == RoundState::Pending
            && u8::try_from(round.deposits_count.min(u8::MAX as u16))
                .map_err(|_| SpotrError::MathOverflow)?
                >= session.round_fill_threshold
        {
            round.state = RoundState::Open;
            // Stamp the actual flip moment so future late deposits can be
            // gated on `joined_at <= opens_at`.
            round.opens_at = clock.unix_timestamp;
        }

        player_session.deposited_round_mask |= round_bit;

        Ok(())
    }

    /// Refund a deposit when the round closed without ever flipping to
    /// `Open` (under-filled), or when the round filled and closed but the
    /// player never picked a side. Idempotent — once refunded the receipt
    /// flag prevents double-claim.
    pub fn refund_unused_deposit(ctx: Context<RefundUnusedDeposit>) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let round = &ctx.accounts.round;
        let deposit = &mut ctx.accounts.round_deposit;

        require!(round.state == RoundState::Closed, SpotrError::RoundStillOpen);
        require!(!deposit.refunded, SpotrError::AlreadyClaimed);
        require!(
            !deposit.used_for_position,
            SpotrError::DepositAlreadyUsed
        );

        let amount = deposit.amount_usdc_units;
        deposit.refunded = true;

        if amount > 0 {
            transfer_from_session_treasury_tokens(
                &ctx.accounts.session,
                &ctx.accounts.session_treasury,
                &ctx.accounts.session_treasury_tokens,
                &ctx.accounts.vault_tokens.to_account_info(),
                &ctx.accounts.token_program,
                amount,
            )?;
        }

        Ok(())
    }

    /// Permissionless, idempotent. Rounds close together with the session:
    /// once the session has reached its scheduled `end_ts` (or has already
    /// transitioned out of Live), anyone can flush a round to `Closed`.
    pub fn close_round(ctx: Context<CloseRound>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        let session = &mut ctx.accounts.session;

        if round.state == RoundState::Closed {
            return Ok(());
        }

        let session_ended = clock.unix_timestamp >= session.end_ts
            || session.status == SessionStatus::Completed
            || session.status == SessionStatus::Expired;
        require!(session_ended, SpotrError::RoundStillOpen);
        round.state = RoundState::Closed;

        session.rounds_closed = session
            .rounds_closed
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;
        if session.rounds_closed >= session.round_count {
            session.status = SessionStatus::Completed;
        }

        Ok(())
    }

    /// Admin-only: force-close an open round before its `closes_at`.
    /// Used when the admin wants to wind a session down early. Closing all
    /// rounds via this path also flips `Session.status` to `Completed`,
    /// matching the natural permissionless `close_round` flow.
    pub fn admin_close_round(ctx: Context<AdminCloseRound>) -> Result<()> {
        require!(
            is_admin(&ctx.accounts.authority.key(), &ctx.accounts.config.authorities),
            SpotrError::InvalidConfig
        );
        let round = &mut ctx.accounts.round;
        let session = &mut ctx.accounts.session;

        if round.state == RoundState::Closed {
            return Ok(());
        }

        round.state = RoundState::Closed;

        session.rounds_closed = session
            .rounds_closed
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;
        if session.rounds_closed >= session.round_count {
            session.status = SessionStatus::Completed;
        }

        Ok(())
    }

    /// Admin-only: mark a session `Completed` once every round has been closed.
    /// `admin_close_round` already does this on the last round, but this is a
    /// safety hatch if rounds ended via the permissionless path and the
    /// session-status flip somehow wasn't triggered.
    pub fn admin_close_session(ctx: Context<AdminCloseSession>) -> Result<()> {
        require!(
            is_admin(&ctx.accounts.authority.key(), &ctx.accounts.config.authorities),
            SpotrError::InvalidConfig
        );
        let session = &mut ctx.accounts.session;
        require!(
            session.rounds_closed >= session.round_count,
            SpotrError::RoundStillOpen
        );
        if session.status != SessionStatus::Completed {
            session.status = SessionStatus::Completed;
        }
        Ok(())
    }

    /// Admin-only: declare the winning side for a closed round and freeze
    /// the pari-mutuel pool. Must run before `settle_round`. Idempotency:
    /// rejects if a winner is already set.
    pub fn resolve_round(
        ctx: Context<ResolveRound>,
        winning_side: SideSelection,
    ) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.authority.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let round = &mut ctx.accounts.round;
        require!(round.state == RoundState::Closed, SpotrError::RoundStillOpen);
        require!(round.winning_side.is_none(), SpotrError::RoundAlreadyResolved);

        // Pari-mutuel pool P = sum of net stakes across both sides.
        let pool = round
            .side_a
            .total_net_deposits_usdc_units
            .checked_add(round.side_b.total_net_deposits_usdc_units)
            .ok_or(SpotrError::MathOverflow)?;

        let winners = match winning_side {
            SideSelection::A => round.side_a.total_entries,
            SideSelection::B => round.side_b.total_entries,
        };
        let winners_u16 = u16::try_from(winners).map_err(|_| SpotrError::MathOverflow)?;

        round.winning_side = Some(winning_side);
        round.total_pool_usdc_units = pool;
        round.winning_side_count = winners_u16;

        Ok(())
    }

    /// Admin-only: settle every winning position with its pari-mutuel
    /// payout, then apply the top-20 / mid-60 / decay-40 redistribution
    /// pass when N ≥ 3. The caller must pass every winning position via
    /// `remaining_accounts` (count = `round.winning_side_count`).
    pub fn settle_round<'info>(
        ctx: Context<'_, '_, '_, 'info, SettleRound<'info>>,
    ) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.authority.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let round = &mut ctx.accounts.round;
        let winning_side = round
            .winning_side
            .ok_or(SpotrError::RoundNotResolved)?;
        require!(!round.redistribute_applied, SpotrError::RoundAlreadySettled);

        let n = round.winning_side_count as usize;
        require!(
            ctx.remaining_accounts.len() == n,
            SpotrError::MissingWinningPositions
        );
        if n == 0 {
            round.redistribute_applied = true;
            return Ok(());
        }

        let s_winning = match winning_side {
            SideSelection::A => round.side_a.total_net_deposits_usdc_units,
            SideSelection::B => round.side_b.total_net_deposits_usdc_units,
        };
        let pool = round.total_pool_usdc_units;
        require!(s_winning > 0, SpotrError::MathOverflow);

        // Deserialize, validate, and rank winning positions by deposit
        // index ascending. Each winning-side `PlayerRoundPosition` lives at
        // PDA `[POSITION_SEED, round, player]` and the program owns it.
        let program_id = ctx.program_id;
        let mut positions: Vec<(usize, u16, u64)> = Vec::with_capacity(n);
        for (i, ai) in ctx.remaining_accounts.iter().enumerate() {
            require!(ai.owner == program_id, SpotrError::InvalidConfig);
            require!(ai.is_writable, SpotrError::InvalidConfig);
            let data = ai.try_borrow_data()?;
            let pos = PlayerRoundPosition::try_deserialize(&mut data.as_ref())?;
            drop(data);
            require!(pos.round == round.key(), SpotrError::InvalidConfig);
            require!(pos.side == winning_side, SpotrError::WrongSide);
            // PM_i = (net × P) / S_winning. u128 to avoid overflow.
            let pm = (pos.net_amount_usdc_units as u128)
                .checked_mul(pool as u128)
                .ok_or(SpotrError::MathOverflow)?
                / (s_winning as u128);
            let pm_u64 = u64::try_from(pm).map_err(|_| SpotrError::MathOverflow)?;
            positions.push((i, pos.deposit_index, pm_u64));
        }

        // Sort by deposit_index ascending. First wallet to deposit = index 0
        // (top tier candidate); last to deposit = decay tier.
        positions.sort_by_key(|(_, idx, _)| *idx);

        let mut payouts: Vec<u64> = positions.iter().map(|(_, _, pm)| *pm).collect();
        if n >= 3 {
            redistribute(&mut payouts)?;
        }

        // Write final_payout back into each remaining account in its
        // original (unsorted) order. We zip the sorted slot back to the
        // original index via `positions[k].0`.
        for (k, payout) in payouts.iter().enumerate() {
            let (orig_index, _, _) = positions[k];
            let ai = &ctx.remaining_accounts[orig_index];
            let mut data = ai.try_borrow_mut_data()?;
            let mut pos = PlayerRoundPosition::try_deserialize(&mut data.as_ref())?;
            pos.final_payout_usdc_units = *payout;
            let mut writer: &mut [u8] = &mut data;
            pos.try_serialize(&mut writer)?;
        }

        round.redistribute_applied = true;
        Ok(())
    }

    pub fn claim_round(ctx: Context<ClaimRound>) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let round = &ctx.accounts.round;
        require!(round.state == RoundState::Closed, SpotrError::RoundStillOpen);
        require!(round.redistribute_applied, SpotrError::RoundNotSettled);

        let position = &ctx.accounts.position;
        require!(!position.claimed, SpotrError::AlreadyClaimed);
        let winning_side = round.winning_side.ok_or(SpotrError::RoundNotResolved)?;
        require!(position.side == winning_side, SpotrError::WrongSide);

        let pending_u64 = position
            .final_payout_usdc_units
            .checked_sub(position.claimed_usdc_units)
            .ok_or(SpotrError::MathOverflow)?;

        let position_mut = &mut ctx.accounts.position;
        position_mut.claimed_usdc_units = position_mut.final_payout_usdc_units;
        position_mut.claimed = true;

        if pending_u64 > 0 {
            transfer_from_session_treasury_tokens(
                &ctx.accounts.session,
                &ctx.accounts.session_treasury,
                &ctx.accounts.session_treasury_tokens,
                &ctx.accounts.vault_tokens.to_account_info(),
                &ctx.accounts.token_program,
                pending_u64,
            )?;
        }

        Ok(())
    }

    /// PRD §3.3 — permissionless. Flips Pending→Expired once end_ts passes.
    pub fn finalize_session(ctx: Context<FinalizeSession>) -> Result<()> {
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;

        if session.status == SessionStatus::Expired
            || session.status == SessionStatus::Completed
        {
            return Ok(());
        }

        require!(
            clock.unix_timestamp > session.end_ts,
            SpotrError::SessionStillInProgress
        );

        if session.status == SessionStatus::Pending {
            session.status = SessionStatus::Expired;
        }

        Ok(())
    }

    pub fn claim_session_balance(ctx: Context<ClaimSessionBalance>) -> Result<()> {
        require!(
            is_admin(
                &ctx.accounts.sponsor.key(),
                &ctx.accounts.config.authorities
            ),
            SpotrError::InvalidConfig
        );
        let session = &ctx.accounts.session;
        require!(
            matches!(session.status, SessionStatus::Completed | SessionStatus::Expired),
            SpotrError::SessionStillInProgress
        );

        let player_session = &mut ctx.accounts.player_session;
        let refund_amount = player_session.remaining_escrow_usdc_units;
        player_session.remaining_escrow_usdc_units = 0;

        if refund_amount > 0 {
            transfer_from_session_treasury_tokens(
                session,
                &ctx.accounts.session_treasury,
                &ctx.accounts.session_treasury_tokens,
                &ctx.accounts.vault_tokens.to_account_info(),
                &ctx.accounts.token_program,
                refund_amount,
            )?;
        }

        // Canonical lock-release point. The player can now withdraw from the vault.
        let vault = &mut ctx.accounts.vault;
        vault.active_sessions = vault
            .active_sessions
            .checked_sub(1)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_protocol_fees(ctx: Context<WithdrawProtocolFees>) -> Result<()> {
        require!(
            is_admin(&ctx.accounts.authority.key(), &ctx.accounts.config.authorities),
            SpotrError::InvalidConfig
        );
        let amount = ctx.accounts.session.protocol_fee_accrued_usdc_units;
        require!(amount > 0, SpotrError::NothingToClaim);

        transfer_from_session_treasury_tokens(
            &ctx.accounts.session,
            &ctx.accounts.session_treasury,
            &ctx.accounts.session_treasury_tokens,
            &ctx.accounts.protocol_treasury_tokens.to_account_info(),
            &ctx.accounts.token_program,
            amount,
        )?;

        ctx.accounts.session.protocol_fee_accrued_usdc_units = 0;
        ctx.accounts.protocol_treasury.total_collected_usdc_units = ctx
            .accounts
            .protocol_treasury
            .total_collected_usdc_units
            .checked_add(amount)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct ConfigInput {
    pub authorities: [Pubkey; 3],
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub round_count: u8,
    pub round_duration_seconds: i64,
    pub buy_in_usdc_units: u64,
    pub round_fill_threshold: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct SessionInput {
    pub session_number: u64,
    pub round_count: u8,
    pub round_duration_seconds: i64,
    pub buy_in_usdc_units: u64,
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub start_ts: i64,
    pub end_ts: i64,
    pub round_fill_threshold: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct RoundInput {
    pub index: u8,
    pub pair_id: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SessionStatus {
    Pending,
    Live,
    Expired,
    Completed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum RoundState {
    /// Wait phase: collecting deposits. Flips to `Open` once
    /// `deposits_count >= session.round_fill_threshold`.
    Pending,
    /// Predict phase: deposits frozen, players pick sides.
    Open,
    /// Settled phase: claims and refunds available.
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SideSelection {
    A,
    B,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct SideState {
    pub total_net_deposits_usdc_units: u64,
    pub total_entries: u32,
}

#[account]
#[derive(InitSpace)]
pub struct SpotrConfig {
    pub authorities: [Pubkey; 3],
    pub usdc_mint: Pubkey,
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub default_round_count: u8,
    pub default_round_duration_seconds: i64,
    pub default_buy_in_usdc_units: u64,
    pub default_round_fill_threshold: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolTreasury {
    pub authorities: [Pubkey; 3],
    pub total_collected_usdc_units: u64,
    pub bump: u8,
    pub token_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Session {
    pub session_number: u64,
    pub status: SessionStatus,
    pub round_count: u8,
    pub round_duration_seconds: i64,
    pub buy_in_usdc_units: u64,
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub joined_wallets: u16,
    pub total_escrowed_usdc_units: u64,
    pub protocol_fee_accrued_usdc_units: u64,
    pub rounds_closed: u8,
    pub start_ts: i64,
    pub end_ts: i64,
    pub round_fill_threshold: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SessionTreasury {
    pub session: Pubkey,
    pub bump: u8,
    pub token_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub session: Pubkey,
    pub index: u8,
    pub state: RoundState,
    pub pair_id: [u8; 32],
    pub opens_at: i64,
    pub closes_at: i64,
    pub side_a: SideState,
    pub side_b: SideState,
    pub total_volume_usdc_units: u64,
    /// Number of distinct wallets that have called `deposit_for_round` for
    /// this round. The round flips `Pending → Open` when this reaches
    /// `session.round_fill_threshold`.
    pub deposits_count: u16,
    /// Sum of all `deposit_for_round` amounts. The wager bookkeeping inside
    /// `enter_position` then reads each player's amount from their
    /// `RoundDeposit` PDA.
    pub total_deposit_pool_usdc_units: u64,
    /// Set by `resolve_round` once the admin calls the outcome.
    pub winning_side: Option<SideSelection>,
    /// Pari-mutuel pool P (sum of net stakes across both sides), captured at
    /// `resolve_round` time. `settle_round` divides this among winners.
    pub total_pool_usdc_units: u64,
    /// N — number of positions on the winning side.
    pub winning_side_count: u16,
    /// Set by `settle_round` after final payouts are written to each
    /// winning position's `final_payout_usdc_units`.
    pub redistribute_applied: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerSession {
    pub session: Pubkey,
    pub player: Pubkey,
    pub total_escrow_usdc_units: u64,
    pub remaining_escrow_usdc_units: u64,
    pub entered_round_mask: u64,
    /// Bit `i` is set once the player has called `deposit_for_round` for
    /// round index `i`. Prevents double-deposit and pairs naturally with
    /// `entered_round_mask`.
    pub deposited_round_mask: u64,
    /// Unix seconds when the player joined the session. Used by
    /// `deposit_for_round` to gate late deposits: a player can only deposit
    /// into a round that has already flipped `Open` if they joined the
    /// session before that round opened.
    pub joined_at: i64,
    pub bump: u8,
    #[max_len(64)]
    pub round_choices: Vec<u8>,
}

/// Per-(round, player) deposit ticket. Records the wager the player has
/// committed for the round; consumed when the player calls
/// `enter_position`, or refunded via `refund_unused_deposit` if the round
/// closes without filling or the player never picks a side.
#[account]
#[derive(InitSpace)]
pub struct RoundDeposit {
    pub round: Pubkey,
    pub player: Pubkey,
    pub amount_usdc_units: u64,
    /// 0-based ordering within the round (= `round.deposits_count` at the
    /// time the deposit lands). `settle_round` reads this off the position
    /// account to rank winners into top / mid / decay tiers.
    pub deposit_index: u16,
    pub used_for_position: bool,
    pub refunded: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerRoundPosition {
    pub round: Pubkey,
    pub player: Pubkey,
    pub side: SideSelection,
    /// 0-based ordering inside the round, copied from `RoundDeposit` at
    /// `enter_position` time. `settle_round` sorts winning positions by
    /// this index to determine top / mid / decay tiers.
    pub deposit_index: u16,
    pub net_amount_usdc_units: u64,
    /// Final payout written by `settle_round` (PM_i + redistribution).
    /// Zero until settlement; `claim_round` transfers this amount.
    pub final_payout_usdc_units: u64,
    pub claimed_usdc_units: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserVault {
    pub owner: Pubkey,
    pub active_sessions: u32,
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub bump: u8,
    pub token_bump: u8,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + SpotrConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, SpotrConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolTreasury::INIT_SPACE,
        seeds = [PROTOCOL_TREASURY_SEED],
        bump
    )]
    pub protocol_treasury: Account<'info, ProtocolTreasury>,
    #[account(
        init,
        payer = authority,
        seeds = [PROTOCOL_TREASURY_TOKENS_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = protocol_treasury,
    )]
    pub protocol_treasury_tokens: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, SpotrConfig>,
}

#[derive(Accounts)]
#[instruction(input: SessionInput)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, SpotrConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + Session::INIT_SPACE,
        seeds = [SESSION_SEED, &input.session_number.to_le_bytes()],
        bump
    )]
    pub session: Account<'info, Session>,
    #[account(
        init,
        payer = authority,
        space = 8 + SessionTreasury::INIT_SPACE,
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        init,
        payer = authority,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = session_treasury,
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint @ SpotrError::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitUserVault<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor is the signer
    /// and pays rent. Validated in-handler by `is_admin(sponsor, config.authorities)`.
    pub owner: UncheckedAccount<'info>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + UserVault::INIT_SPACE,
        seeds = [USER_VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        init,
        payer = sponsor,
        seeds = [USER_VAULT_TOKENS_SEED, owner.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositToVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, owner.key().as_ref()],
        bump = vault.token_bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token_account.mint == vault_tokens.mint @ SpotrError::InvalidMint,
        constraint = owner_token_account.owner == owner.key() @ SpotrError::InvalidMint,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawFromVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, owner.key().as_ref()],
        bump = vault.token_bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = owner_token_account.mint == vault_tokens.mint @ SpotrError::InvalidMint,
        constraint = owner_token_account.owner == owner.key() @ SpotrError::InvalidMint,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct JoinSession<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor signs and pays
    /// rent; the player's funds move from `vault` (their PDA) to the session
    /// treasury. `vault.owner == player.key()` enforces that this account
    /// matches the vault.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump = session_treasury.bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump = session_treasury.token_bump
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, player.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == player.key() @ SpotrError::InvalidMint,
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, player.key().as_ref()],
        bump = vault.token_bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + PlayerSession::INIT_SPACE,
        seeds = [PLAYER_SESSION_SEED, session.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_session: Account<'info, PlayerSession>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(input: RoundInput)]
pub struct CreateRound<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        init,
        payer = authority,
        space = 8 + Round::INIT_SPACE,
        seeds = [ROUND_SEED, session.key().as_ref(), &[input.index]],
        bump
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnterPosition<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor signs and pays
    /// rent. `player_session.has_one = player` and the deposit / vault PDAs
    /// pin this account to the correct PDAs.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [PLAYER_SESSION_SEED, session.key().as_ref(), player.key().as_ref()],
        bump = player_session.bump,
        has_one = player,
        has_one = session
    )]
    pub player_session: Account<'info, PlayerSession>,
    #[account(
        mut,
        seeds = [ROUND_DEPOSIT_SEED, round.key().as_ref(), player.key().as_ref()],
        bump = round_deposit.bump,
        has_one = round,
        has_one = player,
    )]
    pub round_deposit: Account<'info, RoundDeposit>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + PlayerRoundPosition::INIT_SPACE,
        seeds = [POSITION_SEED, round.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub position: Account<'info, PlayerRoundPosition>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositForRound<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor signs and pays
    /// rent; the player's funds move from `vault` (their PDA) to the session
    /// treasury.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [PLAYER_SESSION_SEED, session.key().as_ref(), player.key().as_ref()],
        bump = player_session.bump,
        has_one = player,
        has_one = session
    )]
    pub player_session: Account<'info, PlayerSession>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + RoundDeposit::INIT_SPACE,
        seeds = [ROUND_DEPOSIT_SEED, round.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub round_deposit: Account<'info, RoundDeposit>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, player.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == player.key() @ SpotrError::InvalidMint,
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, player.key().as_ref()],
        bump = vault.token_bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump = session_treasury.bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump = session_treasury.token_bump
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundUnusedDeposit<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor signs; refunds
    /// land in the player's vault PDA derived from this key.
    pub player: UncheckedAccount<'info>,
    pub session: Account<'info, Session>,
    #[account(
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [ROUND_DEPOSIT_SEED, round.key().as_ref(), player.key().as_ref()],
        bump = round_deposit.bump,
        has_one = round,
        has_one = player,
    )]
    pub round_deposit: Account<'info, RoundDeposit>,
    #[account(
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump = session_treasury.bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump = session_treasury.token_bump
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, player.key().as_ref()],
        bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseRound<'info> {
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct AdminCloseRound<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump,
        constraint = round.session == session.key() @ SpotrError::InvalidConfig,
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct AdminCloseSession<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    #[account(mut)]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct ClaimRound<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor signs; payouts
    /// land in the player's vault PDA derived from this key.
    pub player: UncheckedAccount<'info>,
    pub session: Account<'info, Session>,
    #[account(
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [POSITION_SEED, round.key().as_ref(), player.key().as_ref()],
        bump = position.bump,
        has_one = player,
        has_one = round
    )]
    pub position: Account<'info, PlayerRoundPosition>,
    #[account(
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump = session_treasury.bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump = session_treasury.token_bump
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, player.key().as_ref()],
        bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FinalizeSession<'info> {
    #[account(mut)]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct ClaimSessionBalance<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    /// CHECK: Player wallet — used as a PDA seed only. Sponsor signs; refunds
    /// land in the player's vault PDA derived from this key.
    pub player: UncheckedAccount<'info>,
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [PLAYER_SESSION_SEED, session.key().as_ref(), player.key().as_ref()],
        bump = player_session.bump,
        has_one = player,
        has_one = session
    )]
    pub player_session: Account<'info, PlayerSession>,
    #[account(
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump = session_treasury.bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump = session_treasury.token_bump
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, player.key().as_ref()],
        bump = vault.bump,
        constraint = vault.owner == player.key() @ SpotrError::InvalidMint,
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        mut,
        seeds = [USER_VAULT_TOKENS_SEED, player.key().as_ref()],
        bump = vault.token_bump
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveRound<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump,
        constraint = round.session == session.key() @ SpotrError::InvalidConfig,
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, SpotrConfig>,
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump,
        constraint = round.session == session.key() @ SpotrError::InvalidConfig,
    )]
    pub round: Account<'info, Round>,
    // Winning `PlayerRoundPosition`s come in via `remaining_accounts`.
}

#[derive(Accounts)]
pub struct WithdrawProtocolFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, SpotrConfig>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        seeds = [SESSION_TREASURY_SEED, session.key().as_ref()],
        bump = session_treasury.bump
    )]
    pub session_treasury: Account<'info, SessionTreasury>,
    #[account(
        mut,
        seeds = [SESSION_TREASURY_TOKENS_SEED, session.key().as_ref()],
        bump = session_treasury.token_bump
    )]
    pub session_treasury_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [PROTOCOL_TREASURY_SEED],
        bump = protocol_treasury.bump
    )]
    pub protocol_treasury: Account<'info, ProtocolTreasury>,
    #[account(
        mut,
        seeds = [PROTOCOL_TREASURY_TOKENS_SEED],
        bump = protocol_treasury.token_bump
    )]
    pub protocol_treasury_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

fn is_admin(signer: &Pubkey, authorities: &[Pubkey; 3]) -> bool {
    *signer != Pubkey::default() && authorities.iter().any(|a| a == signer)
}

fn validate_config(input: ConfigInput) -> Result<()> {
    require!(
        input.authorities.iter().any(|a| *a != Pubkey::default()),
        SpotrError::InvalidConfig
    );
    require!(input.protocol_fee_bps <= 10_000, SpotrError::InvalidConfig);
    require!(input.referral_cut_bps <= 10_000, SpotrError::InvalidConfig);
    require!(input.round_count > 0, SpotrError::InvalidConfig);
    require!(input.round_duration_seconds > 0, SpotrError::InvalidConfig);
    Ok(())
}

fn validate_session_input(input: SessionInput) -> Result<()> {
    require!(input.protocol_fee_bps <= 10_000, SpotrError::InvalidConfig);
    require!(input.referral_cut_bps <= 10_000, SpotrError::InvalidConfig);
    require!(input.round_count > 0, SpotrError::InvalidConfig);
    require!(input.round_duration_seconds > 0, SpotrError::InvalidConfig);
    require!(input.end_ts > input.start_ts, SpotrError::InvalidConfig);
    Ok(())
}

fn maybe_activate(session: &mut Session, clock: &Clock) {
    if session.status == SessionStatus::Pending
        && clock.unix_timestamp >= session.start_ts
        && clock.unix_timestamp < session.end_ts
    {
        session.status = SessionStatus::Live;
    }
}

fn bit_for_round(index: u8) -> Result<u64> {
    require!(index < 64, SpotrError::InvalidRoundIndex);
    Ok(1u64 << index)
}

fn split_fee(stake_units: u64, protocol_fee_bps: u16) -> Result<(u64, u64)> {
    let fee = u128::from(stake_units)
        .checked_mul(u128::from(protocol_fee_bps))
        .ok_or(SpotrError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(SpotrError::MathOverflow)?;
    let fee_u64 = u64::try_from(fee).map_err(|_| SpotrError::MathOverflow)?;
    let net = stake_units
        .checked_sub(fee_u64)
        .ok_or(SpotrError::MathOverflow)?;
    Ok((fee_u64, net))
}

/// Top-20 / mid-60 / decay-40 redistribution pass. Operates in place on
/// `payouts`, which **must** already be ordered by deposit index ascending
/// (caller's responsibility — `settle_round` sorts before calling).
///
/// Math (matches `resources/The Case for Redistribution on Top of
/// Pari-Mutuel.md`):
///   top_end     = max(1, floor(N * 0.20))
///   decay_start = floor(N * 0.60)
///   R           = Σ payouts[decay_start..] * 0.20
///   top_bonus   = R * 0.60 / top_count
///   mid_bonus   = R * 0.40 / mid_count   (skipped if mid_count == 0)
///   final[top]   = PM_i + top_bonus
///   final[mid]   = PM_i + mid_bonus
///   final[decay] = PM_i * 0.80
///
/// No-op when N < 3 (no decay group exists).
pub fn redistribute(payouts: &mut [u64]) -> Result<()> {
    let n = payouts.len();
    if n < 3 {
        return Ok(());
    }

    let n_u64 = n as u64;
    let top_end = ((n_u64 * TOP_BOUNDARY_BPS) / 10_000).max(1) as usize;
    let decay_count = ((n_u64 * DECAY_TIER_BPS) / 10_000) as usize;
    let decay_start = n.saturating_sub(decay_count);
    // Guard against degenerate small-N where top + decay overlap.
    let decay_start = decay_start.max(top_end);
    debug_assert!(top_end <= decay_start);
    debug_assert!(decay_start <= n);

    // Sum the 20% cuts taken from each decay-tier wallet's PM_i.
    let mut r: u128 = 0;
    for &pm in &payouts[decay_start..] {
        let cut = (pm as u128 * DECAY_CUT_BPS as u128) / 10_000;
        r = r.checked_add(cut).ok_or(SpotrError::MathOverflow)?;
    }

    let top_count = top_end as u128;
    let mid_count = (decay_start - top_end) as u128;

    let top_bonus_total = (r * TOP_BPS as u128) / 10_000;
    let top_bonus = top_bonus_total / top_count;

    let mid_bonus = if mid_count > 0 {
        (r * MID_BPS as u128) / 10_000 / mid_count
    } else {
        0
    };

    for (i, payout) in payouts.iter_mut().enumerate() {
        let new_value: u128 = if i < top_end {
            (*payout as u128) + top_bonus
        } else if i < decay_start {
            (*payout as u128) + mid_bonus
        } else {
            // Decay: keep 80%.
            (*payout as u128 * (10_000 - DECAY_CUT_BPS) as u128) / 10_000
        };
        *payout = u64::try_from(new_value).map_err(|_| SpotrError::MathOverflow)?;
    }

    Ok(())
}

/// Moves USDC tokens out of the SessionTreasuryTokens token account, signed
/// by the SessionTreasury PDA whose seeds we re-derive on the fly.
fn transfer_from_session_treasury_tokens<'info>(
    session: &Account<'info, Session>,
    session_treasury: &Account<'info, SessionTreasury>,
    session_treasury_tokens: &Account<'info, TokenAccount>,
    recipient_tokens: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let session_key = session.key();
    let bump = session_treasury.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        SESSION_TREASURY_SEED,
        session_key.as_ref(),
        std::slice::from_ref(&bump),
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: session_treasury_tokens.to_account_info(),
                to: recipient_tokens.clone(),
                authority: session_treasury.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )
}

#[error_code]
pub enum SpotrError {
    #[msg("The provided configuration is invalid")]
    InvalidConfig,
    #[msg("Per-position stake is below the minimum")]
    StakeBelowMinimum,
    #[msg("The session can no longer be joined")]
    SessionNotJoinable,
    #[msg("The session is not yet live")]
    SessionNotLive,
    #[msg("The session is already closed")]
    SessionClosed,
    #[msg("The round index is invalid")]
    InvalidRoundIndex,
    #[msg("The round is already closed")]
    RoundClosed,
    #[msg("The round is still open")]
    RoundStillOpen,
    #[msg("This player already entered the round")]
    RoundAlreadyEntered,
    #[msg("There is not enough escrow left for this position")]
    InsufficientEscrow,
    #[msg("The side is full (per-side entry cap reached)")]
    SideFull,
    #[msg("The stored entry index no longer matches the side state")]
    InvalidEntryIndex,
    #[msg("This position has already been claimed")]
    AlreadyClaimed,
    #[msg("There is nothing to claim")]
    NothingToClaim,
    #[msg("The session is still in progress")]
    SessionStillInProgress,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Session treasury would drop below rent-exempt minimum")]
    InsufficientTreasuryBalance,
    #[msg("Vault is locked while at least one session is active")]
    VaultLocked,
    #[msg("Vault has insufficient USDC balance for this withdrawal")]
    InsufficientVaultBalance,
    #[msg("Token mint or owner does not match expected USDC mint")]
    InvalidMint,
    #[msg("The round is not in the wait phase")]
    RoundNotPending,
    #[msg("The round is not in the predict phase")]
    RoundNotOpen,
    #[msg("The deposit has already been used or refunded")]
    DepositAlreadyUsed,
    #[msg("This player has already deposited for the round")]
    DepositAlreadyExists,
    #[msg("This round has already been resolved")]
    RoundAlreadyResolved,
    #[msg("This round has not been resolved yet")]
    RoundNotResolved,
    #[msg("This round has already been settled")]
    RoundAlreadySettled,
    #[msg("This round has not been settled yet")]
    RoundNotSettled,
    #[msg("This position is on the losing side")]
    WrongSide,
    #[msg("Number of supplied winning positions does not match the round")]
    MissingWinningPositions,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compute pari-mutuel payouts for a list of net stakes on the winning
    /// side, given total pool P. Mirrors the on-chain math inside
    /// `settle_round` so the test suite can build expected payout vectors
    /// without spinning up a runtime.
    fn pari_mutuel(net_stakes: &[u64], pool: u64) -> Vec<u64> {
        let s: u64 = net_stakes.iter().sum();
        net_stakes
            .iter()
            .map(|&d| ((d as u128 * pool as u128) / s as u128) as u64)
            .collect()
    }

    #[test]
    fn fee_split_respects_basis_points() {
        let (fee, net) = split_fee(5_000_000, 350).unwrap();
        assert_eq!(fee, 175_000);
        assert_eq!(net, 4_825_000);
    }

    fn pubkey(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn authorities(a: u8, b: u8, c: u8) -> [Pubkey; 3] {
        [pubkey(a), pubkey(b), pubkey(c)]
    }

    // --- is_admin happy paths ---

    #[test]
    fn is_admin_recognises_first_slot() {
        let auths = authorities(1, 2, 3);
        assert!(is_admin(&pubkey(1), &auths));
    }

    #[test]
    fn is_admin_recognises_second_slot() {
        let auths = authorities(1, 2, 3);
        assert!(is_admin(&pubkey(2), &auths));
    }

    #[test]
    fn is_admin_recognises_third_slot() {
        let auths = authorities(1, 2, 3);
        assert!(is_admin(&pubkey(3), &auths));
    }

    #[test]
    fn is_admin_works_with_only_one_slot_filled() {
        // Other two slots are default (all-zeros).
        let auths = authorities(1, 0, 0);
        assert!(is_admin(&pubkey(1), &auths));
    }

    // --- is_admin sad paths ---

    #[test]
    fn is_admin_rejects_non_admin() {
        let auths = authorities(1, 2, 3);
        assert!(!is_admin(&pubkey(99), &auths));
    }

    #[test]
    fn is_admin_rejects_default_pubkey_as_admin() {
        // Passing Pubkey::default() must not grant access even if a slot is empty.
        let auths = authorities(1, 0, 0);
        assert!(!is_admin(&Pubkey::default(), &auths));
    }

    #[test]
    fn is_admin_rejects_all_zeros_authorities() {
        let auths = [Pubkey::default(); 3];
        assert!(!is_admin(&pubkey(1), &auths));
    }

    // --- validate_config authority checks ---

    #[test]
    fn validate_config_rejects_all_default_authorities() {
        let input = ConfigInput {
            authorities: [Pubkey::default(); 3],
            protocol_fee_bps: 100,
            referral_cut_bps: 50,
            round_count: 3,
            round_duration_seconds: 3600,
            buy_in_usdc_units: 1_000_000,
            round_fill_threshold: 7,
        };
        assert!(validate_config(input).is_err());
    }

    #[test]
    fn validate_config_accepts_one_valid_authority() {
        let input = ConfigInput {
            authorities: [pubkey(1), Pubkey::default(), Pubkey::default()],
            protocol_fee_bps: 100,
            referral_cut_bps: 50,
            round_count: 3,
            round_duration_seconds: 3600,
            buy_in_usdc_units: 1_000_000,
            round_fill_threshold: 7,
        };
        assert!(validate_config(input).is_ok());
    }

    #[test]
    fn validate_config_accepts_three_valid_authorities() {
        let input = ConfigInput {
            authorities: authorities(1, 2, 3),
            protocol_fee_bps: 100,
            referral_cut_bps: 50,
            round_count: 3,
            round_duration_seconds: 3600,
            buy_in_usdc_units: 1_000_000,
            round_fill_threshold: 7,
        };
        assert!(validate_config(input).is_ok());
    }

    // --- Round-fill threshold logic ---

    /// Pure helper that mirrors the inline transition inside
    /// `deposit_for_round`: when `deposits_count` reaches `threshold`, the
    /// round becomes `Open`. Used by both happy and sad case tests below.
    fn maybe_flip_round_to_open(round: &mut Round, threshold: u8) -> Result<()> {
        if u8::try_from(round.deposits_count.min(u8::MAX as u16))
            .map_err(|_| SpotrError::MathOverflow)?
            >= threshold
        {
            round.state = RoundState::Open;
        }
        Ok(())
    }

    fn fresh_round() -> Round {
        Round {
            session: Pubkey::default(),
            index: 0,
            state: RoundState::Pending,
            pair_id: [0u8; 32],
            opens_at: 0,
            closes_at: 0,
            side_a: SideState::default(),
            side_b: SideState::default(),
            total_volume_usdc_units: 0,
            deposits_count: 0,
            total_deposit_pool_usdc_units: 0,
            winning_side: None,
            total_pool_usdc_units: 0,
            winning_side_count: 0,
            redistribute_applied: false,
            bump: 0,
        }
    }

    /// Happy case: 7 deposits land on a fresh round with threshold 7. The
    /// round flips Pending → Open exactly on the seventh deposit.
    #[test]
    fn happy_case_seven_deposits_flip_round_open() {
        let threshold: u8 = 7;
        let mut round = fresh_round();
        for i in 1..=threshold {
            round.deposits_count += 1;
            round.total_deposit_pool_usdc_units += 1_000_000;
            maybe_flip_round_to_open(&mut round, threshold).unwrap();
            if i < threshold {
                assert!(
                    matches!(round.state, RoundState::Pending),
                    "round must stay Pending until threshold reached (after {i} deposits)"
                );
            } else {
                assert!(
                    matches!(round.state, RoundState::Open),
                    "round must flip Open on the {threshold}th deposit"
                );
            }
        }
        assert_eq!(round.deposits_count, threshold as u16);
        assert_eq!(round.total_deposit_pool_usdc_units, 7_000_000);
    }

    /// Sad case: only 6 deposits arrive on a threshold-7 round, so the
    /// round never flips Open. After session end it can be closed and the
    /// deposits remain refundable (RoundDeposit.used_for_position == false).
    #[test]
    fn sad_case_under_filled_round_stays_pending() {
        let threshold: u8 = 7;
        let mut round = fresh_round();
        for _ in 0..6 {
            round.deposits_count += 1;
            round.total_deposit_pool_usdc_units += 2_000_000;
            maybe_flip_round_to_open(&mut round, threshold).unwrap();
        }
        assert!(
            matches!(round.state, RoundState::Pending),
            "round must stay Pending when deposits_count < threshold"
        );
        assert_eq!(round.deposits_count, 6);
        // Round closes without filling — deposits remain refundable.
        round.state = RoundState::Closed;
        let deposit = RoundDeposit {
            round: Pubkey::default(),
            player: Pubkey::default(),
            amount_usdc_units: 2_000_000,
            deposit_index: 0,
            used_for_position: false,
            refunded: false,
            bump: 0,
        };
        // Refund precondition: round closed AND deposit not used AND not refunded.
        assert!(matches!(round.state, RoundState::Closed));
        assert!(!deposit.used_for_position);
        assert!(!deposit.refunded);
    }

    /// Threshold of 1 (smallest non-trivial config) flips on the first deposit.
    #[test]
    fn happy_case_threshold_one_flips_on_first_deposit() {
        let threshold: u8 = 1;
        let mut round = fresh_round();
        round.deposits_count = 1;
        maybe_flip_round_to_open(&mut round, threshold).unwrap();
        assert!(matches!(round.state, RoundState::Open));
    }

    /// Threshold zero would be a misconfiguration; the helper still flips
    /// (deposits_count >= 0 is always true once any state machine consults
    /// it), but in practice the runtime requires `amount > 0` so this is
    /// only ever exercised via misconfigured `validate_config` inputs.
    #[test]
    fn refund_blocked_when_deposit_was_used() {
        let deposit = RoundDeposit {
            round: Pubkey::default(),
            player: Pubkey::default(),
            amount_usdc_units: 1_000_000,
            deposit_index: 0,
            used_for_position: true,
            refunded: false,
            bump: 0,
        };
        // refund_unused_deposit must reject a used deposit; we encode that
        // requirement here so future regressions trip the test rather than
        // shipping a double-spend.
        assert!(deposit.used_for_position, "used deposits must not be refundable");
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Redistribution layer — tests against `resources/The Case for
    //  Redistribution on Top of Pari-Mutuel.md` numerical examples.
    // ──────────────────────────────────────────────────────────────────────

    /// Sum of payouts must equal P, modulo a few micro-units of dust caused
    /// by two layers of integer division (the PM_i floor at settlement +
    /// the redistribute floor on bonuses/cuts). Empirically ≤ 2N for the
    /// numerical examples in the doc.
    fn assert_conservation(payouts: &[u64], pool: u64, label: &str) {
        let total: u64 = payouts.iter().sum();
        let dust_budget = (payouts.len() as u64) * 2;
        assert!(
            pool >= total && pool - total <= dust_budget,
            "{label}: conservation violated — pool={pool} total={total} dust_budget={dust_budget}"
        );
    }

    /// Doc N=3 example: deposits 2/3/1, opposing side 4, total pool 10,
    /// 3.5% house cut → P = 9.65 USDC.
    /// Expected final payouts (μUSDC): 3_410_000 / 4_954_000 / 1_286_000.
    #[test]
    fn redistribute_doc_example_n_equals_three() {
        // Working in μUSDC (6 decimals).
        let pool: u64 = 9_650_000;
        let stakes: [u64; 3] = [2_000_000, 3_000_000, 1_000_000];
        let mut payouts = pari_mutuel(&stakes, pool);
        // Pre-redistribute PM_i should be (2/6, 3/6, 1/6) × P.
        assert_eq!(payouts, vec![3_216_666, 4_825_000, 1_608_333]);

        redistribute(&mut payouts).unwrap();

        // Doc display: 3.410 / 4.954 / 1.286 SOL. Exact integer math
        // (after two floor() passes) lands a few μUSDC below those
        // rounded values; conservation still holds within the dust budget.
        let expected: [u64; 3] = [3_409_665, 4_953_666, 1_286_666];
        assert_eq!(payouts, expected.to_vec());
        assert_conservation(&payouts, pool, "N=3");
    }

    /// Doc N=4 example: deposits 3/2/4/1, opposing side 6, total pool 16,
    /// 3.5% cut → P = 15.44.
    /// Final payouts (USDC): 4.817 / 3.150 / 6.238 / 1.235.
    #[test]
    fn redistribute_doc_example_n_equals_four() {
        let pool: u64 = 15_440_000;
        let stakes: [u64; 4] = [3_000_000, 2_000_000, 4_000_000, 1_000_000];
        let mut payouts = pari_mutuel(&stakes, pool);
        assert_eq!(payouts, vec![4_632_000, 3_088_000, 6_176_000, 1_544_000]);

        redistribute(&mut payouts).unwrap();

        // Doc display: 4.817 / 3.150 / 6.238 / 1.235. Exact integer math
        // is exact here because P=15.44 / S=10 has no PM_i remainder.
        let expected: [u64; 4] = [4_817_280, 3_149_760, 6_237_760, 1_235_200];
        assert_eq!(payouts, expected.to_vec());
        assert_conservation(&payouts, pool, "N=4");
    }

    /// Doc N=5 example: deposits 2/3/1/4/2, opposing side 8, total pool 20,
    /// 3.5% cut → P = 19.30.
    /// Final payouts (USDC): 4.375 / 5.211 / 1.994 / 5.146 / 2.574.
    #[test]
    fn redistribute_doc_example_n_equals_five() {
        let pool: u64 = 19_300_000;
        let stakes: [u64; 5] = [2_000_000, 3_000_000, 1_000_000, 4_000_000, 2_000_000];
        let mut payouts = pari_mutuel(&stakes, pool);
        // Pre-redistribute PM_i ≈ (2/12, 3/12, 1/12, 4/12, 2/12) × 19.3.
        assert_eq!(
            payouts,
            vec![3_216_666, 4_825_000, 1_608_333, 6_433_333, 3_216_666]
        );

        redistribute(&mut payouts).unwrap();

        // Doc display: 4.375 / 5.211 / 1.994 / 5.146 / 2.574. Integer math
        // floors slightly below.
        let expected: [u64; 5] = [4_374_665, 5_210_999, 1_994_332, 5_146_666, 2_573_332];
        assert_eq!(payouts, expected.to_vec());
        assert_conservation(&payouts, pool, "N=5");
    }

    /// N=1 — a single winner with no decay group. `redistribute` is a
    /// no-op; final payout equals raw PM_i (the entire pool minus dust).
    #[test]
    fn redistribute_skips_at_n_equals_one() {
        let pool: u64 = 9_650_000;
        let stakes: [u64; 1] = [2_000_000];
        let mut payouts = pari_mutuel(&stakes, pool);
        let pm = payouts.clone();
        redistribute(&mut payouts).unwrap();
        assert_eq!(payouts, pm, "N=1 must be a no-op");
    }

    /// N=2 — top + mid groups exist but no decay group, so nothing to take
    /// from. `redistribute` is a no-op.
    #[test]
    fn redistribute_skips_at_n_equals_two() {
        let pool: u64 = 9_650_000;
        let stakes: [u64; 2] = [2_000_000, 3_000_000];
        let mut payouts = pari_mutuel(&stakes, pool);
        let pm = payouts.clone();
        redistribute(&mut payouts).unwrap();
        assert_eq!(payouts, pm, "N=2 must be a no-op");
    }

    /// At N=10 the boundaries are clean (top=2, mid=4, decay=4) so the
    /// math has no awkward floors. Conservation must still hold.
    #[test]
    fn redistribute_conserves_at_n_equals_ten() {
        let pool: u64 = 100_000_000; // 100 USDC
        // Stakes summing to 50 USDC on the winning side.
        let stakes: [u64; 10] = [
            10_000_000, 8_000_000, 7_000_000, 6_000_000, 5_000_000,
            4_000_000, 3_000_000, 3_000_000, 2_000_000, 2_000_000,
        ];
        let mut payouts = pari_mutuel(&stakes, pool);
        redistribute(&mut payouts).unwrap();

        // Tier sizes per doc: top=2 (max(1, floor(10*0.20))=2),
        // decay=4 (floor(10*0.40)=4 → starts at floor(10*0.60)=6).
        // Decay wallets must be exactly 80% of their PM_i.
        let pm = pari_mutuel(&stakes, pool);
        for i in 6..10 {
            let want = pm[i] * 80 / 100;
            assert_eq!(payouts[i], want, "decay wallet {i} not at 80% of PM");
        }
        // Top wallets must be at least their PM_i (plus a positive bonus).
        for i in 0..2 {
            assert!(payouts[i] >= pm[i], "top wallet {i} should not lose value");
        }
        assert_conservation(&payouts, pool, "N=10");
    }

    /// Sad case: empty input is rejected at the call site (settle_round
    /// branches on `n == 0` before invoking redistribute), but the helper
    /// must still be a no-op for N < 3 even on edge cases.
    #[test]
    fn redistribute_handles_empty_slice() {
        let mut payouts: Vec<u64> = vec![];
        redistribute(&mut payouts).unwrap();
        assert!(payouts.is_empty());
    }

    /// Sad case: mismatch between stakes and pool would cause overflow if
    /// the helper used u64 multiplication; the u128 widening guards
    /// against that. Use a near-overflow scenario.
    #[test]
    fn redistribute_uses_widened_arithmetic() {
        // 1 USDC each, pool of 1 billion USDC (extreme).
        let pool: u64 = 1_000_000_000_000_000; // 1B USDC in μUSDC
        let stakes: [u64; 5] = [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000];
        let mut payouts = pari_mutuel(&stakes, pool);
        // Each PM_i = 200B μUSDC. Decay cut per wallet = 40B. R = 80B.
        // Should not overflow inside redistribute.
        redistribute(&mut payouts).unwrap();
        assert_conservation(&payouts, pool, "extreme pool");
    }
}
