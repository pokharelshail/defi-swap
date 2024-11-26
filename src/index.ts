// 🌐 Import Required Libraries
// ---------------------------------------------------------------------

const raydiumSdk = await import("@raydium-io/raydium-sdk");
const { MARKET_STATE_LAYOUT_V3, Market, TOKEN_PROGRAM_ID } = raydiumSdk;

import {
  Connection,
  Logs,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { TransactionType } from "./types/index.js";

import dotenv from "dotenv";
import { solToLamports, delay } from "./helpers/conversions.js";
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse, ResponseError } from "@jup-ag/api";
import { transactionSenderAndConfirmationWaiter } from "./transactionSender.js"; // Make sure to include the transaction sender
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

interface Risk {
  name: string;
  value: string;
}

interface RugCheckResponse {
  risks: Risk[];
}

// 🛠 Configuration Constants
// ---------------------------------------------------------------------
const MAINNET = "https://api.mainnet-beta.solana.com";
const RAYDIUM_POOL_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

import axios from "axios"; // Ensure axios is installed

const MIN_LIQUIDITY_THRESHOLD = 1000; // Minimum liquidity threshold in USD

const connection = new Connection(MAINNET);

const seenTransactions: Array<string> = []; // 📝 Prevent duplicate processing of transactions

// 🚀 Main Function
// ---------------------------------------------------------------------
subscribeToNewRaydiumPools();

/**
 * 🎧 Listen to new Raydium pools
 */
function subscribeToNewRaydiumPools(): void {
  connection.onLogs(new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID), async (txLogs: Logs) => {
    // ⛔ Avoid duplicate transactions
    if (seenTransactions.includes(txLogs.signature)) return;
    seenTransactions.push(txLogs.signature);

    // 🔍 Check if this is an LP initialization transaction
    if (!findLogEntry("init_pc_amount", txLogs.logs)) return;

    // 🗝 Fetch pool keys for this LP initialization transaction
    const poolKeys = await fetchPoolKeysForLPInitTransactionHash(txLogs.signature);

    // Identify "Our Token" (whichever is not SOL)
    const SOL_MINT = "So11111111111111111111111111111111111111112"; // SOL token address
    let ourToken = "";
    let ourTokenAddress = "";

    if (poolKeys.baseMint.toBase58() !== SOL_MINT) {
      ourToken = "Base Mint";
      ourTokenAddress = poolKeys.baseMint.toBase58();
    } else if (poolKeys.quoteMint.toBase58() !== SOL_MINT) {
      ourToken = "Quote Mint";
      ourTokenAddress = poolKeys.quoteMint.toBase58();
    } else {
      // If both tokens are SOL, skip logging
      return;
    }

    const timestamp = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      dateStyle: "short",
      timeStyle: "long",
    }).format(new Date());

    // 🖋 Log only relevant LP detected
    console.log("––––––––––––––––––––––––––––––––––––––––");
    console.log(`🌟 New Liquidity Pool Detected for Our Token (${ourToken}):`);
    console.log(`Token Address: ${ourTokenAddress}`);
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log();
    // 🔍 Run Rug Check on the token
    const safe = await checkTokenSafety(ourTokenAddress);
    if (safe) {
      await main(ourTokenAddress).catch((error) => console.error("Error occurred in main:", error));
    }
    console.log("––––––––––––––––––––––––––––––––––––––––");
  });

  console.log("🎧 Listening to new pools...");
}

// 🔍 Helper Functions
// ---------------------------------------------------------------------

// Function to check token safety using RugCheck API
async function checkTokenSafety(mint: string) {
  try {
    const baseUrl = "https://api.rugcheck.xyz/v1"; // RugCheck API base URL
    const response = await axios.get(`${baseUrl}/tokens/${mint}/report/summary`);

    if (response.data) {
      const { risks, score } = response.data;
      const liquidityRisk = response.data.risks.find((risk: Risk) => risk.name === "Low Liquidity");

      const freezeRisk = response.data.risks.find((risk: Risk) => risk.name === "Freeze Authority still enabled");

      const liquidityValue = parseFloat((liquidityRisk?.value || "$0.00").replace("$", "").replace(",", ""));

      console.log(`\n🔍 Checking Token Mint: ${mint}`);
      console.log(`💧 Liquidity: $${liquidityValue.toFixed(2)}`);

      if (liquidityValue >= MIN_LIQUIDITY_THRESHOLD) {
        console.log(`✅ Token has sufficient liquidity.`);
      } else {
        console.log(`⚠️ Token rejected due to insufficient liquidity.`);
      }
      if (freezeRisk) {
        console.log(`⚠️ ITS FROZEN DONT DO IT`);
        return false;
      }
      if (score > 10000) {
        console.log(`⚠️ HIGHER RISK: SCORE ABOVE 10 000!`);
        return false;
      }
      console.log();
      console.log(`🛡️  Safety Report: ${JSON.stringify(response.data, null, 2)}`);
      return true;
    } else {
      console.log(`⚠️ No safety report available for mint: ${mint}`);
      return false;
    }
  } catch (error) {
    console.error(`Error checking mint: ${mint}`, error);
    return false;
  }
}

/**
 * 🔍 Search for a specific log entry in transaction logs
 */
function findLogEntry(needle: string, logEntries: Array<string>): string | null {
  for (let i = 0; i < logEntries.length; ++i) {
    if (logEntries[i].includes(needle)) return logEntries[i];
  }
  return null;
}

/**
 * 🗝 Fetch the pool keys for a transaction
 */
async function fetchPoolKeysForLPInitTransactionHash(txSignature: string): Promise<any> {
  const tx = await connection.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error(`❌ Failed to fetch transaction with signature: ${txSignature}`);

  const poolInfo = parsePoolInfoFromLpTransaction(tx);
  const marketInfo = await fetchMarketInfo(poolInfo.marketId);

  return {
    id: poolInfo.id,
    baseMint: poolInfo.baseMint,
    quoteMint: poolInfo.quoteMint,
    lpMint: poolInfo.lpMint,
    baseDecimals: poolInfo.baseDecimals,
    quoteDecimals: poolInfo.quoteDecimals,
    lpDecimals: poolInfo.lpDecimals,
    version: 4,
    programId: poolInfo.programId,
    authority: poolInfo.authority,
    openOrders: poolInfo.openOrders,
    targetOrders: poolInfo.targetOrders,
    baseVault: poolInfo.baseVault,
    quoteVault: poolInfo.quoteVault,
    withdrawQueue: poolInfo.withdrawQueue,
    lpVault: poolInfo.lpVault,
    marketVersion: 3,
    marketProgramId: poolInfo.marketProgramId,
    marketId: poolInfo.marketId,
    marketAuthority: Market.getAssociatedAuthority({
      programId: poolInfo.marketProgramId,
      marketId: poolInfo.marketId,
    }).publicKey,
    marketBaseVault: marketInfo.baseVault,
    marketQuoteVault: marketInfo.quoteVault,
    marketBids: marketInfo.bids,
    marketAsks: marketInfo.asks,
    marketEventQueue: marketInfo.eventQueue,
  };
}

/**
 * 📊 Fetch market information
 */
async function fetchMarketInfo(marketId: PublicKey) {
  const marketAccountInfo = await connection.getAccountInfo(marketId);
  if (!marketAccountInfo) {
    throw new Error(`❌ Failed to fetch market info for market ID: ${marketId.toBase58()}`);
  }
  return MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
}

/**
 * 🛠 Parse pool info from LP transaction
 */
function parsePoolInfoFromLpTransaction(txData: ParsedTransactionWithMeta) {
  const initInstruction = findInstructionByProgramId(
    txData.transaction.message.instructions,
    new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID)
  ) as PartiallyDecodedInstruction | null;

  if (!initInstruction) throw new Error("❌ LP initialization instruction not found in transaction.");

  // 🎯 Extract necessary account data
  const baseMint = initInstruction.accounts[8];
  const quoteMint = initInstruction.accounts[9];
  const lpMint = initInstruction.accounts[7];

  // Add more parsing logic as per your requirements...

  return {
    id: initInstruction.accounts[4],
    baseMint,
    quoteMint,
    lpMint,
    baseDecimals: 9,
    quoteDecimals: 9,
    lpDecimals: 9,
    programId: new PublicKey(RAYDIUM_POOL_V4_PROGRAM_ID),
    authority: initInstruction.accounts[5],
    openOrders: initInstruction.accounts[6],
    targetOrders: initInstruction.accounts[13],
    baseVault: initInstruction.accounts[10],
    quoteVault: initInstruction.accounts[11],
    withdrawQueue: new PublicKey("11111111111111111111111111111111"),
    lpVault: new PublicKey("11111111111111111111111111111111"),
    marketProgramId: initInstruction.accounts[15],
    marketId: initInstruction.accounts[16],
  };
}

/**
 * 🔍 Find specific instructions by program ID
 */
function findInstructionByProgramId(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  programId: PublicKey
): ParsedInstruction | PartiallyDecodedInstruction | null {
  return instructions.find((instr) => instr.programId.equals(programId)) || null;
}

dotenv.config({
  path: process.env.ENV_PATH || ".env",
});

async function main(outputMintToken) {
  const connection = new Connection(process.env.RPC, "confirmed");
  const secretKey = Uint8Array.from(JSON.parse(process.env.SECRET_KEY));
  const wallet = Keypair.fromSecretKey(secretKey);

  const inputMint = "So11111111111111111111111111111111111111112"; // SOL
  const outputMint = outputMintToken; // USDC
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
