import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  TransactionExpiredBlockheightExceededError,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import { TransactionType } from "./types/index.js";

type TransactionSenderProps = {
  connection: Connection;
  serializedTransaction: Buffer; // Expects Buffer type here
  blockhashWithExpiryBlockHeight: BlockhashWithExpiryBlockHeight;
  transactionType: TransactionType;
};

const SEND_OPTIONS = {
  skipPreflight: true,
};

export async function transactionSenderAndConfirmationWaiter({
  connection,
  serializedTransaction,
  blockhashWithExpiryBlockHeight,
  transactionType,
}: TransactionSenderProps): Promise<string | null> {
  // Send the raw transaction
  const txid = await connection.sendRawTransaction(serializedTransaction, SEND_OPTIONS);

  // Set last valid block height differently for buy vs. sell transactions
  const blockHeight = blockhashWithExpiryBlockHeight.lastValidBlockHeight;
  // const lastValidBlockHeight = transactionType === TransactionType.SELL ? blockHeight : blockHeight - 50;
  const lastValidBlockHeight = blockHeight;

  try {
    // Attempt to confirm the transaction
    await connection.confirmTransaction(
      {
        ...blockhashWithExpiryBlockHeight,
        lastValidBlockHeight,
        signature: txid,
      },
      "confirmed"
    );
    console.log(`done ${txid}`);
    return txid; // Return the txid as a string
  } catch (e) {
    if (e instanceof TransactionExpiredBlockheightExceededError) {
      console.log("Transaction Expired Block Height exceeded!");
      return null; // Handle expired transactions gracefully
    }
    throw e; // Rethrow other errors
  }
}
