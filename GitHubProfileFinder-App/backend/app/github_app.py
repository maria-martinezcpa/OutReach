"""Authenticate as a GitHub App installation.

GitHub issues installation access tokens to a GitHub App: the app signs a short-lived JWT with its private key
and exchanges it for a token that is valid for one hour. This module creates those tokens and renews them
automatically before they expire. GitHub App installations get higher, scaled rate limits (up to 12,500
requests/hour) than a personal access token.

Configuration (App ID, installation ID, private key) lives in data/github_app.json on this computer and is
never sent to the browser. It can also come from backend/.env (GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID,
GITHUB_APP_PRIVATE_KEY_PATH).
"""

import asyncio
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
import jwt

API_URL = "https://api.github.com"
RENEW_BEFORE = 10 * 60  # renew when less than 10 minutes remain


class GitHubAppError(Exception):
    pass


def _headers(auth: str) -> dict:
    return {"Authorization": auth, "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "github-profile-finder"}


def _message(r: httpx.Response) -> str:
    try:
        return r.json().get("message", r.text[:200])
    except ValueError:
        return r.text[:200]


class GitHubAppAuth:
    def __init__(self, app_id: str, private_key: str, installation_id: Optional[str] = None,
                 client: Optional[httpx.AsyncClient] = None):
        self.app_id = str(app_id).strip()
        self.private_key = private_key.strip() + "\n"
        self.installation_id = str(installation_id).strip() if installation_id else None
        self._client = client
        self._token: Optional[str] = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()
        self.app_name: Optional[str] = None
        self.account: Optional[str] = None

    def _jwt(self) -> str:
        now = int(time.time())
        try:
            return jwt.encode({"iat": now - 60, "exp": now + 540, "iss": self.app_id}, self.private_key,
                              algorithm="RS256")
        except (ValueError, TypeError, jwt.PyJWTError) as e:
            raise GitHubAppError(f"The private key could not be used: {e}") from e

    async def _request(self, method: str, path: str) -> httpx.Response:
        client = self._client or httpx.AsyncClient(base_url=API_URL, timeout=20)
        try:
            return await client.request(method, path, headers=_headers(f"Bearer {self._jwt()}"))
        except httpx.HTTPError as e:
            raise GitHubAppError(f"Could not reach GitHub: {e}") from e
        finally:
            if self._client is None:
                await client.aclose()

    async def _find_installation(self) -> None:
        r = await self._request("GET", "/app")
        if r.status_code == 401:
            raise GitHubAppError("GitHub rejected the App ID or private key")
        if r.status_code >= 400:
            raise GitHubAppError(f"GitHub answered {r.status_code}: {_message(r)}")
        self.app_name = r.json().get("name")
        if self.installation_id:
            return
        r = await self._request("GET", "/app/installations")
        installs = r.json() if r.status_code == 200 else []
        if not installs:
            raise GitHubAppError("The GitHub App is not installed on any account yet. Install it, then try again.")
        self.installation_id = str(installs[0]["id"])
        self.account = (installs[0].get("account") or {}).get("login")

    async def token(self, force: bool = False) -> str:
        """Current installation token, renewed automatically when it is about to expire."""
        async with self._lock:
            if not force and self._token and self._expires_at - time.time() > RENEW_BEFORE:
                return self._token
            if not self.app_name or not self.installation_id:
                await self._find_installation()
            r = await self._request("POST", f"/app/installations/{self.installation_id}/access_tokens")
            if r.status_code == 401:
                raise GitHubAppError("GitHub rejected the App ID or private key")
            if r.status_code == 404:
                raise GitHubAppError("Installation not found. Check the installation ID.")
            if r.status_code >= 400:
                raise GitHubAppError(f"GitHub answered {r.status_code}: {_message(r)}")
            body = r.json()
            self._token = body["token"]
            self._expires_at = datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00")).timestamp()
            return self._token

    @property
    def expires_at(self) -> Optional[str]:
        if not self._token:
            return None
        return datetime.fromtimestamp(self._expires_at).astimezone().isoformat(timespec="seconds")

    def needs_renewal(self) -> bool:
        return not self._token or self._expires_at - time.time() <= RENEW_BEFORE


class GitHubAppConfig:
    """Stores the GitHub App settings in data/github_app.json (the data directory is git-ignored)."""

    def __init__(self, data_dir: Path, env_app_id: str = "", env_installation_id: str = "", env_key_path: str = ""):
        self.path = Path(data_dir) / "github_app.json"
        self.env = {"app_id": env_app_id, "installation_id": env_installation_id, "key_path": env_key_path}

    def load(self) -> Optional[dict]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if data.get("app_id") and data.get("private_key"):
                return {**data, "source": "app"}
        except (OSError, ValueError):
            pass
        if self.env["app_id"] and self.env["key_path"]:
            try:
                key = Path(self.env["key_path"]).read_text(encoding="utf-8")
            except OSError:
                return None
            return {"app_id": self.env["app_id"], "installation_id": self.env["installation_id"] or None,
                    "private_key": key, "source": "env"}
        return None

    def save(self, app_id: str, installation_id: Optional[str], private_key: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"app_id": app_id, "installation_id": installation_id,
                                   "private_key": private_key}), encoding="utf-8")
        os.replace(tmp, self.path)

    def delete(self) -> None:
        self.path.unlink(missing_ok=True)
