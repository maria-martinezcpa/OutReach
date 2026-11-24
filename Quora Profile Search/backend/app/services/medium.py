"""Medium author discovery.

Like Quora, Medium is never crawled: author pages are found through the search-engine
API (title/snippet only), and the only thing fetched from Medium is the author's
official public RSS feed (https://medium.com/feed/@username), which Medium publishes
for machine reading. The feed gives the author's display name and recent article
titles/tags. Medium's robots.txt is still honored for the feed.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import unquote, urlparse

from ..schemas import SearchRequest
from .quora import region_hint
from .search_engine import SearchHit

# medium.com/@user[/...]  or  user.medium.com[/...]
AT_RE = re.compile(r"^https?://(?:www\.)?medium\.com/@([A-Za-z0-9_.-]+)(/[^?#]*)?", re.I)
SUB_RE = re.compile(r"^https?://([a-z0-9-]+)\.medium\.com(/[^?#]*)?", re.I)
RESERVED_SUBDOMAINS = {"www", "help", "policy", "blog", "about", "jobs", "careers", "status", "link", "cdn",
                       "miro", "glyph", "api", "events", "partner", "business"}
FEED_TITLE_RE = re.compile(r"^Stories by (.+?) on Medium$")


@dataclass
class MediumAuthor:
    username: str
    profile_url: str
    profile_snippets: list[str] = field(default_factory=list)  # snippets of the author's own profile page
    article_snippets: list[str] = field(default_factory=list)  # snippets of articles they wrote
    display_name: str | None = None  # from the RSS feed title
    recent_titles: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)

    def text(self) -> str:
        parts = []
        if self.display_name:
            parts.append(f"Display name (from the author's Medium RSS feed): {self.display_name}")
        if self.profile_snippets:
            parts.append("Author profile page (search result):\n" + "\n".join(self.profile_snippets))
        if self.article_snippets:
            parts.append("Articles by this author (search results):\n" + "\n".join(self.article_snippets[:4]))
        if self.recent_titles:
            parts.append("Recent article titles: " + "; ".join(self.recent_titles[:8]))
        if self.topics:
            parts.append("Article tags: " + ", ".join(self.topics[:15]))
        return "\n\n".join(parts)


def parse_medium_url(url: str) -> tuple[str, bool] | None:
    """Return (username, is_profile_page) for a Medium author/article URL, else None."""
    m = AT_RE.match(url.strip())
    if m:
        rest = (m.group(2) or "").strip("/")
        return unquote(m.group(1)), rest in ("", "about")
    m = SUB_RE.match(url.strip())
    if m and m.group(1).lower() not in RESERVED_SUBDOMAINS:
        rest = (m.group(2) or "").strip("/")
        return m.group(1).lower(), rest in ("", "about")
    return None


def profile_url(username: str) -> str:
    return f"https://medium.com/@{username}"


def feed_url(username: str) -> str:
    return f"https://medium.com/feed/@{username}"


def build_queries(req: SearchRequest) -> list[str]:
    extra = []
    if req.company:
        extra.append(f'"{req.company}"')
    if req.profession:
        extra.append(f'"{req.profession}"')
    extra += [f'"{s}"' for s in req.skills[:3]]
    location = f'"{req.state}"' if req.state else region_hint(req.regions)
    q = req.query.strip()

    if req.query_type == "url":
        parsed = parse_medium_url(q)
        if not parsed:
            return []
        return [f'site:medium.com "@{parsed[0]}"']
    if req.query_type == "name":
        return [" ".join(["site:medium.com", f'"{q}"', *extra])]
    # Profile pages first (their snippet is the author's bio), then articles as a fallback
    return [" ".join(["site:medium.com/@", f'"{q}"', *extra, location]),
            " ".join(["site:medium.com", f'"{q}"', *extra, '("based in" OR "I\'m a" OR "I am a")', location])]


def group_by_author(hits: list[SearchHit]) -> dict[str, MediumAuthor]:
    authors: dict[str, MediumAuthor] = {}
    for h in hits:
        parsed = parse_medium_url(h.url)
        if not parsed:
            continue
        user, is_profile = parsed
        a = authors.setdefault(user.lower(), MediumAuthor(username=user, profile_url=profile_url(user)))
        line = f"{h.title} — {h.snippet}".strip(" —")
        (a.profile_snippets if is_profile else a.article_snippets).append(line)
    return authors


def parse_feed(xml_text: str) -> tuple[str | None, list[str], list[str]]:
    """(display_name, recent article titles, tags) from a Medium RSS feed."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None, [], []
    channel = root.find("channel")
    if channel is None:
        return None, [], []
    m = FEED_TITLE_RE.match((channel.findtext("title") or "").strip())
    name = m.group(1).strip() if m else None
    titles, tags = [], []
    for item in channel.findall("item")[:10]:
        if (t := (item.findtext("title") or "").strip()):
            titles.append(t)
        for c in item.findall("category"):
            if c.text and c.text.strip() not in tags:
                tags.append(c.text.strip())
    return name, titles, tags


def is_medium(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "medium.com" or host.endswith(".medium.com")
