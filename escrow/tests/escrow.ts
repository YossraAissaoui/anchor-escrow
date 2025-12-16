import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";

describe("Escrow Tests", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;

  // Tokens
  let tokenA: PublicKey; // example: USDC
  let tokenB: PublicKey; // example: USDT

  // Accounts
  let escrow: PublicKey; // stores the exchange information
  let guarantyAccount: PublicKey; // stores the initializer's token_A

  /* 
   The initializer user will be our wallet
   */
  let initializer = provider.wallet as anchor.Wallet;
  let initializerTokenAccountA: PublicKey; // token account associated with initializer and Token A

  // Escrow ID (timestamp)
  let id = Date.now().toString();

  /*
  Create all necessary accounts that must exist before
  executing our instruction
   */
  before(async () => {
    // Find PDA address for the escrow account
    // THIS DOES NOT CREATE THE ACCOUNT
    [escrow] = PublicKey.findProgramAddressSync(
      [initializer.publicKey.toBuffer(), Buffer.from(id)],
      program.programId
    );
    console.log("Escrow account: ", escrow.toBase58());

    // Find PDA address for the guaranty account
    [guarantyAccount] = PublicKey.findProgramAddressSync(
      [escrow.toBuffer()],
      program.programId
    );
    console.log("Guaranty account: ", guarantyAccount.toBase58());

    // Create token A
    tokenA = await spl.createMint(
      provider.connection,        // connection to Solana
      (initializer as any).payer, // who pays the fees
      initializer.publicKey,      // mint authority
      initializer.publicKey,      // freeze authority
      2                           // token decimals
    );
    console.log("Token A: ", tokenA.toBase58());

    // Create token B
    tokenB = await spl.createMint(
      provider.connection,        // connection to Solana
      (initializer as any).payer, // who pays the fees
      initializer.publicKey,      // mint authority
      initializer.publicKey,      // freeze authority
      2                           // token decimals
    );
    console.log("Token B: ", tokenB.toBase58());

    // Create associated token account for initializer and token A
    initializerTokenAccountA = await spl.createAssociatedTokenAccount(
      provider.connection,        // network connection
      (initializer as any).payer, // pays the fees
      tokenA,                     // tokens stored in the account
      initializer.publicKey.      // token owner
    );
    console.log("Initializer Token A account: ", initializerTokenAccountA.toBase58());

    /*
    Our first instruction transfers token A to the guaranty account
    The initializer must possess token A in their token account, so
    we mint token A to the associated token account of the initializer and token A
    */
    await spl.mintTo(
      provider.connection,      // connection to Solana
      (initializer as any).payer, // who pays the fees
      tokenA,                     // token to mint
      initializerTokenAccountA,   // where to deposit them
      initializer.publicKey,      // mint authority
      100000 // amount to mint (expressed in decimals: 100000 = 1000.00 with 2 decimals)
    );

    console.log("Minted 1000.00 Token A to initializer");
  });

  //=============================================================================
  // TESTS
  //=============================================================================

  it("Initializes an Escrow", async () => {
    // Amounts associated with the token exchange
    const amountTokenA = new BN(100); // 100 token A
    const amountTokenB = new BN(95); // 95 token B

    console.log("\n--- Initializing Escrow ---");
    console.log("Amount Token A:", amountTokenA.toString());
    console.log("Amount Token B:", amountTokenB.toString());

    // Call the instruction
    const txHash = await program.methods
      .initialize(id, amountTokenA, amountTokenB)
      .accounts({
        escrow: escrow,
        initializer: initializer.publicKey,
        initializerTokenAAccount: initializerTokenAccountA,
        guarantyAccount: guarantyAccount,
        tokenA: tokenA,
        tokenB: tokenB,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Transaction signature:", txHash);

    // Confirm the transaction
    await provider.connection.confirmTransaction(txHash);

    // Verify that the amount was deposited in the guaranty account
    const guarantyAccountInfo = await spl.getAccount(
      provider.connection,
      guarantyAccount
    );
    const deposit = guarantyAccountInfo.amount;

    console.log("Deposit in guaranty account:", deposit.toString());

    // Assert - amount should be amountTokenA * 10^decimals
    // 100 * 10^2 = 10000
    const expectedDeposit = amountTokenA.toNumber() * 10 ** 2;
    assert.equal(Number(deposit), expectedDeposit);

    console.log("✅ Escrow initialized successfully!");
    console.log(`✅ ${deposit} tokens locked in guaranty account`);
  });

  it("Finalizes the Escrow", async () => {
    console.log("\n--- Finalizing Escrow ---");

    // Create a taker (Person B who will accept the trade)
    const taker = Keypair.generate();
    console.log("Taker public key:", taker.publicKey.toBase58());

    // Airdrop SOL to taker for transaction fees
    const airdropSignature = await provider.connection.requestAirdrop(
      taker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);
    console.log("Airdropped 2 SOL to taker");

    // Create taker's token A account (where they'll receive token A)
    const takerTokenAccountA = await spl.createAssociatedTokenAccount(
      provider.connection,
      taker,
      tokenA,
      taker.publicKey
    );
    console.log("Taker Token A account:", takerTokenAccountA.toBase58());

    // Create taker's token B account (where they have token B)
    const takerTokenAccountB = await spl.createAssociatedTokenAccount(
      provider.connection,
      taker,
      tokenB,
      taker.publicKey
    );
    console.log("Taker Token B account:", takerTokenAccountB.toBase58());

    // Mint token B to taker (they need 95 token B to accept the trade)
    // 95 * 10^2 = 9500
    await spl.mintTo(
      provider.connection,
      taker,
      tokenB,
      takerTokenAccountB,
      initializer.publicKey,
      9500 // 95.00 with 2 decimals
    );
    console.log("Minted 95.00 Token B to taker");

    // Create initializer's token B account (where they'll receive token B)
    const initializerTokenAccountB = await spl.getOrCreateAssociatedTokenAccount(
      provider.connection,
      (initializer as any).payer,
      tokenB,
      initializer.publicKey
    );
    console.log("Initializer Token B account:", initializerTokenAccountB.address.toBase58());

    // Get balances before finalize
    const takerTokenBBefore = await spl.getAccount(provider.connection, takerTokenAccountB);
    const initializerTokenABefore = await spl.getAccount(provider.connection, initializerTokenAccountA);
    
    console.log("\nBalances before finalize:");
    console.log("Taker Token B:", takerTokenBBefore.amount.toString());
    console.log("Initializer Token A:", initializerTokenABefore.amount.toString());

    // Call finalize instruction
    const txHash = await program.methods
      .finalize()
      .accounts({
        escrow: escrow,
        guarantyAccount: guarantyAccount,
        taker: taker.publicKey,
        initializer: initializer.publicKey,
        initializerTokenAccountB: initializerTokenAccountB.address,
        takerTokenAccountB: takerTokenAccountB,
        takerTokenAccountA: takerTokenAccountA,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    console.log("\nFinalize transaction signature:", txHash);

    // Confirm transaction
    await provider.connection.confirmTransaction(txHash);

    // Get balances after finalize
    const takerTokenAAfter = await spl.getAccount(provider.connection, takerTokenAccountA);
    const takerTokenBAfter = await spl.getAccount(provider.connection, takerTokenAccountB);
    const initializerTokenBAfter = await spl.getAccount(provider.connection, initializerTokenAccountB.address);

    console.log("\nBalances after finalize:");
    console.log("Taker Token A:", takerTokenAAfter.amount.toString());
    console.log("Taker Token B:", takerTokenBAfter.amount.toString());
    console.log("Initializer Token B:", initializerTokenBAfter.amount.toString());

    // Assertions
    assert.equal(Number(takerTokenAAfter.amount), 10000); // 100 * 10^2
    assert.equal(Number(initializerTokenBAfter.amount), 9500); // 95 * 10^2

    console.log("\n✅ Escrow finalized successfully!");
    console.log("✅ Taker received 100.00 Token A");
    console.log("✅ Initializer received 95.00 Token B");

    // Verify guaranty account is closed
    try {
      await spl.getAccount(provider.connection, guarantyAccount);
      assert.fail("Guaranty account should be closed");
    } catch (error) {
      console.log("✅ Guaranty account closed successfully");
    }
  });
});