"""Environment-backed configuration for the SentinelEye local helper."""
from pathlib import Path
import os
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")
DATA_DIR = Path(os.getenv("SENTINEL_DATA_DIR", ROOT_DIR / "data")).expanduser().resolve()
SNAPSHOT_DIR = DATA_DIR / "snapshots"
HOST = os.getenv("HELPER_HOST", "0.0.0.0")
PORT = int(os.getenv("HELPER_PORT", "8000"))
ESP32_BASE_URL = os.getenv("ESP32_BASE_URL", "").rstrip("/")
ESP32_TIMEOUT_SECONDS = float(os.getenv("ESP32_TIMEOUT_SECONDS", "1.5"))
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "300"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))
CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
