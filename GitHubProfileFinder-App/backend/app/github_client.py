"""Async GitHub REST client with throttling, rate-limit detection and retry/backoff."""

import asyncio
import logging
import time
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

API_URL = "https://api.github.com"


class GitHubError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


class RateLimitError(GitHubError):
    def __init__(self, reset_at: Optional[int], message: str = "GitHub API rate limit reached"):
        super().__init__(message, 429)
        self.reset_at = reset_at


def quota_from_headers(r: httpx.Response) -> Optional[dict]:
    """Quota as reported by GitHub on a real API response (limit, used, remaining, reset, observed_at)."""
    h = r.headers
    if not h.get("x-ratelimit-resource") or h.get("x-ratelimit-remaining") is None:
        return None
    limit, remaining = int(h.get("x-ratelimit-limit", 0)), int(h["x-ratelimit-remaining"])
    return {"limit": limit, "remaining": remaining, "used": int(h.get("x-ratelimit-used", limit - remaining)),
            "reset": int(h.get("x-ratelimit-reset", 0)), "observed_at": int(time.time())}


class GitHubClient:
    def __init__(
        self,
        token: str = "",
        client: Optional[httpx.AsyncClient] = None,
        max_retries: int = 3,
        concurrency: int = 8,
        backoff_base: float = 1.0,
    ):
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "github-profile-finder",
        }
        self._client = client or httpx.AsyncClient(base_url=API_URL, timeout=20)
        self._client.headers.update(headers)
        self._sem = asyncio.Semaphore(concurrency)
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        # Quota per resource ("core", "search") from the x-ratelimit-* headers of real responses. GitHub's
        # /rate_limit endpoint can report stale numbers (0 used while calls are being counted), so these are
        # the values shown in the app.
        self.rate: dict[str, dict[str, int]] = {}
        self.set_token(token)

    def set_token(self, token: str) -> None:
        """Switch the token used for all following requests (takes effect immediately)."""
        if token:
            self._client.headers["Authorization"] = f"Bearer {token}"
        else:
            self._client.headers.pop("Authorization", None)
        self.has_token = bool(token)
        self.rate = {}

    async def close(self) -> None:
        await self._client.aclose()

    def _track(self, r: httpx.Response) -> None:
        quota = quota_from_headers(r)
        if quota:
            self.rate[r.headers["x-ratelimit-resource"]] = quota

    def live_rate(self, resource: str) -> Optional[dict]:
        """The last quota seen for this resource, unless its window has reset since."""
        q = self.rate.get(resource)
        return q if q and q["reset"] > time.time() else None

    async def current_rate(self) -> dict:
        """Real quota for the current token. Uses what recent requests reported; only when there is nothing
        current does it make one small request (at most about once per hour while idle)."""
        if not self.live_rate("core"):
            # /user works for personal tokens; installation tokens get 403, which still carries the headers.
            await self._get("/user" if self.has_token else "/users/octocat", none_on=(401, 403, 404))
        return {"core": self.live_rate("core"), "search": self.live_rate("search")}

    async def _sleep_backoff(self, attempt: int, seconds: Optional[float] = None) -> None:
        await asyncio.sleep(seconds if seconds is not None else self.backoff_base * 2**attempt)

    async def _get(
        self,
        path: str,
        params: Optional[dict[str, Any]] = None,
        accept: Optional[str] = None,
        none_on: tuple[int, ...] = (),
    ) -> Optional[httpx.Response]:
        headers = {"Accept": accept} if accept else None
        for attempt in range(self.max_retries + 1):
            async with self._sem:
                try:
                    r = await self._client.get(path, params=params, headers=headers)
                except httpx.TransportError as e:
                    if attempt >= self.max_retries:
                        raise GitHubError(f"Network error contacting GitHub: {e}") from e
                    await self._sleep_backoff(attempt)
                    continue
            self._track(r)

            if r.status_code in none_on:
                return None
            if r.status_code in (403, 429):
                reset = int(r.headers.get("x-ratelimit-reset", 0)) or None
                if r.headers.get("x-ratelimit-remaining") == "0":
                    raise RateLimitError(reset)
                retry_after = r.headers.get("retry-after")
                if retry_after or "rate limit" in r.text.lower():
                    wait = float(retry_after) if retry_after else self.backoff_base * 2 ** (attempt + 1)
                    if attempt < self.max_retries and wait <= 60:
                        log.warning("GitHub secondary rate limit, retrying in %.0fs", wait)
                        await self._sleep_backoff(attempt, wait)
                        continue
                    raise RateLimitError(reset, "GitHub secondary rate limit reached. Wait a minute and retry.")
                raise GitHubError(f"GitHub refused the request ({r.status_code}): {_message(r)}")
            if r.status_code >= 500:
                if attempt < self.max_retries:
                    await self._sleep_backoff(attempt)
                    continue
                raise GitHubError(f"GitHub server error ({r.status_code})")
            if r.status_code == 422:
                raise GitHubError(f"GitHub rejected the query: {_message(r)}", 400)
            if r.status_code == 404:
                raise GitHubError("Not found on GitHub", 404)
            if r.status_code >= 400:
                raise GitHubError(f"GitHub error {r.status_code}: {_message(r)}")
            return r
        raise GitHubError("GitHub request failed after retries")

    # --- Endpoints -------------------------------------------------------

    async def search_users(self, q: str, page: int, per_page: int) -> dict:
        r = await self._get("/search/users", {"q": q, "page": page, "per_page": per_page})
        return r.json()

    async def search_repos(self, q: str, page: int, per_page: int) -> dict:
        r = await self._get(
            "/search/repositories",
            {"q": q, "page": page, "per_page": per_page, "sort": "updated", "order": "desc"},
        )
        return r.json()

    async def user(self, login: str) -> dict:
        return (await self._get(f"/users/{login}")).json()

    async def followers(self, login: str, page: int, per_page: int) -> list[dict]:
        r = await self._get(f"/users/{login}/followers", {"page": page, "per_page": per_page})
        return r.json()

    async def social_accounts(self, login: str) -> list[dict]:
        r = await self._get(f"/users/{login}/social_accounts", none_on=(404,))
        return r.json() if r else []

    async def repos(self, login: str) -> list[dict]:
        r = await self._get(
            f"/users/{login}/repos",
            {"sort": "pushed", "direction": "desc", "per_page": 100, "type": "owner"},
        )
        return r.json()

    async def profile_readme(self, login: str) -> Optional[str]:
        """The special <login>/<login> repository README, written by the user about themselves."""
        r = await self._get(
            f"/repos/{login}/{login}/readme",
            accept="application/vnd.github.raw+json",
            none_on=(404, 403),
        )
        return r.text[:20000] if r else None

    async def commit_dates(self, owner: str, repo: str, author: str, since: str, until: str) -> list[str]:
        """Author dates of commits by `author` in the repo within [since, until]; at most 100."""
        r = await self._get(
            f"/repos/{owner}/{repo}/commits",
            {"author": author, "since": since, "until": until, "per_page": 100},
            none_on=(404, 409, 451),  # 409 = empty repository
        )
        if not r:
            return []
        return [
            ((c.get("commit") or {}).get("author") or {}).get("date") or ""
            for c in r.json()
        ]

    async def search_commits(self, q: str, page: int, per_page: int) -> dict:
        r = await self._get(
            "/search/commits",
            {"q": q, "page": page, "per_page": per_page, "sort": "author-date", "order": "desc"},
        )
        return r.json()

    async def search_topics(self, q: str, page: int = 1, per_page: int = 30) -> dict:
        r = await self._get("/search/topics", {"q": q, "page": page, "per_page": per_page})
        return r.json()

    async def rate_limit(self) -> dict:
        return (await self._get("/rate_limit")).json()


def _message(r: httpx.Response) -> str:
    try:
        return r.json().get("message", r.text[:200])
    except ValueError:
        return r.text[:200]
