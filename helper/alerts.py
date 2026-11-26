"""Alert rate-limiting and event notification helpers."""
from __future__ import annotations
import threading
from typing import Any

_lock = threading.Lock()
_last_accepted_at = 0.0


def cooldown_accept(now: float, cooldown_seconds: int) -> tuple[bool, int]:
    """Return whether an alert may be sent, and remaining cooldown seconds."""
    global _last_accepted_at
    with _lock:
        remaining = max(0, int(cooldown_seconds - (now - _last_accepted_at)))
        if remaining:
            return False, remaining
        _last_accepted_at = now
        return True, 0


def notification_targets(settings: dict[str, Any]) -> list[str]:
    """Resolve configured destinations without logging or exposing credentials."""
    channels = settings.get("channels") or {}
    targets = []
    if channels.get("email") and settings.get("email"):
        targets.append("email")
    if channels.get("telegram") and settings.get("telegramChatId"):
        targets.append("telegram")
    return targets
