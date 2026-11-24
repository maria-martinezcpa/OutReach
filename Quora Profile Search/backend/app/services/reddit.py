"""Reddit official Data API client (app-only OAuth, read-only, public content only).

Compliance notes (Reddit Developer Terms / Data API Terms / Responsible Builder Policy):
- Uses only the official API with a descriptive User-Agent and respects rate-limit headers.
- Reads public posts and the public profile 'about' only. No private messages, no logged-in user data.
- Does NOT attempt to re-identify pseudonymous users: we never search other sites for a Reddit
  username or guess who is behind an account. Only links/contacts the author posted are used.
- Deleted/removed content is purged by `sync_deleted` (see pipeline.purge_deleted_reddit).
"""

import re
import time
from dataclasses import dataclass

import httpx

from ..config import Settings

LINK_RE = re.compile(r"https?://[^\s)\]>\"']+", re.I)
MD_LINK_RE = re.compile(r"\[[^\]]*\]\((https?://[^)\s]+)\)")


class RedditError(RuntimeError):
    pass


@dataclass
class RedditPost:
    fullname: str  # t3_xxxx
    subreddit: str
    author: str
    title: str
    body: str
    permalink: str
    created_utc: float
    link_flair: str | None

    @property
    def url(self) -> str:
        return f"https://www.reddit.com{self.permalink}"

    @property
    def text(self) -> str:
        return f"{self.title}\n\n{self.body}".strip()


@dataclass
class RedditUser:
    name: str
    bio: str
    profile_url: str


def extract_links(text: str) -> list[str]:
    links = MD_LINK_RE.findall(text) + LINK_RE.findall(text)
    out: list[str] = []
    for link in links:
        link = link.rstrip(".,;:!?*_)")
        if link not in out:
            out.append(link)
    return out


class RedditClient:
    def __init__(self, settings: Settings):
        self.s = settings
        self._token: str | None = None
        self._token_exp = 0.0
        self.http = httpx.Client(timeout=settings.request_timeout, headers={"User-Agent": settings.reddit_user_agent})

    def _auth(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        if not (self.s.reddit_client_id and self.s.reddit_client_secret):
            raise RedditError("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set to search Reddit")
        if "your_reddit_username" in self.s.reddit_user_agent:
            raise RedditError("Put your Reddit username in the Reddit user agent setting (Reddit requires it)")
        r = self.http.post("https://www.reddit.com/api/v1/access_token",
                           auth=(self.s.reddit_client_id, self.s.reddit_client_secret),
                           data={"grant_type": "client_credentials"})
        if r.status_code != 200:
            raise RedditError(f"Reddit auth failed ({r.status_code})")
        d = r.json()
        self._token, self._token_exp = d["access_token"], time.time() + d.get("expires_in", 3600)
        return self._token

    def _get(self, path: str, params: dict | None = None) -> dict:
        r = self.http.get(f"https://oauth.reddit.com{path}", params={**(params or {}), "raw_json": 1},
                          headers={"Authorization": f"Bearer {self._auth()}"})
        remaining = float(r.headers.get("x-ratelimit-remaining", "10") or 10)
        if remaining < 2:  # stay inside Reddit's published rate limit
            time.sleep(float(r.headers.get("x-ratelimit-reset", "5") or 5))
        if r.status_code in (403, 404):
            return {}
        if r.status_code == 429:
            raise RedditError("Reddit rate limit reached; try again shortly")
        if r.status_code != 200:
            raise RedditError(f"Reddit API error ({r.status_code})")
        return r.json()

    def search_posts(self, query: str, subreddits: list[str], limit: int = 25) -> list[RedditPost]:
        subs = "+".join(re.sub(r"[^A-Za-z0-9_]", "", s) for s in subreddits if s.strip()) or "all"
        data = self._get(f"/r/{subs}/search", {"q": query, "restrict_sr": 1, "sort": "new",
                                               "t": self.s.reddit_max_age, "limit": min(limit, 100), "type": "link"})
        posts = []
        for child in data.get("data", {}).get("children", []):
            d = child.get("data", {})
            author = d.get("author")
            if not author or author in ("[deleted]", "AutoModerator") or d.get("removed_by_category"):
                continue
            if d.get("over_18"):
                continue
            posts.append(RedditPost(fullname=d.get("name", ""), subreddit=d.get("subreddit", ""), author=author,
                                    title=d.get("title", ""), body=d.get("selftext", "") or "",
                                    permalink=d.get("permalink", ""), created_utc=d.get("created_utc", 0),
                                    link_flair=d.get("link_flair_text")))
        return posts

    def get_user(self, name: str) -> RedditUser | None:
        d = self._get(f"/user/{name}/about").get("data")
        if not d or d.get("is_suspended"):
            return None
        bio = (d.get("subreddit") or {}).get("public_description", "") or ""
        return RedditUser(name=d.get("name", name), bio=bio, profile_url=f"https://www.reddit.com/user/{name}")

    def existing_fullnames(self, fullnames: list[str]) -> set[str]:
        """Which of these posts still exist and aren't deleted/removed (for retention compliance)."""
        alive: set[str] = set()
        for i in range(0, len(fullnames), 100):
            chunk = fullnames[i:i + 100]
            data = self._get("/api/info", {"id": ",".join(chunk)})
            for child in data.get("data", {}).get("children", []):
                d = child.get("data", {})
                if d.get("author") not in (None, "[deleted]") and not d.get("removed_by_category") \
                        and d.get("selftext") != "[deleted]":
                    alive.add(d.get("name"))
        return alive
