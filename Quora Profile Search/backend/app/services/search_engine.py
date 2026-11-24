"""Search-engine API providers.

Profiles are discovered through official search APIs (Brave Search API or Google
Programmable Search). We never crawl Quora or LinkedIn directly: their terms of
service forbid automated access, so only the title/snippet/URL the search engine
returns for those sites is used.
"""

import re
import time
from dataclasses import dataclass

import httpx

from ..config import Settings


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str


class SearchEngineError(RuntimeError):
    pass


RETRIES = 3
SEARCH_TIMEOUT = 30.0  # search APIs can be slower than ordinary page fetches


class SearchEngine:
    def __init__(self, settings: Settings):
        self.s = settings
        self.client = httpx.Client(timeout=max(settings.request_timeout, SEARCH_TIMEOUT),
                                  headers={"User-Agent": settings.user_agent})

    def provider(self) -> str:
        """The selected provider, or — if its key is missing — the first provider whose key is set."""
        keys = {"tavily": (self.s.tavily_api_key,), "serper": (self.s.serper_api_key,), "brave": (self.s.brave_api_key,),
                "google": (self.s.google_api_key, self.s.google_cse_id)}
        chosen = (self.s.search_provider or "tavily").lower()
        if chosen in keys and not all(keys[chosen]):
            chosen = next((p for p, k in keys.items() if all(k)), chosen)
        return chosen

    def search(self, query: str, count: int = 10) -> list[SearchHit]:
        provider = self.provider()
        call = {"brave": self._brave, "google": self._google, "tavily": self._tavily, "serper": self._serper}.get(provider)
        if not call:
            raise SearchEngineError(f"Unknown SEARCH_PROVIDER '{self.s.search_provider}'")
        # Search APIs occasionally time out or drop the connection: retry a few times before giving up
        for attempt in range(RETRIES):
            try:
                return call(query, count)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                if attempt == RETRIES - 1:
                    raise SearchEngineError(f"Couldn't reach the {provider} search service "
                                            f"({type(e).__name__}). Check your internet connection and try again.") from e
                time.sleep(1.5 * (attempt + 1))
        return []

    def _tavily(self, query: str, count: int) -> list[SearchHit]:
        """Tavily Search API (free monthly credits). site:/-site: operators become domain filters."""
        if not self.s.tavily_api_key:
            raise SearchEngineError("TAVILY_API_KEY is not set")
        q, include, exclude = split_site_operators(query)
        body = {"query": q or query, "max_results": min(count, 20), "search_depth": "basic", "topic": "general"}
        if include:
            body["include_domains"] = include
        if exclude:
            body["exclude_domains"] = exclude
        r = self.client.post("https://api.tavily.com/search", json=body,
                             headers={"Authorization": f"Bearer {self.s.tavily_api_key}"})
        if r.status_code != 200:
            raise SearchEngineError(f"Tavily search failed ({r.status_code}): {r.text[:200]}")
        return [SearchHit(title=x.get("title", ""), url=x.get("url", ""), snippet=(x.get("content") or "")[:600])
                for x in r.json().get("results", []) if x.get("url")]

    def _serper(self, query: str, count: int) -> list[SearchHit]:
        """Serper.dev Google Search API (free sign-up credits). Supports Google operators as-is.
        Free accounts reject num > 10 together with site: ("Query pattern not allowed for free accounts"),
        so we always ask for at most 10 results."""
        if not self.s.serper_api_key:
            raise SearchEngineError("SERPER_API_KEY is not set")
        r = self.client.post("https://google.serper.dev/search",
                             json={"q": query, "num": min(count, 10), "gl": "us", "hl": "en"},
                             headers={"X-API-KEY": self.s.serper_api_key})
        if r.status_code != 200:
            raise SearchEngineError(f"Serper search failed ({r.status_code}): {r.text[:200]}")
        return [SearchHit(title=x.get("title", ""), url=x.get("link", ""), snippet=x.get("snippet", ""))
                for x in r.json().get("organic", []) if x.get("link")]

    def _brave(self, query: str, count: int) -> list[SearchHit]:
        if not self.s.brave_api_key:
            raise SearchEngineError("BRAVE_API_KEY is not set")
        r = self.client.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": min(count, 20), "country": "us", "search_lang": "en"},
            headers={"X-Subscription-Token": self.s.brave_api_key, "Accept": "application/json"},
        )
        if r.status_code != 200:
            raise SearchEngineError(f"Brave search failed ({r.status_code}): {r.text[:200]}")
        results = r.json().get("web", {}).get("results", [])
        return [
            SearchHit(title=x.get("title", ""), url=x.get("url", ""), snippet=_strip_tags(x.get("description", "")))
            for x in results
            if x.get("url")
        ]

    def _google(self, query: str, count: int) -> list[SearchHit]:
        if not (self.s.google_api_key and self.s.google_cse_id):
            raise SearchEngineError("GOOGLE_API_KEY and GOOGLE_CSE_ID must be set")
        r = self.client.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": self.s.google_api_key, "cx": self.s.google_cse_id, "q": query,
                    "num": min(count, 10)},
        )
        if r.status_code != 200:
            raise SearchEngineError(f"Google search failed ({r.status_code}): {r.text[:200]}")
        return [
            SearchHit(title=x.get("title", ""), url=x.get("link", ""), snippet=x.get("snippet", ""))
            for x in r.json().get("items", [])
            if x.get("link")
        ]


SITE_OP = re.compile(r"(-?)site:(\S+)", re.I)


def split_site_operators(query: str) -> tuple[str, list[str], list[str]]:
    """'site:quora.com/profile "x" -site:x.com' → ('"x"', ['quora.com'], ['x.com']).
    Paths are dropped (domain filters only); callers already re-check result URLs."""
    include, exclude = [], []
    for neg, target in SITE_OP.findall(query):
        domain = target.split("/")[0].lower()
        (exclude if neg else include).append(domain)
    rest = " ".join(SITE_OP.sub(" ", query).split())
    return rest, list(dict.fromkeys(include)), list(dict.fromkeys(exclude))


def _strip_tags(text: str) -> str:
    import re

    return re.sub(r"<[^>]+>", "", text or "")
