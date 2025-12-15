use anchor_lang::prelude::*;
use anchor_spl::token::*;
pub mod states;
pub use states::*;


declare_id!("CLk4YWw1gUDxPHDUdFsypMjBcvXQiT6sxqVjrkkapN1R");

#[program]
pub mod escrow {
    use super::*;

//---------------------- INITIALIZING THE ESCROW ----------------------//
    pub fn initialize(
        ctx: Context<Initialize>, 
        id: String, 
        amount_token_a: u64, 
        amount_token_b: u64
    ) -> Result<()> {
        ctx.accounts.escrow.initializer = ctx.accounts.initializer.key;
        ctx.accounts.escrow.token_a = ctx.accounts.token_a.key;
        ctx.accounts.escrow.token_b = ctx.accounts.token_b.key;
        ctx.accounts.escrow.id = id;
 
        // Store the exchange amounts for each token (in decimals)
        // 100*10'0 = 100
        ctx.accounts.escrow.amount_token_a = amount_token_a * 10u64.pow(ctx.accounts.token_a.decimals.into());
        ctx.accounts.escrow.amount_token_b = amount_token_b * 10u64.pow(ctx.accounts.token_b.decimals.into());
        
        // Store the bumps 
        ctx.accounts.escrow.bump_escrow = ctx.bumps.escrow;
        ctx.accounts.escrow.bump_guaranty_account = ctx.bumps.guaranty_account;
        
        let cpi_ctx = 
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.initializer_token_a_account.to_account_info(),
                to: ctx.accounts.guaranty_account.to_account_info(),
                authority: ctx.accounts.initializer.to_account_info(),
            },
         );

        // Calling CPI
        transfer(cpi_ctx, ctx.accounts.escrow.amount_token_a)?; 

        Ok(())
    }

//---------------------- FINALIZING THE EXCHANGE ----------------------//
pub fn finalizer(ctx: Context<Finalizer>) -> Result<()> {
        /* 
        Transfer token_B from the taker's token account 
        to the initializer's token account
        */

        let cpi_to_initializer = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.taker_token_account_b.to_account_info(),
                to: ctx.accounts.initializer_token_account_b.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(), // the taker is the signer
            },
        );

        // Calling CPI
        transfer(cpi_to_initializer, ctx.accounts.escrow.amount_token_b)?;

       /*
        Once the initializer user receives the token_B from the exchange, the program
        transfers from the guaranty account (PDA) the token_A to the taker user's token account.
        */

        // define the signer seeds for the PDA
        let signer_seeds: &[&[&[u8]]] = &[&[
            ctx.accounts.escrow.to_account_info().key.as_ref(),
            &[ctx.accounts.escrow.bump_guaranty_account],
        ]];

        // transfer the tokens from the vault account to the taker's token account
        let cpi_to_taker = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.guaranty_account.to_account_info(),
                to: ctx.accounts.taker_token_account_a.to_account_info(),
                authority: ctx.accounts.guaranty_account.to_account_info(),
            },
        ).with_signer(signer_seeds);

        // Calling CPI - transfer all tokens stored in the guaranty account
        transfer(cpi_to_taker, ctx.accounts.guaranty_account.amount)?; 

        /*
        Once token_A and token_B have been exchanged between the initializer user
        and the taker, the guaranty account is closed and the rent is returned to 
        the initializer user
        */

        let cpi_close = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.guaranty_account.to_account_info(),
                destination: ctx.accounts.initializer.to_account_info(), // the rent is returned to the initializer
                authority: ctx.accounts.guaranty_account.to_account_info(),
            },
        ).with_signer(signer_seeds);

        // CPI to close the PDA which is a token account
        close_account(cpi_close)?;

        Ok(())
   }
}   

//-----------------------   ACCOUNT VALIDATION STRUCTS  -----------------------//

#[derive(Accounts)]
#[instruction(id: String)]
pub struct Initialize<'info> {
    #[account(
        init, 
        payer = initializer, 
        space = 8 + Escrow::INIT_SPACE ,
        seeds = [
            initializer.key().as_ref(), 
            id.as_bytes()
            ],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)] // balance is debited from this account
    pub initializer: Signer<'info>,

    #[account(
        mut, // balance is debited from token A
        constraint = initializer_token_a_account.mint = token_a.key() // verification
    )]
    pub initializer_token_a_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = initializer,
        seeds = [
            escrow.key().as_ref(),
        ],
        bump,
        token::mint = token_a,
        token::authority = guaranty_account,
    )]
    pub guaranty_account: Account<'info, TokenAccount>,

    // tokens
    pub token_a: Account<'info, Mint>,
    pub token_b: Account<'info, Mint>,

    // programs
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    // variables
    pub rent: Sysvar<'info, Rent>,
}


#[derive(Accounts)]
pub struct Finalizer<'info> {
    #[account(
        mut,
        seeds= [
            initializer.key().as_ref(),
            escrow.id.as_ref()
        ],
        bump = escrow.bump_escrow,
   )]
    pub escrow: Account<'info, Escrow>, // data account that stores exchange information

    #[account(
        mut, // balance is debited from this account
        seeds = [escrow.key().as_ref()], // PDA seed
        bump = escrow.bump_guaranty_account, 
    )]
    pub guaranty_account: Account<'info, TokenAccount>, // a token account that stores the token_A of the exchange 

    #[account(mut)]
    pub taker: Signer<'info>, // the person accepting/taking the offer 

    #[account(mut)]
    pub initializer: SystemAccount<'info>, // the person who creates the offer

    // token accounts
    #[account(
        mut, // balance is debited from this account
        associated_token::mint = escrow.token_b,
        associated_token::authority = escrow.initializer,
    )]
    pub initializer_token_account_b: Account<'info, TokenAccount>, // where the initializer will receive token_B

    #[account(
        mut, // balance is debited from this account
        associated_token::mint = escrow.token_b,
        associated_token::authority = taker.key(),
    )]
    pub taker_token_account_b: Account<'info, TokenAccount>, // taker's token_B account 

    #[account(
        mut, // balance is debited from this account
        associated_token::mint = escrow.token_a,
        associated_token::authority = taker.key(),
    )]
    pub taker_token_account_a: Account<'info, TokenAccount>, // where the taker will receive token_A

    //programas
    pub token_program: Program<'info, Token>,
}
