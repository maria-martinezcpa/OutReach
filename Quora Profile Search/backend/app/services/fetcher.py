"""Polite HTTP fetcher for personal/portfolio websites.

- Honors robots.txt for our user agent.
- Refuses domains whose terms prohibit automated access (Quora, LinkedIn, social networks).
- Never sends credentials or cookies, never solves CAPTCHAs, never retries around 401/403/429.
"""

import re
import time
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from ..config import Settings

# Sites we only ever see through search-engine snippets / official APIs, never fetch.
NO_FETCH_DOMAINS = {
    "quora.com", "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
    "tiktok.com", "threads.net", "github.com",  # GitHub is read via its official API instead
    "medium.com",  # only its official RSS feeds are read, via PoliteFetcher.get_feed
}
FEED_ALLOWLIST = (re.compile(r"^https://medium\.com/feed/@[A-Za-z0-9_.-]+$"),)


def registered_domain(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def is_blocked(url: str) -> bool:
    host = registered_domain(url)
    return any(host == d or host.endswith("." + d) for d in NO_FETCH_DOMAINS)


class PoliteFetcher:
    def __init__(self, settings: Settings):
        self.s = settings
        self.client = httpx.Client(
            timeout=settings.request_timeout,
            follow_redirects=True,
            headers={"User-Agent": settings.user_agent, "Accept": "text/html,application/xhtml+xml"},
        )
        self._robots: dict[str, RobotFileParser | None] = {}
        self._last_hit: dict[str, float] = {}

    def _robots_for(self, url: str) -> RobotFileParser | None:
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = RobotFileParser()
            try:
                r = self.client.get(urljoin(base, "/robots.txt"))
                if r.status_code in (401, 403):
                    rp.parse(["User-agent: *", "Disallow: /"])  # access restricted → treat as disallowed
                elif r.status_code >= 400:
                    rp.parse([])  # no robots.txt → allowed
                else:
                    rp.parse(r.text.splitlines())
            except httpx.HTTPError:
                rp = None
            self._robots[base] = rp
        return self._robots[base]

    def allowed(self, url: str) -> bool:
        if is_blocked(url) or urlparse(url).scheme not in ("http", "https"):
            return False
        rp = self._robots_for(url)
        return rp is not None and rp.can_fetch(self.s.user_agent, url)

    def get_feed(self, url: str) -> str | None:
        """Fetch an official RSS feed on the allowlist (robots.txt still applies). Returns XML text or None."""
        if not any(p.match(url) for p in FEED_ALLOWLIST):
            return None
        rp = self._robots_for(url)
        if rp is None or not rp.can_fetch(self.s.user_agent, url):
            return None
        self._throttle(url)
        try:
            r = self.client.get(url, headers={"Accept": "application/rss+xml, application/xml, text/xml"})
        except httpx.HTTPError:
            return None
        if r.status_code != 200 or "xml" not in r.headers.get("content-type", ""):
            return None
        return r.text[:2_000_000]

    def _throttle(self, url: str) -> None:
        host = registered_domain(url)
        wait = 1.0 - (time.monotonic() - self._last_hit.get(host, 0))
        if wait > 0:
            time.sleep(wait)  # at most 1 request/second per host
        self._last_hit[host] = time.monotonic()

    def get_html(self, url: str) -> tuple[str, str] | None:
        """Return (final_url, html) or None if not permitted / not available."""
        if not self.allowed(url):
            return None
        self._throttle(url)
        try:
            r = self.client.get(url)
        except httpx.HTTPError:
            return None
        if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
            return None  # includes 401/403/429: we do not attempt to get around access controls
        final = str(r.url)
        if is_blocked(final):
            return None
        return final, r.text[:2_000_000]
