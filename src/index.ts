import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  AddressLookupTableAccount,
  TransactionMessage,
} from "@solana/web3.js";
import { TransactionType } from "./types/index.js";
import dotenv from "dotenv";
import { solToLamports } from "./helpers/conversions.js";
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse, ResponseError } from "@jup-ag/api";
import { transactionSenderAndConfirmationWaiter } from "./transactionSender.js"; // Make sure to include the transaction sender
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

dotenv.config({
  path: process.env.ENV_PATH || ".env",
});

async function main() {
  const connection = new Connection(process.env.RPC, "confirmed");
  const secretKey = Uint8Array.from(JSON.parse(process.env.SECRET_KEY));
  const wallet = Keypair.fromSecretKey(secretKey);
  //console.log(wallet.publicKey.toBase58());

  // Introducing Ledger for Token Management
  const riskPercentage = 0.1; // Set risk to 10% of wallet

  const inputMint = "So11111111111111111111111111111111111111112"; // SOL
  const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
  const slippageBps = "50"; // 0.5% slippage

  const jupiterApi = createJupiterApiClient({ basePath: process.env.METIS_ENDPOINT });

  const quoteRequest = (
    inputMint: string,
    outputMint: string,
    amount,
    transcationType: TransactionType
  ): QuoteGetRequest => {
    try {
      return {
        inputMint: inputMint,
        outputMint: outputMint,
        amount: amount,
        autoSlippage: true,
        maxAutoSlippageBps: transcationType === TransactionType.BUY ? 700 : 1000, // Buy =7% or Sell =10%
        minimizeSlippage: true,
        onlyDirectRoutes: false,
      } as QuoteGetRequest;
    } catch (error) {
      console.error("Failed to create quote request:", error);
      throw error;
    }
  };

  const sellQuoteRequest = (inputMint: string, outputMint: string, amount): QuoteGetRequest => {
    try {
      return {
        inputMint: inputMint,
        outputMint: outputMint,
        amount: amount,
        autoSlippage: true,
        maxAutoSlippageBps: 1000, //10%
        minimizeSlippage: true,
        onlyDirectRoutes: false,
      } as QuoteGetRequest;
    } catch (error) {
      console.error("Failed to create quote request:", error);
      throw error;
    }
  };

  // const createSellQuoteRequest = async (inputMint, outputMint, walletPublicKey) => {
  //   try {
  //     // Get the balance of the input token (the token we're selling)
  //     const amountToSell = await getTokenBalance(inputMint, walletPublicKey);

  //     if (amountToSell <= 0) {
  //       throw new Error("No tokens available to sell.");
  //     }

  //     // Create the quote request using the balance as the amount to sell
  //     return {
  //       inputMint: inputMint,
  //       outputMint: outputMint,
  //       amount: amountToSell, // Use the entire balance to sell
  //       autoSlippage: true, // Enable auto slippage management
  //       maxAutoSlippageBps: 1000, // Set a higher slippage cap at 10% to prioritize successful sell
  //       minimizeSlippage: true, // Minimize slippage within the allowable limit
  //       onlyDirectRoutes: false, // Allow both direct and indirect routes for best liquidity
  //     } as QuoteGetRequest;
  //   } catch (error) {
  //     console.error("Failed to create sell quote request:", error);
  //     throw error;
  //   }
  // };

  // async function getTokenBalance(wallet, tokenMint, connection) {
  //   try {
  //     // Derive the associated token address for the wallet and mint
  //     const tokenAccountAddress = await getAssociatedTokenAddress(new PublicKey(tokenMint), wallet.publicKey);

  //     // Fetch the balance of the derived token account
  //     const tokenBalanceResponse = await connection.getTokenAccountBalance(tokenAccountAddress);
  //     const balance = tokenBalanceResponse.value.amount;

  //     console.log(`Token Balance for ${tokenMint}: ${balance}`);
  //     return balance; // Balance in smallest units (such as lamports for SOL)
  //   } catch (error) {
  //     console.error("Failed to get token balance:", error);
  //     throw error;
  //   }
  // }

  const getQuote = async (quoteRequest) => {
    try {
      const quote = await jupiterApi.quoteGet(quoteRequest);
      if (!quote) throw new Error("No quote found");
      return quote;
    } catch (error) {
      if (error instanceof ResponseError) {
        console.error("Error from Jupiter API:", await error.response.json());
      } else {
        console.error("General error:", error);
      }
      throw new Error("Unable to find quote");
    }
  };

  async function getSwapObj(wallet: Keypair, quote: QuoteResponse) {
    // Get serialized transaction
    const swapObj = await jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      },
    });
    return swapObj;
  }

  try {
    const startTime = performance.now();
    console.log("Starting BUY process \n");
    const quoteReq = quoteRequest(inputMint, outputMint, solToLamports(0.01), TransactionType.BUY); // Create the quote request using fixed amount
    const quote = await getQuote(quoteReq);
    //TODO: IMPLEMENT
    //const priorityFees = getPriotitizationFess();
    console.log(quote);
    const buyswapObj = await getSwapObj(wallet, quote);
    console.log(buyswapObj);

    // Serialize the transaction
    const swapTransactionBuf = Buffer.from(buyswapObj.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    // Sign the transaction
    transaction.sign([wallet]);
    const serializedTransaction = Buffer.from(transaction.serialize());
    const latestBlockHash = await connection.getLatestBlockhash();
    //TODO: UNCOMMENT WHEN TRYING TO SWAP
    // const tx = await transactionSenderAndConfirmationWaiter({
    //   connection,
    //   serializedTransaction,
    //   blockhashWithExpiryBlockHeight: {
    //     blockhash: latestBlockHash.blockhash,
    //     lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    //   },
    //   transactionType: TransactionType.BUY,
    // });
    // if (tx) {
    //   console.log(`Transaction successful: https://solscan.io/tx/${tx}`);
    // } else {
    //   console.error("Transaction failed or could not be confirmed");
    // }

    //SELL QUOTE
    console.log(`Starting SELL process`);
    const tokenMint = new PublicKey(outputMint);
    let outputMintBalance;
    try {
      const mintAddy = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);
      const tokenAccountBalance = await connection.getTokenAccountBalance(mintAddy);
      outputMintBalance = tokenAccountBalance.value.amount;
      console.log(`
        --------------------------------------------------------------------------
        Associated Mint Address: ${mintAddy.toBase58()}
        Mint UI Balance: ${tokenAccountBalance.value.uiAmount}
        Minimal Denomination Balance: ${outputMintBalance}
        --------------------------------------------------------------------------`);
    } catch (error) {
      console.log(`ERROR: Could not grab token balance for ${outputMint}`);
    }
    if (outputMintBalance) {
      const sellQuoteRequest = quoteRequest(outputMint, inputMint, outputMintBalance, TransactionType.SELL);
      const sellQuote = await getQuote(sellQuoteRequest);
      const sellswapObj = await getSwapObj(wallet, sellQuote);
      console.log(sellswapObj);
      // console.log("SELL QUOTE");
      console.log(sellQuote);
      // const swapTransactionBuf = Buffer.from(sellswapObj.swapTransaction, "base64");
      // var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      // // Sign the transaction
      // transaction.sign([wallet]);
      // const serializedTransaction = Buffer.from(transaction.serialize());
      // const latestBlockHash = await connection.getLatestBlockhash();
      // const tx = await transactionSenderAndConfirmationWaiter({
      //   connection,
      //   serializedTransaction,
      //   blockhashWithExpiryBlockHeight: {
      //     blockhash: latestBlockHash.blockhash,
      //     lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      //   },
      //   transactionType: TransactionType.SELL,
      // });
      // if (tx) {
      //   console.log(`Transaction successful: https://solscan.io/tx/${tx}`);
      // } else {
      //   console.error("Transaction failed or could not be confirmed");
      // }
    }
    const endTime = performance.now();
    console.log(`Total Execution Time: ${endTime - startTime} ms`);
    // await swapBackInstructions(quote);
  } catch (error) {
    console.error("Error during quote or swap process:", error);
  }
}

main().catch((error) => console.error("Error occurred in main:", error));
