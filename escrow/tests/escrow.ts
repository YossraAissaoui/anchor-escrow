import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { PublicKey } from "@solana/web3.js";
import { program } from "@coral-xyz/anchor/dist/cjs/native/system";

/*
describe("escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.escrow as Program<Escrow>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
*/

describe("Test", () => {
  // Define the accounts to use.
  
  // tokens
  let tokenA = PublicKey; // example: USDC
  let tokenB = PublicKey; // example: USDT

  // accounts
  let escrow = PublicKey;
  let guaranty = PublicKey; // where the funds of Tokens A are held

  let initializer = program.provider.publicKey; 
  let initializerTokenA = PublicKey;
  let id = Date.now().toString();  // identifier of the escrow (timestamp)

  // found PDA for escrow account
  before(async () => {
    [escrow] = web3.PublicKey.findProgramAddressSync(
      [initializer.publicKey.toBuffer(), Buffer.from(id)],
      program.programId
    );
    console.log("Escrow PDA: ", escrow.toBase58());

    // create mint for Token A
    tokenA = await spl.createMint(
      program.provider.connection, // solana connection
      initializer,                 // the fees payer
      initializer.publicKey,       // mint authority
      initializer.publicKey,       // freeze authority
      2                            // decimals
    );
    console.log("Token A: ", tokenA.toBase58());

     // create mint for Token B
    tokenB = await spl.createMint(
      program.provider.connection, // solana connection
      initializer,                 // the fees payer
      initializer.publicKey,       // mint authority
      initializer.publicKey,       // freeze authority
      2                            // decimals
    );
    console.log("Token B: ", tokenB.toBase58());

    // create token account for Token A
    initializerTokenA = await spl.getOrCreateAssociatedTokenAccount(
      program.provider.connection, // solana connection
      initializer,                 // the fees payer
      tokenA,                      // tokens stored in the account
      initializer.publicKey        // owner
    );
    console.log("Initializer Token A Account: ", initializerTokenA.address.toBase58());

    // tranfer Token A to guaranty account
    /* initializer must have enough balance of Token A before running this test
    so you can mint tokens A to account associated with initializer.publicKey */ 
    await spl.mintTo(
      program.provider.connection, // solana connection
      initializer,                 // the fees payer
      tokenA,                      // mint
      initializerTokenA,           // deposit account
      initializer,                 // mint authority
      100000                       // amount (in decimals)
    );
 });

   //-------------------------- Tests --------------------------//
    it("An escrow is initialized", async () => {
      // amount associated to tokens exchanged
       const amountTokenA = new anchor.BN(100); // 100 tokens of A
       const amountTokenB = new anchor.BN(95);  // 95 tokens of B

       // call instruction
       let txHash = await program.methods
          .initialize(id, amountTokenA, amountTokenB)
          .accounts({
            escrow: escrow,
            initializer: initializer.publicKey,
            initializerTokenA: initializerTokenA,
            guaranty: guaranty,
            tokenA: tokenA,
            tokenB: tokenB,
          })
          .signers([initializer])
          .rpc();

          // confirm transaction
          await program.connection.confirmTransaction(txHash);
          // verify if the amount has been deposited into the guarantee account
          let deposit = (await.spl.getAccount(program.connection, guaranty)).amount;
          // assert
          assert.equal(amountTokenA.toNumber() * 10 ** 2, deposit);
     });
});