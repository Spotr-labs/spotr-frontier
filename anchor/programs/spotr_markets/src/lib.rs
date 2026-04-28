use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("9kiyw78JeJ2yK5G2dxWPczEM1JmiyD3orvdhzrKzfsgk");

const CONFIG_SEED: &[u8] = b"config";
const PROTOCOL_TREASURY_SEED: &[u8] = b"protocol-treasury";
const PROTOCOL_TREASURY_TOKENS_SEED: &[u8] = b"protocol-treasury-tokens";
const SESSION_SEED: &[u8] = b"session";
const SESSION_TREASURY_SEED: &[u8] = b"session-treasury";
const SESSION_TREASURY_TOKENS_SEED: &[u8] = b"session-treasury-tokens";
const ROUND_SEED: &[u8] = b"round";
const PLAYER_SESSION_SEED: &[u8] = b"player-session";
const POSITION_SEED: &[u8] = b"position";
const USER_VAULT_SEED: &[u8] = b"user-vault";
const USER_VAULT_TOKENS_SEED: &[u8] = b"user-vault-tokens";

/// PRD §3.6.6 nominally mandates 200 entries per side. The serialized
/// `Round` account with 200 entries per side exceeds the 10 240-byte inner
/// instruction realloc limit that `#[account(init)]` hits under Anchor 0.32,
/// so the production bound is currently 80/side (≈ 9 KB total). Raising the
/// cap back to 200 requires either a zero-copy layout or per-side PDAs; both
/// are larger refactors and neither belongs in the same pass as the lazy-
/// settlement claim math.
pub const MAX_SIDE_ENTRIES: u32 = 80;

/// PRD §3.7 — minimum per-position stake is 1 USDC (1_000_000 micro-USDC).
pub const MIN_POSITION_USDC_UNITS: u64 = 1_000_000;

/// PRD §3.3 — session ignites when either threshold is met.
pub const DEFAULT_MIN_WALLETS: u16 = 35;
pub const DEFAULT_MIN_TOTAL_USDC_UNITS: u64 = 3_500_000_000;

#[program]
pub mod spotr_markets {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        input: ConfigInput,
    ) -> Result<()> {
        validate_config(input)?;

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.protocol_fee_bps = input.protocol_fee_bps;
        config.referral_cut_bps = input.referral_cut_bps;
        config.default_round_count = input.round_count;
        config.default_round_duration_seconds = input.round_duration_seconds;
        config.default_buy_in_usdc_units = input.buy_in_usdc_units;
        config.default_round_stake_usdc_units = input.round_stake_usdc_units;
        config.bump = ctx.bumps.config;

        let treasury = &mut ctx.accounts.protocol_treasury;
        treasury.authority = ctx.accounts.authority.key();
        treasury.total_collected_usdc_units = 0;
        treasury.bump = ctx.bumps.protocol_treasury;
        treasury.token_bump = ctx.bumps.protocol_treasury_tokens;

        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, input: ConfigInput) -> Result<()> {
        validate_config(input)?;

        let config = &mut ctx.accounts.config;
        config.protocol_fee_bps = input.protocol_fee_bps;
        config.referral_cut_bps = input.referral_cut_bps;
        config.default_round_count = input.round_count;
        config.default_round_duration_seconds = input.round_duration_seconds;
        config.default_buy_in_usdc_units = input.buy_in_usdc_units;
        config.default_round_stake_usdc_units = input.round_stake_usdc_units;

        Ok(())
    }

    pub fn create_session(
        ctx: Context<CreateSession>,
        input: SessionInput,
    ) -> Result<()> {
        validate_session_input(input)?;

        let session = &mut ctx.accounts.session;
        session.authority = ctx.accounts.authority.key();
        session.session_number = input.session_number;
        session.status = SessionStatus::Pending;
        session.round_count = input.round_count;
        session.round_duration_seconds = input.round_duration_seconds;
        session.buy_in_usdc_units = input.buy_in_usdc_units;
        session.round_stake_usdc_units = input.round_stake_usdc_units;
        session.protocol_fee_bps = input.protocol_fee_bps;
        session.referral_cut_bps = input.referral_cut_bps;
        session.min_wallets = input.min_wallets;
        session.min_total_usdc_units = input.min_total_usdc_units;
        session.joined_wallets = 0;
        session.total_escrowed_usdc_units = 0;
        session.protocol_fee_accrued_usdc_units = 0;
        session.rounds_closed = 0;
        session.start_ts = input.start_ts;
        session.end_ts = input.end_ts;
        session.bump = ctx.bumps.session;

        let treasury = &mut ctx.accounts.session_treasury;
        treasury.session = session.key();
        treasury.bump = ctx.bumps.session_treasury;
        treasury.token_bump = ctx.bumps.session_treasury_tokens;

        Ok(())
    }

    pub fn init_user_vault(ctx: Context<InitUserVault>) -> Result<()> {
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
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        require!(
            matches!(session.status, SessionStatus::Pending | SessionStatus::Live),
            SpotrError::SessionNotJoinable
        );
        require!(clock.unix_timestamp <= session.end_ts, SpotrError::SessionClosed);

        let buy_in = session.buy_in_usdc_units;

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

        let player_session = &mut ctx.accounts.player_session;
        player_session.session = session.key();
        player_session.player = ctx.accounts.player.key();
        player_session.total_escrow_usdc_units = buy_in;
        player_session.remaining_escrow_usdc_units = buy_in;
        player_session.entered_round_mask = 0;
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

        if session.joined_wallets >= session.min_wallets
            || session.total_escrowed_usdc_units >= session.min_total_usdc_units
        {
            session.status = SessionStatus::Live;
        }

        let vault = &mut ctx.accounts.vault;
        vault.active_sessions = vault
            .active_sessions
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }

    pub fn create_round(ctx: Context<CreateRound>, input: RoundInput) -> Result<()> {
        let clock = Clock::get()?;
        let session = &ctx.accounts.session;
        require!(session.status == SessionStatus::Live, SpotrError::SessionNotLive);
        require!(input.index < session.round_count, SpotrError::InvalidRoundIndex);

        let round = &mut ctx.accounts.round;
        round.session = session.key();
        round.index = input.index;
        round.state = RoundState::Open;
        round.pair_id = input.pair_id;
        round.opens_at = clock.unix_timestamp.max(session.start_ts);
        round.closes_at = round
            .opens_at
            .checked_add(session.round_duration_seconds)
            .ok_or(SpotrError::MathOverflow)?;
        round.side_a = SideState::default();
        round.side_b = SideState::default();
        round.total_volume_usdc_units = 0;
        round.bump = ctx.bumps.round;

        Ok(())
    }

    pub fn enter_position(ctx: Context<EnterPosition>, side: SideSelection) -> Result<()> {
        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        let round = &mut ctx.accounts.round;
        let player_session = &mut ctx.accounts.player_session;

        require!(session.status == SessionStatus::Live, SpotrError::SessionNotLive);
        require!(round.state == RoundState::Open, SpotrError::RoundClosed);
        require!(clock.unix_timestamp < round.closes_at, SpotrError::RoundClosed);
        require!(
            session.round_stake_usdc_units >= MIN_POSITION_USDC_UNITS,
            SpotrError::StakeBelowMinimum
        );

        let round_bit = bit_for_round(round.index)?;
        require!(
            player_session.entered_round_mask & round_bit == 0,
            SpotrError::RoundAlreadyEntered
        );
        require!(
            player_session.remaining_escrow_usdc_units >= session.round_stake_usdc_units,
            SpotrError::InsufficientEscrow
        );

        let (fee_units, net_units) =
            split_fee(session.round_stake_usdc_units, session.protocol_fee_bps)?;
        require!(net_units > 0, SpotrError::StakeBelowMinimum);

        let side_state = match side {
            SideSelection::A => &mut round.side_a,
            SideSelection::B => &mut round.side_b,
        };

        require!(
            side_state.entries.len() < MAX_SIDE_ENTRIES as usize,
            SpotrError::SideFull
        );

        let cum_prior_units = side_state.total_net_deposits_usdc_units;
        let distributed_from_j = if cum_prior_units == 0 {
            0u64
        } else {
            distribute_incoming(&side_state.entries, net_units, cum_prior_units)?
        };
        debug_assert!(distributed_from_j <= net_units);

        let entry_index = side_state.entries.len() as u32;
        side_state.entries.push(DepositEntry {
            wallet: ctx.accounts.player.key(),
            net_amount: net_units,
            cum_prior_usdc_units: cum_prior_units,
            timestamp: clock.unix_timestamp,
        });
        side_state.total_net_deposits_usdc_units = side_state
            .total_net_deposits_usdc_units
            .checked_add(net_units)
            .ok_or(SpotrError::MathOverflow)?;
        side_state.total_entries = side_state
            .total_entries
            .checked_add(1)
            .ok_or(SpotrError::MathOverflow)?;
        side_state.total_entitled_usdc_units = side_state
            .total_entitled_usdc_units
            .checked_add(distributed_from_j)
            .ok_or(SpotrError::MathOverflow)?;

        player_session.remaining_escrow_usdc_units = player_session
            .remaining_escrow_usdc_units
            .checked_sub(session.round_stake_usdc_units)
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
            .checked_add(session.round_stake_usdc_units)
            .ok_or(SpotrError::MathOverflow)?;

        let position = &mut ctx.accounts.position;
        position.round = round.key();
        position.player = ctx.accounts.player.key();
        position.side = side;
        position.entry_index = entry_index;
        position.net_amount_usdc_units = net_units;
        position.claimed_usdc_units = 0;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        Ok(())
    }

    /// PRD §3.6.5 — permissionless, idempotent. Anyone can close an expired round.
    pub fn close_round(ctx: Context<CloseRound>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        let session = &mut ctx.accounts.session;

        if round.state == RoundState::Closed {
            return Ok(());
        }

        require!(
            clock.unix_timestamp >= round.closes_at,
            SpotrError::RoundStillOpen
        );
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

    pub fn claim_round(ctx: Context<ClaimRound>) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(round.state == RoundState::Closed, SpotrError::RoundStillOpen);

        let position = &ctx.accounts.position;
        require!(!position.claimed, SpotrError::AlreadyClaimed);

        let side_state = match position.side {
            SideSelection::A => &round.side_a,
            SideSelection::B => &round.side_b,
        };
        require!(
            (position.entry_index as usize) < side_state.entries.len(),
            SpotrError::InvalidEntryIndex
        );
        let entry = &side_state.entries[position.entry_index as usize];
        require!(
            entry.wallet == ctx.accounts.player.key(),
            SpotrError::InvalidEntryIndex
        );
        require!(
            entry.net_amount == position.net_amount_usdc_units,
            SpotrError::InvalidEntryIndex
        );

        let pending_u64 = compute_lazy_entitlement(
            &side_state.entries,
            position.entry_index as usize,
        )?;

        let position_mut = &mut ctx.accounts.position;
        position_mut.claimed_usdc_units = pending_u64;
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

    /// PRD §3.6.5 — sweep the first-depositor residual and any rounding dust
    /// back to the protocol treasury once the round is closed.
    pub fn sweep_orphans(ctx: Context<SweepOrphans>) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(round.state == RoundState::Closed, SpotrError::RoundStillOpen);

        let mut total_orphan: u64 = 0;
        if !round.side_a.orphans_swept {
            let orphan = round
                .side_a
                .total_net_deposits_usdc_units
                .checked_sub(round.side_a.total_entitled_usdc_units)
                .ok_or(SpotrError::MathOverflow)?;
            round.side_a.orphans_swept = true;
            total_orphan = total_orphan
                .checked_add(orphan)
                .ok_or(SpotrError::MathOverflow)?;
        }
        if !round.side_b.orphans_swept {
            let orphan = round
                .side_b
                .total_net_deposits_usdc_units
                .checked_sub(round.side_b.total_entitled_usdc_units)
                .ok_or(SpotrError::MathOverflow)?;
            round.side_b.orphans_swept = true;
            total_orphan = total_orphan
                .checked_add(orphan)
                .ok_or(SpotrError::MathOverflow)?;
        }

        if total_orphan == 0 {
            return Ok(());
        }

        transfer_from_session_treasury_tokens(
            &ctx.accounts.session,
            &ctx.accounts.session_treasury,
            &ctx.accounts.session_treasury_tokens,
            &ctx.accounts.protocol_treasury_tokens.to_account_info(),
            &ctx.accounts.token_program,
            total_orphan,
        )?;

        ctx.accounts.protocol_treasury.total_collected_usdc_units = ctx
            .accounts
            .protocol_treasury
            .total_collected_usdc_units
            .checked_add(total_orphan)
            .ok_or(SpotrError::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_protocol_fees(ctx: Context<WithdrawProtocolFees>) -> Result<()> {
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
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub round_count: u8,
    pub round_duration_seconds: i64,
    pub buy_in_usdc_units: u64,
    pub round_stake_usdc_units: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct SessionInput {
    pub session_number: u64,
    pub round_count: u8,
    pub round_duration_seconds: i64,
    pub buy_in_usdc_units: u64,
    pub round_stake_usdc_units: u64,
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub min_wallets: u16,
    pub min_total_usdc_units: u64,
    pub start_ts: i64,
    pub end_ts: i64,
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
    Open,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SideSelection {
    A,
    B,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct DepositEntry {
    pub wallet: Pubkey,
    pub net_amount: u64,
    pub cum_prior_usdc_units: u64,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace)]
pub struct SideState {
    pub total_net_deposits_usdc_units: u64,
    pub total_entitled_usdc_units: u64,
    pub total_entries: u32,
    pub orphans_swept: bool,
    #[max_len(80)]
    pub entries: Vec<DepositEntry>,
}

#[account]
#[derive(InitSpace)]
pub struct SpotrConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub default_round_count: u8,
    pub default_round_duration_seconds: i64,
    pub default_buy_in_usdc_units: u64,
    pub default_round_stake_usdc_units: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolTreasury {
    pub authority: Pubkey,
    pub total_collected_usdc_units: u64,
    pub bump: u8,
    pub token_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Session {
    pub authority: Pubkey,
    pub session_number: u64,
    pub status: SessionStatus,
    pub round_count: u8,
    pub round_duration_seconds: i64,
    pub buy_in_usdc_units: u64,
    pub round_stake_usdc_units: u64,
    pub protocol_fee_bps: u16,
    pub referral_cut_bps: u16,
    pub min_wallets: u16,
    pub min_total_usdc_units: u64,
    pub joined_wallets: u16,
    pub total_escrowed_usdc_units: u64,
    pub protocol_fee_accrued_usdc_units: u64,
    pub rounds_closed: u8,
    pub start_ts: i64,
    pub end_ts: i64,
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
    pub bump: u8,
    #[max_len(64)]
    pub round_choices: Vec<u8>,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerRoundPosition {
    pub round: Pubkey,
    pub player: Pubkey,
    pub side: SideSelection,
    pub entry_index: u32,
    pub net_amount_usdc_units: u64,
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
        has_one = authority
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
        has_one = authority
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
    pub owner: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, SpotrConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + UserVault::INIT_SPACE,
        seeds = [USER_VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, UserVault>,
    #[account(
        init,
        payer = owner,
        seeds = [USER_VAULT_TOKENS_SEED, owner.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint @ SpotrError::InvalidMint)]
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
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, SpotrConfig>,
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
        constraint = owner_token_account.mint == config.usdc_mint @ SpotrError::InvalidMint,
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
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, SpotrConfig>,
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
        constraint = owner_token_account.mint == config.usdc_mint @ SpotrError::InvalidMint,
        constraint = owner_token_account.owner == owner.key() @ SpotrError::InvalidMint,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct JoinSession<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
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
        payer = player,
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
    #[account(mut, has_one = authority)]
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
    pub player: Signer<'info>,
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
        payer = player,
        space = 8 + PlayerRoundPosition::INIT_SPACE,
        seeds = [POSITION_SEED, round.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub position: Account<'info, PlayerRoundPosition>,
    pub system_program: Program<'info, System>,
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
pub struct ClaimRound<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
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
    pub player: Signer<'info>,
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
pub struct SweepOrphans<'info> {
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        mut,
        seeds = [ROUND_SEED, session.key().as_ref(), &[round.index]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
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

#[derive(Accounts)]
pub struct WithdrawProtocolFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, SpotrConfig>,
    #[account(mut, has_one = authority)]
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

fn validate_config(input: ConfigInput) -> Result<()> {
    require!(input.protocol_fee_bps <= 10_000, SpotrError::InvalidConfig);
    require!(input.referral_cut_bps <= 10_000, SpotrError::InvalidConfig);
    require!(input.round_count > 0, SpotrError::InvalidConfig);
    require!(input.round_duration_seconds > 0, SpotrError::InvalidConfig);
    require!(input.buy_in_usdc_units > 0, SpotrError::InvalidConfig);
    require!(input.round_stake_usdc_units > 0, SpotrError::InvalidConfig);
    require!(
        input.round_stake_usdc_units >= MIN_POSITION_USDC_UNITS,
        SpotrError::StakeBelowMinimum
    );
    require!(
        input.round_stake_usdc_units <= input.buy_in_usdc_units,
        SpotrError::InvalidConfig
    );
    Ok(())
}

fn validate_session_input(input: SessionInput) -> Result<()> {
    validate_config(ConfigInput {
        protocol_fee_bps: input.protocol_fee_bps,
        referral_cut_bps: input.referral_cut_bps,
        round_count: input.round_count,
        round_duration_seconds: input.round_duration_seconds,
        buy_in_usdc_units: input.buy_in_usdc_units,
        round_stake_usdc_units: input.round_stake_usdc_units,
    })?;
    require!(input.min_wallets > 0, SpotrError::InvalidConfig);
    require!(input.end_ts > input.start_ts, SpotrError::InvalidConfig);
    Ok(())
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

/// Sum over i<j of floor(d_i * d_j / cum_prior_j). Runs at enter-time to
/// incrementally maintain `side.total_entitled_usdc_units` so `sweep_orphans`
/// can compute residuals in O(1).
fn distribute_incoming(
    existing: &[DepositEntry],
    incoming_net: u64,
    cum_prior_units: u64,
) -> Result<u64> {
    require!(cum_prior_units > 0, SpotrError::MathOverflow);
    let cum = u128::from(cum_prior_units);
    let d_j = u128::from(incoming_net);
    let mut total: u128 = 0;
    for entry in existing {
        let share = u128::from(entry.net_amount)
            .checked_mul(d_j)
            .ok_or(SpotrError::MathOverflow)?
            .checked_div(cum)
            .ok_or(SpotrError::MathOverflow)?;
        total = total.checked_add(share).ok_or(SpotrError::MathOverflow)?;
    }
    u64::try_from(total).map_err(|_| SpotrError::MathOverflow.into())
}

/// PRD §3.6.3 — depositor i earns Σ_{j>i} floor(d_i * d_j / cum_prior_j).
fn compute_lazy_entitlement(entries: &[DepositEntry], index: usize) -> Result<u64> {
    require!(index < entries.len(), SpotrError::InvalidEntryIndex);
    let d_i = u128::from(entries[index].net_amount);
    let mut total: u128 = 0;
    for j in (index + 1)..entries.len() {
        let cum_prior = u128::from(entries[j].cum_prior_usdc_units);
        require!(cum_prior > 0, SpotrError::MathOverflow);
        let d_j = u128::from(entries[j].net_amount);
        let share = d_i
            .checked_mul(d_j)
            .ok_or(SpotrError::MathOverflow)?
            .checked_div(cum_prior)
            .ok_or(SpotrError::MathOverflow)?;
        total = total.checked_add(share).ok_or(SpotrError::MathOverflow)?;
    }
    u64::try_from(total).map_err(|_| SpotrError::MathOverflow.into())
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(wallet_byte: u8, net: u64, cum_prior: u64) -> DepositEntry {
        DepositEntry {
            wallet: Pubkey::new_from_array([wallet_byte; 32]),
            net_amount: net,
            cum_prior_usdc_units: cum_prior,
            timestamp: 0,
        }
    }

    #[test]
    fn fee_split_respects_basis_points() {
        let (fee, net) = split_fee(5_000_000, 350).unwrap();
        assert_eq!(fee, 175_000);
        assert_eq!(net, 4_825_000);
    }

    /// PRD §3.6 worked example: three depositors of 1 unit each, no fee.
    /// Expected payouts: 1.5 / 0.5 / 0 units, orphan 1 unit.
    /// (Math is unitless — same shape works for SOL or USDC.)
    #[test]
    fn prd_worked_example_three_equal_deposits() {
        const ONE_UNIT: u64 = 1_000_000_000;
        let entries = vec![
            entry(1, ONE_UNIT, 0),
            entry(2, ONE_UNIT, ONE_UNIT),
            entry(3, ONE_UNIT, 2 * ONE_UNIT),
        ];

        let d0 = compute_lazy_entitlement(&entries, 0).unwrap();
        let d1 = compute_lazy_entitlement(&entries, 1).unwrap();
        let d2 = compute_lazy_entitlement(&entries, 2).unwrap();

        assert_eq!(d0, 1_500_000_000);
        assert_eq!(d1, 500_000_000);
        assert_eq!(d2, 0);

        let mut total_entitled: u64 = 0;
        total_entitled += distribute_incoming(&[], ONE_UNIT, 0).unwrap_or(0);
        total_entitled += distribute_incoming(
            &entries[..1],
            ONE_UNIT,
            ONE_UNIT,
        )
        .unwrap();
        total_entitled += distribute_incoming(
            &entries[..2],
            ONE_UNIT,
            2 * ONE_UNIT,
        )
        .unwrap();

        let total_net = 3 * ONE_UNIT;
        let orphan = total_net - total_entitled;
        assert_eq!(total_entitled, d0 + d1 + d2);
        assert_eq!(orphan, ONE_UNIT, "first depositor's stake is orphaned");
    }

    /// Asymmetric deposits: later whale pays earlier small fish proportionally.
    #[test]
    fn unequal_deposits_distribute_proportionally() {
        let entries = vec![
            entry(1, 1_000_000, 0),
            entry(2, 3_000_000, 1_000_000),
            entry(3, 4_000_000, 4_000_000),
        ];

        let d0 = compute_lazy_entitlement(&entries, 0).unwrap();
        let d1 = compute_lazy_entitlement(&entries, 1).unwrap();
        let d2 = compute_lazy_entitlement(&entries, 2).unwrap();

        // d0 receives: 1*3/1 (from d1) + 1*4/4 (from d2) = 3_000_000 + 1_000_000
        assert_eq!(d0, 4_000_000);
        // d1 receives: 3*4/4 = 3_000_000
        assert_eq!(d1, 3_000_000);
        assert_eq!(d2, 0);

        let total_net: u64 = 1_000_000 + 3_000_000 + 4_000_000;
        let total_claimed = d0 + d1 + d2;
        assert!(total_claimed <= total_net);
        assert_eq!(total_net - total_claimed, 1_000_000);
    }

    #[test]
    fn rounding_dust_rolls_into_orphans() {
        let entries = vec![
            entry(1, 1_000_000, 0),
            entry(2, 1_000_000, 1_000_000),
            entry(3, 1, 2_000_000),
        ];

        let d0 = compute_lazy_entitlement(&entries, 0).unwrap();
        let d1 = compute_lazy_entitlement(&entries, 1).unwrap();

        assert_eq!(d0, 1_000_000);
        assert_eq!(d1, 0);

        let total_net: u64 = 2_000_001;
        let total_claimed = d0 + d1;
        let expected_orphan = total_net - total_claimed;
        assert_eq!(expected_orphan, 1_000_001);
    }

    #[test]
    fn first_depositor_entitlement_uses_zero_cum_prior_safely() {
        let entries = vec![entry(1, 123_456, 0)];
        assert_eq!(compute_lazy_entitlement(&entries, 0).unwrap(), 0);
    }
}
