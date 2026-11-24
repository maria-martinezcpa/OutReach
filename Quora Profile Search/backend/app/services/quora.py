"""Build search-engine queries that surface public Quora profiles, and parse profile URLs."""

import re
from urllib.parse import unquote, urlparse

from ..schemas import SearchRequest
from .search_engine import SearchHit

QUORA_PROFILE_RE = re.compile(r"^https?://(?:[a-z]{2}\.|www\.)?quora\.com/profile/([^/?#]+)", re.I)
US_HINT = '("United States" OR USA OR "U.S." OR California OR "New York" OR Texas OR Washington OR Florida OR Massachusetts OR Illinois)'
EU_HINT = '(Europe OR "United Kingdom" OR UK OR London OR Germany OR Berlin OR France OR Netherlands OR Spain OR Poland OR Sweden OR Ireland)'
BOTH_HINT = '("United States" OR USA OR California OR "New York" OR Texas OR Europe OR UK OR London OR Germany OR Netherlands)'


def region_hint(regions) -> str:
    regions = set(regions or ["US", "EU"])
    if regions == {"US"}:
        return US_HINT
    if regions == {"EU"}:
        return EU_HINT
    return BOTH_HINT


def profile_slug(url: str) -> str | None:
    m = QUORA_PROFILE_RE.match(url.strip())
    return unquote(m.group(1)) if m else None


def canonical_profile_url(url: str) -> str | None:
    slug = profile_slug(url)
    return f"https://www.quora.com/profile/{slug}" if slug else None


def name_from_slug(slug: str) -> str:
    """'Jane-Doe-12' -> 'Jane Doe'."""
    parts = [p for p in slug.split("-") if p and not p.isdigit()]
    return " ".join(parts)


def build_queries(req: SearchRequest) -> list[str]:
    base = "site:quora.com/profile"
    extra = []
    if req.company:
        extra.append(f'"{req.company}"')
    if req.profession:
        extra.append(f'"{req.profession}"')
    extra += [f'"{s}"' for s in req.skills[:3]]
    location = f'"{req.state}"' if req.state else region_hint(req.regions)
    q = req.query.strip()

    if req.query_type == "url":
        slug = profile_slug(q)
        if not slug:
            return []
        name = name_from_slug(slug)
        return [f'{base}/{slug}', f'{base} "{name}"']
    if req.query_type == "name":
        return [" ".join([base, f'"{q}"', *extra]), " ".join([base, f'"{q}"', *extra, location])]
    # profession / skills / company: keyword search for people, with a US location hint
    return [" ".join([base, f'"{q}"', *extra, location]), " ".join([base, q, *extra, "lives in", location])]


def quora_profile_hits(hits: list[SearchHit]) -> list[SearchHit]:
    seen: set[str] = set()
    out = []
    for h in hits:
        canon = canonical_profile_url(h.url)
        if not canon:
            continue
        # Skip sub-pages (answers/followers lists) by keeping only the canonical profile URL
        if canon.lower() in seen:
            continue
        seen.add(canon.lower())
        out.append(SearchHit(title=h.title, url=canon, snippet=h.snippet))
    return out


def looks_like_profile_host(url: str) -> bool:
    return (urlparse(url).hostname or "").endswith("quora.com")
