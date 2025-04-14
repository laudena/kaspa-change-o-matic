process.env.KASPA_WASM_HEAP_SIZE_MB = "256";
globalThis.WebSocket = require("websocket").w3cwebsocket;
const fs = require("fs");
const path = require("path");
const sleep = ms => new Promise(res => setTimeout(res, ms));

const {
    PrivateKey,
    RpcClient,
    kaspaToSompi,
    createTransactions,
    Resolver
} = require('../../../../nodejs/kaspa');

let { encoding, networkId, address: destinationAddressArg, amount } = require("../utils").parseArgs();

const TRANSACTION_FILE_PATH = path.join(process.env.HOME, "projects/change-o-matic/server", "pending_transactions.json");

function log(message, level = "info") {
    console.log(`{"timestamp":"${new Date().toISOString()}","type":"${level}","message":${JSON.stringify(message)}}`);
}
const privateKeyHex = process.env.KASPA_PRIVATE_KEY;
if (!privateKeyHex) {
    log("Missing KASPA_PRIVATE_KEY environment variable", "error");
    process.exit(1);
}
const privateKey = new PrivateKey(privateKeyHex);


async function sendKaspaTransaction(destinationAddress, amount, retriesLeft = 1) {
    try {
        //todo: convert to module. until then, the monitor will trigger a call here every time it "requires" the file
        if (!amount) {
            log("x", "warn");
            return false;
        }

        // Validate amount
        const amountSompi = kaspaToSompi(amount);
        if (amountSompi <= 0) {
            log("Invalid amount. Must be greater than zero.", "error");
            return false;
        }

        log(`Initializing transaction script...`);
        const sourceAddress = privateKey.toKeypair().toAddress(networkId);
        const rpc = new RpcClient({ resolver: new Resolver(), networkId });
        await rpc.connect();
        log(`Connected to ${rpc.url}`);

        let { isSynced } = await rpc.getServerInfo();
        if (!isSynced) {
            log("Node is not synced. Aborting.", "error");
            return false;
        }

        let { entries } = await rpc.getUtxosByAddresses([sourceAddress]);
        if (!entries.length) {
            log("No UTXOs found for address", "error");
            return false;
        }

        log(`Attempting to send ${amount} KASPA (${amountSompi.toString()} sompi) to ${destinationAddress}`);

        let { transactions } = await createTransactions({
            entries: entries.slice(0, 10),
            outputs: [{ address: destinationAddress, amount: amountSompi }],
            priorityFee: 0n,
            changeAddress: sourceAddress,
            networkId
        });

        if (!transactions || !transactions.length) {
            log("Transaction creation failed.", "error");
            return false;
        }

        let pending = transactions[0];
        log("Signing transaction...");
        await pending.sign([privateKey]);

        log("Submitting transaction...");
        let txid = await pending.submit(rpc);
        log(`Transaction sent. TXID: ${txid}. Waiting for confirmation...`);

        let confirmed = false;
        for (let i = 0; i < 15; i++) {  // Check 15 times, once per second
            let { entries } = await rpc.getUtxosByAddresses([destinationAddress]);
            if (entries.some(tx => tx.outpoint.transactionId === txid)) {
                log(`Transaction confirmed! TXID: ${txid}`, "success");
                confirmed = true;
                break;
            }
            await sleep(1000);
        }

        if (!confirmed) {
            log("Transaction unconfirmed! Don't worry - I will keep checking in the background and resend if needed.", "warn");
            savePendingTransaction({ "txid" : txid, destinationAddress, amount, timestamp: Date.now(), retriesLeft, encoding, networkId });
        }

        await rpc.disconnect();
        return confirmed;

    } catch (error) {
        log(`Exception: ${error.message || JSON.stringify(error)}`, "error");
        return false;
    }
}

function savePendingTransaction(newTransaction) {
    let pendingTransactions = [];

    // Read existing transactions if the file exists
    if (fs.existsSync(TRANSACTION_FILE_PATH)) {
        pendingTransactions = JSON.parse(fs.readFileSync(TRANSACTION_FILE_PATH, "utf8"));
    }

    // Check if this transaction already exists (same address and amount)
    const existingTransaction = pendingTransactions.find(
        (t) => t.destinationAddress === newTransaction.destinationAddress && t.amount === newTransaction.amount
    );

    if (existingTransaction) {
        console.log("Updating existing pending transaction...");
        existingTransaction.timestamp = newTransaction.timestamp;
        existingTransaction.retriesLeft = newTransaction.retriesLeft;
    } else {
        console.log("Saving new pending transaction...");
        pendingTransactions.push(newTransaction);
    }

    // Save the updated list
    fs.writeFileSync(TRANSACTION_FILE_PATH, JSON.stringify(pendingTransactions, null, 2));
}


sendKaspaTransaction(destinationAddressArg, amount)
    .catch((error) => log(`Unhandled error: ${error.message}`, "error"));

