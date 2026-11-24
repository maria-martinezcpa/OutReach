"""GitHub tokens managed from the app.

Tokens live in data/tokens.json on this computer (never sent to the browser; the API only returns a masked
form). The token from backend/.env, if any, is listed as a read-only entry. Exactly one token is active: the
GitHub client uses it for every request, and switching takes effect immediately.
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from pydantic import BaseModel

from .github_client import quota_from_headers

ENV_ID = "env"
APP_ID = "github-app"  # the GitHub App installation token, see github_app.py


class TokenInfo(BaseModel):
    id: str
    label: str
    masked: str
    login: Optional[str] = None
    source: str  # "app" | "env" | "github_app"
    active: bool = False
    added_at: Optional[str] = None
    valid: Optional[bool] = None
    error: Optional[str] = None
    core: Optional[dict] = None
    search: Optional[dict] = None


class TokenCreate(BaseModel):
    token: str
    label: str = ""


def mask(token: str) -> str:
    return f"{token[:4]}…{token[-4:]}" if len(token) > 12 else "…"


async def check_token(token: str, client: Optional[httpx.AsyncClient] = None) -> dict:
    """Ask GitHub who owns the token and how much quota it has left (costs one core request)."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
               "User-Agent": "github-profile-finder"}
    own = client is None
    client = client or httpx.AsyncClient(base_url="https://api.github.com", timeout=15)
    try:
        r = await client.get("/rate_limit", headers=headers)
        if r.status_code == 401:
            return {"valid": False, "error": "GitHub rejected this token (revoked, expired or mistyped)"}
        if r.status_code >= 400:
            return {"valid": None, "error": f"GitHub answered {r.status_code}"}
        # /rate_limit can report stale numbers, so the core quota comes from the headers of a real request.
        # Search quota is only known after a search with this token (it resets every minute anyway).
        u = await client.get("/user", headers=headers)
        login = u.json().get("login") if u.status_code == 200 else None
        return {"valid": True, "login": login, "core": quota_from_headers(u), "search": None}
    except httpx.HTTPError as e:
        return {"valid": None, "error": f"Could not reach GitHub: {e}"}
    finally:
        if own:
            await client.aclose()


class TokenStore:
    def __init__(self, data_dir: Path, env_token: str = ""):
        self.path = Path(data_dir) / "tokens.json"
        self.env_token = env_token.strip()
        self.lock = threading.RLock()
        self.github_app_configured = False

    def _ids(self) -> set[str]:
        return {e["id"] for e in self.entries()} | ({APP_ID} if self.github_app_configured else set())

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"active": ENV_ID if self.env_token else None, "tokens": []}

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def entries(self) -> list[dict]:
        """All tokens including the .env one, as {id, token, label, source, added_at, login}."""
        data = self._read()
        out = []
        if self.env_token:
            out.append({"id": ENV_ID, "token": self.env_token, "label": "From backend/.env", "source": "env",
                        "added_at": None, "login": None})
        out += [{**t, "source": "app"} for t in data["tokens"]]
        return out

    def active_id(self) -> Optional[str]:
        data = self._read()
        ids = self._ids()
        if data.get("active") in ids:
            return data["active"]
        # Prefer the GitHub App (higher limits), then .env, then the first saved token.
        for preferred in (APP_ID, ENV_ID):
            if preferred in ids:
                return preferred
        return next((e["id"] for e in self.entries()), None)

    def active_token(self) -> str:
        aid = self.active_id()
        return next((e["token"] for e in self.entries() if e["id"] == aid), "")

    def add(self, token: str, label: str, login: Optional[str]) -> str:
        with self.lock:
            data = self._read()
            if token == self.env_token or any(t["token"] == token for t in data["tokens"]):
                raise ValueError("This token is already added")
            tid = uuid.uuid4().hex[:8]
            data["tokens"].append({
                "id": tid, "token": token, "label": label.strip() or (f"@{login}" if login else "Token"),
                "login": login, "added_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            })
            if not data.get("active") or data["active"] not in self._ids():
                data["active"] = tid
            self._write(data)
            return tid

    def activate(self, tid: str) -> None:
        with self.lock:
            if tid not in self._ids():
                raise KeyError(tid)
            data = self._read()
            data["active"] = tid
            self._write(data)

    def delete(self, tid: str) -> None:
        with self.lock:
            if tid == ENV_ID:
                raise ValueError("The .env token can only be removed by editing backend/.env")
            data = self._read()
            before = len(data["tokens"])
            data["tokens"] = [t for t in data["tokens"] if t["id"] != tid]
            if len(data["tokens"]) == before:
                raise KeyError(tid)
            if data.get("active") == tid:
                data["active"] = None
            self._write(data)
