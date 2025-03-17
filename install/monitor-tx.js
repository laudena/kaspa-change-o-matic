globalThis.WebSocket = require("websocket").w3cwebsocket;
const fs = require("fs");
const path = require("path");
const { RpcClient, Resolver, NetworkId } = require("../../../../nodejs/kaspa");
const { sendKaspaTransactionResubmit } = require("./simple-transaction.js");


const TRANSACTION_FILE_PATH = path.join(process.env.HOME, "projects/change-o-matic/server", "pending_transactions.json");
const SUCCESSFUL_TRANSACTIONS_FILE = path.join(process.env.HOME, "projects/change-o-matic/server", "successful_transactions.json");
const FAILED_TRANSACTIONS_FILE = path.join(process.env.HOME, "projects/change-o-matic/server", "failed_transactions.json");
const LOG_FILE_PATH = path.join(process.env.HOME, "projects/change-o-matic/server", "monitor.log");
console.log("starting monitor");

const {networkId} = require("../utils").parseArgs();
// console.log(" net:", networkId)

// Log function for monitor.js
function log(message, level = "info") {
    const logEntry = `{"timestamp":"${new Date().toISOString()}","type":"${level}","message":${JSON.stringify(message)}}\n`;
    console.log(logEntry);
    fs.appendFileSync(LOG_FILE_PATH, logEntry);
}

// Load transactions from a JSON file
function loadTransactions(filePath) {
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    else log ("file not found", filePath);
    return [];
}

// Save transactions to a JSON file
function saveTransactions(filePath, transactions) {
    fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2));
}

// Remove a transaction from pending_transactions.json
function removePendingTransaction(txid) {
    let pendingTransactions = loadTransactions(TRANSACTION_FILE_PATH);
    pendingTransactions = pendingTransactions.filter(tx => tx.txid !== txid);
    saveTransactions(TRANSACTION_FILE_PATH, pendingTransactions);
}

// Move a transaction to another file (success or failure)
function moveTransaction(tx, targetFile) {
    const transactions = loadTransactions(targetFile);
    transactions.push(tx);
    saveTransactions(targetFile, transactions);
}

// Check pending transactions
async function checkPendingTransactions() {

    let pendingTransactions = loadTransactions(TRANSACTION_FILE_PATH);
    if (pendingTransactions.length === 0) {
        log ('Monitor have no pending transaction to handle. completed a run')
        return;
    }
    else{
        log(`Monitor have ${pendingTransactions.length} pending transactions. starting now`);
    }

    const now = Date.now();
    const rpc = new RpcClient({ resolver: new Resolver(), networkId });
    try {
        await rpc.connect();

        for (let i = pendingTransactions.length - 1; i >= 0; i--) {
            let { txid, destinationAddress, amount, timestamp, retriesLeft } = pendingTransactions[i];

            log(`Handling pending transaction, TXID: ${txid}`);
            let { entries } = await rpc.getUtxosByAddresses([destinationAddress]);
            if (txid !== null && entries.some(tx => tx.outpoint.transactionId === txid)) {
                log(`Transaction confirmed! TXID: ${txid}`, "success");

                // Move to successful transactions and remove from pending
                moveTransaction(pendingTransactions[i], SUCCESSFUL_TRANSACTIONS_FILE);
                removePendingTransaction(txid);
                continue;
            }

            // If 10 minutes have passed, attempt a second submission
            if (retriesLeft > 0 && now - timestamp > 10 * 60 * 1000) {
                log(`Transaction not confirmed after 10 minutes. Resubmitting...`, "warn");
                pendingTransactions[i].retriesLeft = 0; // Mark as final attempt
                await sendKaspaTransactionResubmit(pendingTransactions[i]);
                saveTransactions(TRANSACTION_FILE_PATH, pendingTransactions);
                continue;
            }

            // If 20 minutes pass, mark as failed
            if (retriesLeft === 0 && now - timestamp > 15 * 60 * 1000) {
                log(`Transaction failed after final attempt. Moving to failed list. TXID: ${txid}`, "error");
                // Move to failed transactions and remove from pending
                moveTransaction(pendingTransactions[i], FAILED_TRANSACTIONS_FILE);
                removePendingTransaction(txid);
            }
        }
    } catch (error) {
        log(`Error checking transactions: ${error.message}`, "error");
    } finally {
        if (rpc !== undefined)
            await rpc.disconnect();
        log("monitor exists");
    }
}

// Run check every minute
setInterval(async () => {
    await checkPendingTransactions();
}, 120 * 1000);
log("Monitor started, checking pending transactions every 5 seconds.");
