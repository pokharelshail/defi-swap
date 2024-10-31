import { Keypair } from "@solana/web3.js";

async function getSOLbalance(wallet: Keypair, connection) {
  try {
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`SOL Balance: ${balance / 1_000_000_000} SOL`);
    return balance;
  } catch (error) {
    console.error("Failed to get SOL balance:", error);
    throw error;
  }
}

const LAMPORTS = 1_000_000_000; //1 SOL = 1 Billion lamports
export const solToLamports = (sol: number) => sol * LAMPORTS;
