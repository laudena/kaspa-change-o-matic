const fs = require("fs");
const path = require("path");
const sleep = ms => new Promise(res => setTimeout(res, ms));

const args = process.argv.slice(2);
const parsedArgs = {};

args.forEach(arg => {
    if (arg.startsWith("--")) {
        const [key, value] = arg.slice(2).split("=");
        parsedArgs[key] = value || true; // Default to true for flags
    }
});

const address = parsedArgs.address;
const amount = parsedArgs.amount;

// Log file setup
const LOG_FILE_PATH = path.join(process.env.HOME + "/projects/change-o-matic/server", "kaspa_transactions.log");
const logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: "a" });

function log(message, level = "info") {
    const safeMessage = JSON.stringify(message, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
    );
    console.log(`{"timestamp":"${new Date().toISOString()}","type":"${level}","message":${safeMessage}}`);
}

console.log("Arguments received:");
process.argv.forEach((arg, index) => {
    log(`[${index}]: ${arg}`);
});

let pendingTransactions = [];
const transaction_creation_failed = false
const node_is_not_synced = false
const exception_thrown = false
const transaction_confirmation_failed = true
const resubmission_successful = false

async function sendKaspaTransaction(retries = 3, isResubmission = false, originalTx="") {
    const ignoreFails = isResubmission && resubmission_successful
    try {
        log(`Amount: ${amount}, Address:${address} originalTx:${originalTx}`, "info");
        if (!amount) {
            log("Missing --amount argument.", "error");
            return false;
        }

        const amountSompi = amount*10000000;
        if (amountSompi <= 0) {
            log("Invalid amount. Must be greater than zero.", "error");
            return false;
        }

        log(`Initializing transaction script...`);
        const sourceAddress = "kaspa:source_address";
        const destinationAddress = address || sourceAddress;
        const destinationAddressArg = address;

        await sleep(300);
        log(`Connected to mock-rpc-client`);

        if (node_is_not_synced && !ignoreFails) {
            log("Node is not synced. Aborting.", "error");
            return false;
        }

        log(`Attempting to send ${amount} KASPA (${amountSompi.toString()} sompi)`);

        await sleep(300);

        if (transaction_creation_failed && !ignoreFails) {
            log("Transaction creation failed.", "error");
            return false;
        }

        log("Signing transaction...");
        await sleep(400);

        log("Submitting transaction...");
        await sleep(500);

        if (exception_thrown)
            throw new Error("transaction failed exception thrown");

        txid = Math.round(1000 + Math.random() * 100);
        log(`Transaction sent. Waiting for confirmation... TXID: ${txid}`);

        // Attempt to confirm within 10 seconds
        await sleep(1200);

        if (!(transaction_confirmation_failed && !ignoreFails)) {
            log(`Transaction confirmed! TXID: ${txid}`, "success");
            await sleep(500);
        }
        else {
            // If still unconfirmed after 10 seconds, handle it in the background
            log("Transaction was not confirmed in time. Adding to pending queue.", "error");
            pendingTransactions.push({txid, destinationAddress, timestamp: Date.now(), retriesLeft:  isResubmission ? 0:1 , originalTx});
        }
        return false;

    } catch (error) {
        log(`Error: ${error?.message || "Unknown error"}\nStack: ${error?.stack || error}`, "error");

        if (retries > 0) {
            log(`Retrying transaction... (${4 - retries}/3)`, "warn");
            await sleep(2000);
            return await sendKaspaTransaction(retries - 1, isResubmission);
        }

        // After 3 failed retries, add to pending transactions (only if not already resubmitted)
        if (!isResubmission) {
            log(`Transaction failed after 3 retries. Adding to pending queue for delayed retry.`, "error");
            // Check pending transactions every minute
            pendingTransactions.push({ txid: null, destinationAddress: destinationAddressArg, timestamp: Date.now(), retriesLeft: 1 , originalTx});
            log (pendingTransactions)
        } else {
            log(`Transaction failed after second attempt. No further retries.`, "error");
        }

        return false;
    }
}

async function checkPendingTransactions() {
    const now = Date.now();

    try {

        log ('--> started checkPendingTransactions')
        if (pendingTransactions.length === 0){
            log ('--> no PendingTransactions found. ending.')
            clearInterval(pendingTransactionInterval);
        }

        log (`There are currently ${pendingTransactions.length} transactions in progress.`, "info");
        //remove transactions that were handled already
        //pendingTransactions = pendingTransactions.filter(pT => pT.retriesLeft > 0);

        for (let i = pendingTransactions.length - 1; i >= 0; i--) { //going backwards to support safe splicing during iterations
            let {txid, destinationAddress, timestamp, retriesLeft, originalTx} = pendingTransactions[i];

            if (!transaction_confirmation_failed) {
                log(`Transaction confirmed! TXID: ${txid}`, "success");
                pendingTransactions.splice(0, 1); // Remove from queue
            }

            // If 1 minutes have passed, attempt a second submission (if not already done)
            if (retriesLeft > 0 && now - timestamp > 0.3 * 60 * 1000) {
                log(`Transaction ${txid} not confirmed after 10 minutes. Resubmitting...`, "warn");
                pendingTransactions[i].retriesLeft = 0; // Mark as final attempt
                await sendKaspaTransaction(3, true, pendingTransactions[i].txid);
            } else if (retriesLeft === 0 && now - timestamp > 1 * 60 * 1000) {
                // If 20 minutes pass (meaning second attempt also failed), stop retrying
                if (originalTx == ""){
                    log(`This Transaction failed. A new transmission attempt is currently in progress to send ${amount} to ${destinationAddress}, based on this failed Tx: ${txid}`, "error");
                }
                else{
                    log(`Second transmission attempt based on ${originalTx} failed. with Tx,Address: ${txid} ${address}`, "error");
                }

                pendingTransactions.splice(i, 1);
                if (pendingTransactions.length === 0) {
                    clearInterval(pendingTransactionInterval);
                }

            }
        }

    } catch (error) {
        log(`Error while checking on a pending transactions: ${error.message}`, "error");
    } finally {

    }
}

// Run the transaction
sendKaspaTransaction().finally(() => logStream.end());
pendingTransactionInterval = setInterval(checkPendingTransactions, 8 * 1000);

