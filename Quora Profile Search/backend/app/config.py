import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Settings files, later ones win: project-root .env (shared with docker-compose), backend/.env,
# and APP_ENV_FILE — the per-user settings file the desktop app edits from its Settings page.
APP_ENV_FILE = os.environ.get("APP_ENV_FILE")
_ENV_FILES = ("../.env", ".env", *([APP_ENV_FILE] if APP_ENV_FILE else []))

# Keys the in-app Settings page may read/write (desktop mode only).
EDITABLE_KEYS = ("ai_mode", "anthropic_api_key", "search_provider", "tavily_api_key", "serper_api_key", "brave_api_key",
                 "google_api_key", "google_cse_id",
                 "reddit_client_id", "reddit_client_secret", "reddit_user_agent", "reddit_default_subreddits",
                 "github_token", "include_personal_emails")
SECRET_KEYS = {"anthropic_api_key", "tavily_api_key", "serper_api_key", "brave_api_key", "google_api_key", "reddit_client_secret", "github_token"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILES, extra="ignore")

    # Desktop mode: serve the built dashboard and allow editing settings from the UI
    static_dir: str | None = None
    settings_editable: bool = False

    database_url: str = "postgresql+psycopg://quora:quora@localhost:5432/quora_discovery"

    # Claude (Anthropic) — the SDK also reads ANTHROPIC_API_KEY from the environment directly.
    anthropic_api_key: str | None = None
    claude_model: str = "claude-opus-5-5"
    # "auto": use Claude when a key is set, otherwise the free rule-based mode. "off": always free mode.
    ai_mode: str = "auto"

    # Search engine provider. Free plans: "tavily" (monthly free credits), "serper" (free sign-up credits).
    # Also "brave" or "google" (Programmable Search / Custom Search JSON API).
    search_provider: str = "tavily"
    tavily_api_key: str | None = None
    serper_api_key: str | None = None
    brave_api_key: str | None = None
    google_api_key: str | None = None
    google_cse_id: str | None = None

    # Optional: raises GitHub API rate limits (public data only)
    github_token: str | None = None

    # Reddit official Data API (app-only OAuth). Create an app at https://www.reddit.com/prefs/apps
    # and accept Reddit's Developer Terms. Commercial use requires Reddit's approval.
    reddit_client_id: str | None = None
    reddit_client_secret: str | None = None
    reddit_user_agent: str = "web:contact-discovery:1.0 (by /u/your_reddit_username)"
    reddit_default_subreddits: str = "forhire,freelance_forhire,hireaprogrammer,jobbit"
    reddit_max_age: str = "year"  # hour|day|week|month|year|all

    # Background jobs: set to e.g. redis://redis:6379/0 to run searches on Celery workers.
    # Empty → in-process FastAPI background tasks (fine for local dev).
    celery_broker_url: str | None = None

    # Crawling etiquette for personal websites
    user_agent: str = "QuoraContactDiscoveryBot/1.0 (+research tool; respects robots.txt)"
    request_timeout: float = 10.0
    max_candidates_per_search: int = 15
    max_site_pages: int = 3  # homepage + up to N contact/about pages per website

    # Regions searched by default: "US" (United States) and/or "EU" (Europe)
    regions: str = "US,EU"
    # Keep personal addresses (gmail etc.) when the person published them themselves (post, GitHub, own site)
    include_personal_emails: bool = True

    cors_origins: str = "http://localhost:5173,http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def save_user_settings(values: dict[str, str]) -> None:
    """Write editable keys to APP_ENV_FILE (keeping other lines) and reload settings."""
    if not APP_ENV_FILE:
        raise RuntimeError("No user settings file configured")
    path = Path(APP_ENV_FILE)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = {k.upper(): v for k, v in values.items() if k in EDITABLE_KEYS}
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in pending:
            out.append(f"{key}={_quote(pending.pop(key))}")
        else:
            out.append(line)
    out += [f"{k}={_quote(v)}" for k, v in pending.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    get_settings.cache_clear()


def _quote(v: str) -> str:
    v = (v or "").strip().replace("\n", " ")
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' if any(c in v for c in " #'\"\\") else v
