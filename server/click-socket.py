import lgpio
import asyncio
import websockets
import time
import json
from fetcher import DataFetcher
from code_reader import scan_qr_code
import subprocess
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime

SIMPLE_TRANSACTION_JS = "/home/alauden/projects/rusty-kaspa/wasm/examples/nodejs/javascript/transactions/simple-transaction.js"
#SIMPLE_TRANSACTION_JS = "/home/alauden/projects/change-o-matic/server/mock-transaction.js"
MONITOR_JS = "/home/alauden/projects/rusty-kaspa/wasm/examples/nodejs/javascript/transactions/monitor-tx.js"


# Fetch Kaspa price every 10 minutes
kaspa_fetcher = DataFetcher(
    name="Kaspa",
    url="https://api.kaspa.org/info/price?stringOnly=false",
    key="price",
    interval_minutes=10
)

# Fetch USD to AUD exchange rate every 15 minutes
usd_aud_fetcher = DataFetcher(
    name="USD/AUD",
    url="https://api.exchangerate-api.com/v4/latest/USD",
    key="rates",
    sub_key="AUD",
    interval_minutes=15
)

# Start fetching data in background threads
kaspa_fetcher.start()
usd_aud_fetcher.start()

BUTTON_PIN = 17     # GPIO pin for button
COIN_PIN = 22       # GPIO pin for coin signal (digital input)
chip = lgpio.gpiochip_open(0)

# Claim GPIO pins
lgpio.gpio_claim_input(chip, BUTTON_PIN)
lgpio.gpio_claim_input(chip, COIN_PIN)

# Initialize main button state variables
LAST_PRESS_TIME = 0
DEBOUNCE_INTERVAL = 0.09
BUTTON_RELEASED = True
HOLD_TO_RESET_INTERVAL = 4
PRESS_THEN_RELEASE_HANDLED = True

#Log file settings
LOG_FILE = "change-o-matic.log"
MAX_FILE_SIZE = 1 * 1024 * 1024  # 1MB
BACKUP_COUNT = 20  # Keep up to 20 log files
logger = logging.getLogger("MyLogger")
logger.setLevel(logging.DEBUG)  # Set log level
file_handler = RotatingFileHandler(LOG_FILE, maxBytes=MAX_FILE_SIZE, backupCount=BACKUP_COUNT, encoding="utf-8")
class CustomFormatter(logging.Formatter):
    def format(self, record):
        record.asctime = self.formatTime(record, "%Y-%m-%d %H:%M:%S.%f")[:-3]  # Trim to milliseconds
        return f"[{record.asctime}] [{record.levelname}] {record.getMessage()}"
formatter = CustomFormatter("[%(asctime)s] %(message)s")
file_handler.setFormatter(formatter)
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Store connected WebSocket clients
connected_clients = set()

# Store shared data (money, address)
shared_data = {
    "collected_amount": 0,  # Tracks the total amount collected
    "recipient_address": "",
    "kaspa_price": 100000,
    "usd_to_aud": 1
}

#Coin detector variables
signal_count = 0
measuring = False
start_time = None
prev_time_high = None
prev_time_low = None
prev_state = 1  # Assuming idle state is HIGH

# Timing thresholds (in milliseconds)
SIGNAL_MIN_DURATION = 22
SIGNAL_MAX_DURATION = 38
TIME_WINDOW = 200  # Time window to count signals (in milliseconds)

signals_to_amount = {
    1: 1.00,
    2: 2.00,
    3: 0.01,
    4: 0.02,
    5: 0.03
}


# Current screen tracking
current_screen = "welcome"  # Initial screen type

# Logic for transitioning to the next screen (when all is normal)
def get_next_screen(current_screen):
    screen_order = [
        "welcome", "wallet", "insert-coin", "confirm-amount", "scan-wallet", "error-page", "scan-wallet", "processing"
    ]
    current_index = screen_order.index(current_screen)
    next_index = (current_index + 1) % len(screen_order)
    return screen_order[next_index]

# Button reading logic with debounce
def read_button():
    global LAST_PRESS_TIME, BUTTON_RELEASED, PRESS_THEN_RELEASE_HANDLED, current_screen
    try:
        current_state = lgpio.gpio_read(chip, BUTTON_PIN) == 1  # Button pressed if HIGH
        if current_state and BUTTON_RELEASED and (time.time() - LAST_PRESS_TIME > DEBOUNCE_INTERVAL):
            LAST_PRESS_TIME = time.time()
            BUTTON_RELEASED = False  # Mark button as pressed
            PRESS_THEN_RELEASE_HANDLED = False
            return True
        elif not current_state:
            if not PRESS_THEN_RELEASE_HANDLED and (time.time() - LAST_PRESS_TIME > HOLD_TO_RESET_INTERVAL):
                shared_data['recipient_address'] = ""
                current_screen = "processing"  # which will be immediately advanced back to "welcome"
                PRESS_THEN_RELEASE_HANDLED = True
                logger.info("hold button detected for interval of:" + str(time.time() - LAST_PRESS_TIME))
                return True
            BUTTON_RELEASED = True  # Move this after checking the hold condition
            LAST_PRESS_TIME = time.time()  # Reset LAST_PRESS_TIME on release
        return False
    except Exception as e:
        logger.info(f"GPIO Error: {e}")
        return False


async def read_coin_selector():
    global measuring, start_time, signal_count, prev_time_low, prev_state
    state = lgpio.gpio_read(chip, COIN_PIN)
    current_time = time.time() * 1000  # Convert to milliseconds

    if state == 0 and prev_state == 1:  # Falling edge (LOW detected)
        prev_time_low = current_time  # Record when LOW starts

    if state == 1 and prev_state == 0:  # Rising edge (HIGH detected)
        if prev_time_low is not None:
            signal_duration = current_time - prev_time_low

            # Check if it's a valid signal
            if SIGNAL_MIN_DURATION <= signal_duration <= SIGNAL_MAX_DURATION:
                if not measuring:
                    measuring = True
                    start_time = current_time  # Start the 350ms time window
                    signal_count = 1  # First signal detected
                    logger.info(f"Detecting first signal")
                else:
                    signal_count += 1  # Count additional valid signals
                    logger.info(f"Detected {signal_count} signals")

            prev_time_high = current_time  # Save the HIGH time

    # Check if 350ms have passed since the first valid signal
    if measuring and (current_time - start_time >= TIME_WINDOW):
        await handle_coin_received(signals_to_amount.get(signal_count))
        measuring = False  # Reset measurement
        signal_count = 0  # Reset signal count

    prev_state = state  # Update previous state

# Example screen handlers with custom logic
async def handle_insert_coin():
    # automatically add money for testing here below
    # asyncio.create_task(handle_coin_received(0.01))
    return "confirm-amount"

async def handle_coin_received(amount):
    logger.info(f"Detected {signal_count} signals within {TIME_WINDOW}ms")
    global shared_data
    shared_data["collected_amount"] += amount
    logger.info(f"1. Coin received: {amount} AUD. Total: {shared_data['collected_amount']} AUD.")
    await send_message("coin-update", {
        "amount": amount,
        "total_collected": shared_data["collected_amount"]
    })

async def handle_scan_user_address():
    logger.info(f"2. After Confirming amount: {shared_data['collected_amount']} AUD")
    async def wrapper():
        result = await scan_qr_code(timeout=40)  # Await the QR scan result
        await handle_scan_result(result is not None, result)

    asyncio.create_task(wrapper())  # Run in the background without blocking
    return "scan-wallet"


async def send_current_screen(screen, notification=None):
    global current_screen
    current_screen = screen
    await send_message("screen-change", {"screen": screen, "notification": notification})

async def handle_scan_result(success, qr_code):
    if current_screen != "scan-wallet":
        logger.info("Ignoring a scan result that arrived after the user left the scan screen")
        return

    global PRESS_THEN_RELEASE_HANDLED
    logger.info("3. After scan complete/failed")

    if success:
        logger.info("QR Code Scan Successful. Address: {qr_code}")
        shared_data["recipient_address"] = qr_code
    else:
        logger.info("QR Code Scan Failed. keep trying until timeout")
        #shared_data["recipient_address"] = "kaspa:qpp6ekunv44ffjq8757sd2qufz0tklfecc9457y7w25kmhq35r9sgec0vjru8" #default value for testing
        #return

    logger.info("UI update sent.")
    if shared_data['collected_amount'] <= 0:
        logger.info(f"Failed to transmit due to missing amount: {shared_data['collected_amount']}")
        await send_current_screen("error-page", f"${shared_data['collected_amount']:.2f}... Well, that's not much, /nbut you can add coins at any time, /nhow about now? ")
    elif shared_data['recipient_address'] == "":
        logger.info(f"Failed to transmit due to missing recipient address: { shared_data['recipient_address']}.")
        await send_current_screen("error-page", f"The recipient address is wrong or missing. Look:  { shared_data['recipient_address']}.")
    elif not success:
        logger.info("Failed to transmit due to general qr-code reading error, most likely - timeout.")
        await send_current_screen("error-page", "Ehhm...Something went wrong reading your QR-Code. /nTake your time, and hit the button to give it another try")
    else:   # All good -  Send the Kaspa
        await send_current_screen("processing")
        logger.info("4. Requesting transaction..")
        submission_result = await run_kaspa_transaction()
        if submission_result:
            logger.info("5. Transaction complete, resetting variables.")
            shared_data['collected_amount']=0
            shared_data['recipient_address']=""
            await send_message("coin-update", {
                "amount": 0,
                "total_collected": 0
            })
        logger.info("6. After transaction completed..")
        PRESS_THEN_RELEASE_HANDLED = True


async def run_kaspa_transaction():

    """Runs the Node.js script and processes its logs in real-time."""

    amount_kaspa = str(shared_data['collected_amount'] / shared_data['usd_to_aud'] / shared_data['kaspa_price'])
    logger.info(f"Prepare transmission... collected_amount: {shared_data['collected_amount']} "
       f"usd_aud: {shared_data['usd_to_aud']} "
       f"kaspa_price: {shared_data['kaspa_price']} "
       f"to send: {str(shared_data['collected_amount'] / shared_data['usd_to_aud'] / shared_data['kaspa_price'])} Kaspa")

    process = subprocess.Popen(
        ["node", SIMPLE_TRANSACTION_JS,
         "--encoding", "borsh", "--network", "mainnet",
         "--address", shared_data["recipient_address"],
                         "--amount", amount_kaspa],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    final_status = None

    # Process real-time logs
    while True:
        output = process.stdout.readline()
        if not output and process.poll() is not None:
            break  # No more output and process has ended

        output = output.strip()
        if output:
            try:
                log_entry = json.loads(output)  # Expecting JSON logs
                log_type = log_entry.get("type", "info")
                log_message = log_entry.get("message", "")

                logger.info(f"[{log_type.upper()}] {log_message}")
                await send_message("submit-log", {
                    "type": f"{log_type.upper()}",
                    "message": f"{log_message}"
                })

                # Detect final success/failure state
                if log_type == "success":
                    final_status = True
                    await send_message("submit-outcome", {
                        "result": True
                    })
                    break
                elif log_type == "error":
                    final_status = False
                    break

            except json.JSONDecodeError:
                logger.info(f"[UNKNOWN] {output}")  # Handle non-JSON outputs

    if not final_status:
        await send_message("submit-outcome", {
        "result": False
    })
    return final_status


# Global variables
signal_start_time = None  # Timestamp when the signal goes LOW
signal_end_time = None    # Timestamp when the signal goes HIGH
signal_count = 0          # To keep track of single or double signal
last_signal_time = None   # To keep track of the last signal time

# Constants
SINGLE_SIGNAL_DURATION = 30 / 1000  # 40ms in seconds
DOUBLE_SIGNAL_WINDOW = 200 / 1000  # 200ms window in seconds

def coin_signal_callback(chip, gpio, level, tick):
    global signal_start_time, signal_end_time, signal_count, last_signal_time

    # Check if the signal is going LOW (falling edge)
    if level == 0:
        # Start of signal (LOW state)
        signal_start_time = time.time()
        logger.info("Signal started (LOW).")

    # Check if the signal is going HIGH (rising edge)
    elif level == 1 and signal_start_time is not None:
        # End of signal (HIGH state)
        signal_end_time = time.time()
        signal_duration = signal_end_time - signal_start_time

        # Check if the duration is valid (within 40ms)
        if signal_duration >= SINGLE_SIGNAL_DURATION * 0.7:
            logger.info(f"Signal detected, duration: {signal_duration*1000:.2f}ms")

            # If no previous signal was counted
            if signal_count == 0:
                signal_count += 1
                last_signal_time = signal_end_time
                logger.info("Single signal detected!")

            # If a previous signal was counted and the time difference is within 200ms, it's a double signal
            elif signal_count == 1 and (signal_end_time - last_signal_time) <= DOUBLE_SIGNAL_WINDOW:
                signal_count += 1
                last_signal_time = signal_end_time
                logger.info("Double signal detected!")

            # If the signal is outside the 200ms window, reset signal count
            if (signal_end_time - last_signal_time) > DOUBLE_SIGNAL_WINDOW:
                logger.info(f"Signal count: {signal_count}")
                # Reset after the time window has passed and wait for the next signal
                signal_count = 1  # New signal detected, counting as a single
                last_signal_time = signal_end_time

    # Debugging: Print signal states (not required for final code)
    # if signal_start_time:
    logger.info(f"level: {level} Signal Start: {signal_start_time}, Signal End: {signal_end_time}, Signal Count: {signal_count}")

# Interrupt-based coin signal handler
# def coin_signal_callback(chip, gpio, level, tick):
#     if gpio == COIN_PIN and level == 1:  # Rising edge detected
#         asyncio.create_task(handle_coin_received(1))  # Assume $1 per pulse for now

# GPIO listener to handle button and coin events
async def button_listener():
    global current_screen
    while True:
        if read_button():
            logger.info("Button pressed")
            if current_screen == "insert-coin":
                current_screen = await handle_insert_coin()
            elif current_screen == "confirm-amount" or current_screen == "error-page":
                asyncio.create_task(handle_scan_user_address())  # Run it in the background
                current_screen = "scan-wallet"  # Move to the next screen immediately
                await send_message("clear-error-logs", {})
            else:
                current_screen = get_next_screen(current_screen)
            await send_message("screen-change", {"screen": current_screen})
        await read_coin_selector()
        await asyncio.sleep(0.002)

async def send_message(event, data):
    """Send a JSON-formatted message asynchronously to all connected WebSocket clients."""
    disconnected_clients = set()
    for ws in connected_clients:
        try:
            message = json.dumps({"event": event, "data": data})
            logger.info(message)
            await ws.send(message)
        except websockets.exceptions.ConnectionClosed:
            disconnected_clients.add(ws)

    # Remove disconnected clients
    connected_clients.difference_update(disconnected_clients)

# Fetching and updating data (Kaspa and USD/AUD rates) periodically
async def send_periodic_updates():
    while True:
        await asyncio.sleep(3)
        kaspa_price = kaspa_fetcher.get_data()  # Get Kaspa price
        usd_to_aud = usd_aud_fetcher.get_data()  # Get USD to AUD rate

        shared_data["kaspa_price"] = kaspa_price
        shared_data["usd_to_aud"] = usd_to_aud
        # Send the update to all connected clients
        await send_message("exchange-update", {
            "kaspa_price": kaspa_price,
            "usd_to_aud": usd_to_aud
        })

        logger.info("exchange-update:" + " kaspa_price:" + str(kaspa_price) + " usd_to_aud:" + str(usd_to_aud))
        # Wait before sending the next update (e.g., 10 minutes)
        await asyncio.sleep(10 * 60)  # Adjust as needed

async def client_handler(websocket, path=None):
    global current_screen
    logger.info("WebSocket connected. current screen:" + current_screen)
    connected_clients.add(websocket)
    try:
        # Log active connections immediately
        logger.info(f"Active connections: {len(connected_clients)}")

        # Send initial screen change message
        await send_message("screen-change", {"screen": current_screen})
        await send_periodic_updates()

        # Handle WebSocket until it closes
        await websocket.wait_closed()

    finally:
        logger.info("WebSocket disconnected. ")
        connected_clients.discard(websocket)
        # Log active connections when a client disconnects
        logger.info(f"Active connections: {len(connected_clients)}")

async def run_transaction_retries():
    process = await asyncio.create_subprocess_exec(
        "node", MONITOR_JS, "--encoding", "borsh", "--network", "mainnet",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    async def read_output(stream):
        while True:
            line = await stream.readline()
            if not line:
                break
            logger.info(f"[MONITOR] {line.decode().strip()}")

    task_stdout = asyncio.create_task(read_output(process.stdout))
    task_stderr = asyncio.create_task(read_output(process.stderr))

    await asyncio.gather(task_stdout, task_stderr)

async def main():
    server = await websockets.serve(client_handler, "0.0.0.0", 8765)
    logger.info("WebSocket server running on ws://0.0.0.0:8765")

    # asyncio.create_task(run_transaction_retries())

    # Start periodic data updates in the background
    asyncio.create_task(send_periodic_updates())

    await asyncio.gather(server.wait_closed(), button_listener())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        lgpio.gpiochip_close(chip)
        logger.info("end.")
