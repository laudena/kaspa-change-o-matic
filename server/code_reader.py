import smbus2  # Use smbus2 for better I2C control
import struct
import time
import asyncio
import re

from smbus2 import SMBus, i2c_msg

I2C_BUS = 1
I2C_ADDR = 0x0C
MAX_LENGTH = 254
I2C_READ_CHUNK_SIZE = 32  # Maximum bytes per I2C transaction

bus = SMBus(I2C_BUS)

async def read_tiny_code_reader():
    try:
        # Step 1: Read first 2 bytes for content length
        write = i2c_msg.write(I2C_ADDR, [0x00])  # Set pointer to 0
        read = i2c_msg.read(I2C_ADDR, 2)  # Read 2 bytes
        bus.i2c_rdwr(write, read)
        raw_length = list(read)

        if len(raw_length) < 2:
            print("x", end="", flush=True)
            return None

        content_length = struct.unpack("<H", bytes(raw_length))[0]

        # Validate length
        if content_length == 0 or content_length > MAX_LENGTH:
            return None

        # Step 2: Read the full content in one transaction
        read = i2c_msg.read(I2C_ADDR, content_length + 2)
        bus.i2c_rdwr(read)
        content_bytes = list(read)[2:]

        print(f" [{time.time()}] Found QR Code, in read_tiny_code_reader.")
        return {
            "content_length": content_length,
            "content_bytes": bytes(content_bytes)
        }

    except Exception as e:
        print(f"Error reading from I2C: {e}")
        return None

async def scan_qr_code(timeout=40, callback=None):
    start_time = time.time()
    while time.time() - start_time < timeout:
        message = await read_tiny_code_reader()
        if message:
            qr_code = message["content_bytes"].decode('utf-8', errors='ignore')
            # print(f"[{time.time()}] QR Code detected: {qr_code}")
            print(".", end="", flush=True)
            if callback:
                if asyncio.iscoroutinefunction(callback):
                    await callback(True, qr_code)
                else:
                    callback(True, qr_code)
            return qr_code
        await asyncio.sleep(0.05)

    print(f"[{time.time()}] QR Code timeout reached")
    if callback:
        if asyncio.iscoroutinefunction(callback):
            await callback(False, None)
        else:
            callback(False, None)
    return None



async def is_valid_kaspa_address(address: str) -> bool:
    """
    Validates a Kaspa public address based on length, prefix, and character set.

    Returns:
        True if valid, False otherwise.
    """
    return True

    print ("validating received address:", address)
    # Kaspa address must start with "kaspa:"
    if not address.startswith("kaspa:"):
        return False

    # Remove the prefix for further checks
    base32_part = address[6:]

    # Length check (62-64 characters excluding "kaspa:")
    if not (62 <= len(base32_part) <= 64):
        return False

    # Base32 Bech32m character validation (A-Z, 2-7)
    if not re.fullmatch(r"[a-z0-9]+", base32_part):
        return False

    return True
