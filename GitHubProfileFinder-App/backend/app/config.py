from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    github_token: str = ""
    # Optional GitHub App (can also be configured on the Tokens page).
    github_app_id: str = ""
    github_app_installation_id: str = ""
    github_app_private_key_path: str = ""
    data_dir: Path = BASE_DIR / "data"
    cache_ttl_hours: int = 24
    # Max repositories per profile checked for commits inside the search period.
    period_repo_check_limit: int = 6
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")


settings = Settings()
