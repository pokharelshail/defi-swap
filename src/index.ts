import { Connection } from "@solana/web3.js";
import dotenv from "dotenv";
import { solToLamports } from "./helpers/conversions.js";

dotenv.config({
  path: ".env",
});

console.log(solToLamports(0.01));

async function main() {
  //   const connection = new Connection(process.env.RPC);
  // Since amount is 100 million its quoting for 0.1 Sol
  const quoteResponse = await (
    await fetch(
      "https://api.jup.ag/swap/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50"
    )
  ).json();
  console.log(quoteResponse);
}

main().catch((error) => console.log(error));
