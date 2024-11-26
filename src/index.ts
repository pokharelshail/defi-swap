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
import { solToLamports, delay } from "./helpers/conversions.js";
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse, ResponseError } from "@jup-ag/api";
import { transactionSenderAndConfirmationWaiter } from "./transactionSender.js"; // Make sure to include the transaction sender
import { token } from "@project-serum/anchor/dist/cjs/utils/index.js";
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

dotenv.config({
  path: process.env.ENV_PATH || ".env",
});

async function main() {
  const connection = new Connection(process.env.RPC, "confirmed");
  const secretKey = Uint8Array.from(JSON.parse(process.env.SECRET_KEY));
  const wallet = Keypair.fromSecretKey(secretKey);

  const inputMint = "So11111111111111111111111111111111111111112"; // SOL
  const outputMint = "G1FtYFCCRMjCBpUBmG5q8UWuJ5rjDpgZNmmSoDbpump"; // USDC
  const quicknodeEndpoint = process.env.RPC;
  const jupiterApi = createJupiterApiClient({ basePath: process.env.METIS_ENDPOINT });

  //__________________________________________________

  // Function to get prioritization fees for a token using QuickNode API
  async function getPriorityFees(tokenMintAddress) {
    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");

    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "qn_estimatePriorityFees",
      params: {
        last_n_blocks: 100,
        account: tokenMintAddress,
        api_version: 2,
      },
    });

    const requestOptions: RequestInit = {
      method: "POST",
      headers: myHeaders,
      body: raw,
      redirect: "follow",
    };
    //TODO: ADD ERROR HANDELING
    console.log("--Priroty Fee--");
    const response = await fetch(quicknodeEndpoint, requestOptions);
    const data = await response.json();
    console.log(data);
    return data;
  }

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
        maxAutoSlippageBps: transcationType === TransactionType.BUY ? 700 : 1100, // Buy =7% or Sell =11%
        minimizeSlippage: true,
        onlyDirectRoutes: false,
      } as QuoteGetRequest;
    } catch (error) {
      console.error("Failed to create quote request:", error);
      throw error;
    }
  };

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

  async function getSwapObj(wallet: Keypair, quote: QuoteResponse, priorityFeeMicroLamports) {
    const priorityFeeLamports = Math.round(priorityFeeMicroLamports / 1_000_000);
    // Get serialized transaction
    console.log(priorityFeeLamports);
    const swapObj = await jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityFeeLamports,
      },
    });
    return swapObj;
  }

  //__________________________________________________

  try {
    const startTime = performance.now();
    console.log("Starting BUY process \n");
    0.0097;
    const quoteReq = quoteRequest(inputMint, outputMint, solToLamports(0.005), TransactionType.BUY); // Create the quote request using fixed amount
    const quote = await getQuote(quoteReq);
    //TODO: IMPLEMENT
    //const priorityFees = getPriotitizationFess();
    console.log(quote);
    const buyPriorityFee = await getPriorityFees(inputMint);
    const buyPrioritizationFeeMicroLamports = buyPriorityFee.result?.per_transaction.low;
    const buyswapObj = await getSwapObj(wallet, quote, buyPrioritizationFeeMicroLamports);
    console.log("Buy Object swap:");
    console.log(buyswapObj);

    const swapTransactionBuf = Buffer.from(buyswapObj.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    // Sign the transaction
    transaction.sign([wallet]);
    const serializedTransaction = Buffer.from(transaction.serialize());
    const latestBlockHash = await connection.getLatestBlockhash();
    //TODO: UNCOMMENT WHEN TRYING TO SWAP
    const tx = await transactionSenderAndConfirmationWaiter({
      connection,
      serializedTransaction,
      blockhashWithExpiryBlockHeight: {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      },
      transactionType: TransactionType.BUY,
    });
    if (tx) {
      console.log(`Transaction successful: https://solscan.io/tx/${tx}`);
    } else {
      console.error("Transaction failed or could not be confirmed");
    }
    console.log("wait 3 secs before selling...");
    await delay(7000);
    //SELL QUOTE
    console.log(`Starting SELL process`);
    const tokenMint = new PublicKey(outputMint);
    let outputMintBalance;
    try {
      const mintAddy = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey);
      const tokenAccountBalance = await connection.getTokenAccountBalance(mintAddy);
      outputMintBalance = tokenAccountBalance.value.amount;
      console.log(outputMintBalance);
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
      const sellPriorityFee = await getPriorityFees(outputMint);
      const sellprioritizationFeeMicroLamports = sellPriorityFee.result?.per_transaction.extreme;

      const sellswapObj = await getSwapObj(wallet, sellQuote, sellprioritizationFeeMicroLamports);
      console.log(sellswapObj);
      // console.log("SELL QUOTE");
      console.log(sellQuote);
      const swapTransactionBuf = Buffer.from(sellswapObj.swapTransaction, "base64");
      var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      // Sign the transaction
      transaction.sign([wallet]);
      const serializedTransaction = Buffer.from(transaction.serialize());
      const latestBlockHash = await connection.getLatestBlockhash();
      const tx = await transactionSenderAndConfirmationWaiter({
        connection,
        serializedTransaction,
        blockhashWithExpiryBlockHeight: {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        },
        transactionType: TransactionType.SELL,
      });
      if (tx) {
        console.log(`SELL Transaction successful: https://solscan.io/tx/${tx}`);
      } else {
        console.error("SELL Transaction failed or could not be confirmed");
      }
    }
    const endTime = performance.now();
    console.log(`Total Execution Time: ${endTime - startTime} ms`);
    // await swapBackInstructions(quote);
  } catch (error) {
    console.error("Error during quote or swap process:", error);
  }
}

main().catch((error) => console.error("Error occurred in main:", error));
