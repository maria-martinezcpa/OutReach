"""Which people the user has already looked at, stored in data/seen.json as {lowercase login: first seen at}.

People are marked when their profile is opened, when they are saved or drafted to, or by hand.
"""

import threading
from datetime import datetime, timezone
from pathlib import Path

from .storage import JsonFile


class SeenStore:
    def __init__(self, data_dir: Path):
        self.file = JsonFile(Path(data_dir) / "seen.json", {})
        self.lock = threading.RLock()

    def all(self) -> dict[str, str]:
        return self.file.read()

    def mark(self, logins: set[str]) -> int:
        """Mark these people as seen; returns how many were new. Keeps the first time each was seen."""
        with self.lock:
            data = self.file.read()
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            new = [l for l in logins if l not in data]
            for l in new:
                data[l] = now
            if new:
                self.file.write(data)
            return len(new)

    def unmark(self, logins: set[str]) -> int:
        with self.lock:
            data = self.file.read()
            gone = [l for l in logins if data.pop(l, None) is not None]
            if gone:
                self.file.write(data)
            return len(gone)
