"""GitHub lookups through the official REST API (public profile fields only)."""

from dataclasses import dataclass

import httpx

from ..config import Settings


@dataclass
class GitHubUser:
    login: str
    html_url: str
    name: str | None
    company: str | None
    blog: str | None
    location: str | None
    email: str | None  # only present when the user chose to make it public
    bio: str | None
    twitter: str | None


class GitHubClient:
    def __init__(self, settings: Settings):
        headers = {"Accept": "application/vnd.github+json", "User-Agent": settings.user_agent,
                   "X-GitHub-Api-Version": "2022-11-28"}
        if settings.github_token:
            headers["Authorization"] = f"Bearer {settings.github_token}"
        self.client = httpx.Client(base_url="https://api.github.com", timeout=settings.request_timeout, headers=headers)

    def search_users(self, full_name: str, limit: int = 3) -> list[str]:
        r = self.client.get("/search/users", params={"q": f'fullname:"{full_name}" type:user', "per_page": limit})
        if r.status_code != 200:
            return []  # rate limited or unavailable — skip quietly
        return [i["login"] for i in r.json().get("items", [])[:limit]]

    def get_user(self, login: str) -> GitHubUser | None:
        r = self.client.get(f"/users/{login}")
        if r.status_code != 200:
            return None
        d = r.json()
        return GitHubUser(
            login=d["login"], html_url=d["html_url"], name=d.get("name"), company=d.get("company"),
            blog=d.get("blog") or None, location=d.get("location"), email=d.get("email"),
            bio=d.get("bio"), twitter=d.get("twitter_username"),
        )
