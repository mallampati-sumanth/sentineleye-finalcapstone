"""Small HTTP client for the ESP32's local control API."""
from __future__ import annotations
import requests


class ESP32Client:
    def __init__(self, base_url: str, timeout: float = 1.5):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(self, path: str) -> dict:
        if not self.base_url:
            raise RuntimeError("ESP32_BASE_URL is not configured")
        try:
            response = requests.get(f"{self.base_url}{path}", timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, dict) else {"ok": True}
        except (requests.RequestException, ValueError) as exc:
            raise RuntimeError(f"ESP32 request failed: {exc}") from exc

    def status(self) -> dict:
        if not self.base_url:
            return {"online": False, "alarm": False, "uptime": 0}
        try:
            data = self._request("/status")
            return {**data, "online": True}
        except RuntimeError:
            return {"online": False, "alarm": False, "uptime": 0}

    def intrusion(self) -> dict:
        return self._request("/intrusion")

    def stop(self) -> dict:
        return self._request("/stop")
