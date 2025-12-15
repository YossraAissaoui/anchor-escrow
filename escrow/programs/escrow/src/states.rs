use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub initializer: Pubkey,
    pub token_a: Pubkey,
    pub amount_token_a: u64,
    pub token_b: Pubkey,
    pub amount_token_b: u64,

    #[max_len(150)]
    pub id: String,

    // Bumps
    pub bump_escrow: u8,
    pub bump_guaranty_account: u8,
}