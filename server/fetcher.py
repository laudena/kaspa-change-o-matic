import threading
import time
import requests

class DataFetcher:
    """A robust threaded fetcher that retries every 2 minutes on failure."""

    def __init__(self, name, url, key=None, sub_key=None, interval_minutes=10, retry_minutes=2):
        """
        :param name: Identifier for logging/debugging.
        :param url: API endpoint to fetch data from.
        :param key: Top-level JSON key to extract.
        :param sub_key: (Optional) Nested key inside `key`, e.g., "AUD" inside "rates".
        :param interval_minutes: Normal fetch interval (in minutes).
        :param retry_minutes: Retry interval if data fetch fails.
        """
        self.name = name
        self.url = url
        self.key = key
        self.sub_key = sub_key
        self.interval = interval_minutes * 60  # Normal interval (seconds)
        self.retry_interval = retry_minutes * 60  # Retry interval (seconds)
        self.data = None  # Stores last known good value
        self.last_fetched = None  # Timestamp of last successful fetch
        self.thread = threading.Thread(target=self._fetch_periodically, daemon=True)

    def fetch(self):
        """Fetches data from the API and updates the internal state."""
        try:
            response = requests.get(self.url, headers={"accept": "application/json"}, timeout=10)
            response.raise_for_status()
            data = response.json()

            # Extract relevant data
            new_data = None
            if self.key:
                extracted_data = data.get(self.key, {})
                new_data = extracted_data.get(self.sub_key) if self.sub_key else extracted_data
            else:
                new_data = data

            # If valid data is found, update the stored value
            if new_data is not None:
                self.data = new_data
                self.last_fetched = time.time()  # Update timestamp
                print(f"[{self.name}] ✅ Updated data: {self.data}")

        except requests.RequestException as e:
            print(f"[{self.name}] ⚠️ Fetch failed: {e}. Retrying in {self.retry_interval//60} minutes...")

    def _fetch_periodically(self):
        """Runs fetch() at regular intervals, retrying every 2 minutes on failure."""
        while True:
            self.fetch()
            if self.data is None:
                time.sleep(self.retry_interval)  # Retry in 2 min if failed
            else:
                time.sleep(self.interval)  # Normal interval

    def start(self):
        """Starts the background fetch thread."""
        self.thread.start()

    def get_data(self):
        """Returns the last known good value."""
        return self.data
