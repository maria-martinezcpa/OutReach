"""File-based persistence: JSON documents for the cache and saved profiles, CSV/JSON exports.

Layout under the data directory:
  profiles_cache.json     GitHub data fetched recently (keyed by GitHub user id)
  saved_profiles.json     profiles the user saved (kept in sync on every change)
  saved_profiles.csv      the same saved profiles as a spreadsheet
  search_history.json     recent searches
"""

import csv
import io
import json
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

from .models import Profile, SavedEntry

CSV_FIELDS = [
    "username", "name", "roles", "email", "phone", "linkedin", "telegram", "github_url", "website", "other_links",
    "location", "country", "region", "continent", "company", "followers", "public_repos", "account_created", "languages", "skills",
    "human_confidence", "activity_status", "last_push", "period_commits", "contact_sources", "saved_at", "note",
    "status", "follow_up",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class JsonFile:
    def __init__(self, path: Path, default):
        self.path = path
        self.default = default
        self.lock = threading.RLock()

    def read(self):
        with self.lock:
            if not self.path.exists():
                return json.loads(json.dumps(self.default))
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                backup = self.path.with_suffix(".corrupt.json")
                self.path.replace(backup)
                return json.loads(json.dumps(self.default))

    def write(self, data, compact: bool = False) -> None:
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            text = json.dumps(data, indent=None if compact else 2, ensure_ascii=False, default=str,
                              separators=(",", ":") if compact else None)
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, self.path)


def profile_to_row(p: Profile, saved_at: str = "", note: str = "", status: str = "", follow_up: str = "") -> dict:
    c = p.contacts
    period = p.period_activity
    sources = sorted({i.source for i in c.emails + c.phones} | ({c.linkedin.source} if c.linkedin else set())
                     | ({c.telegram.source} if c.telegram else set())
                     | {l.source for l in c.links})
    return {
        "username": p.login,
        "name": p.name or "",
        "roles": "; ".join(r.title for r in p.roles),
        "email": "; ".join(e.value for e in c.emails),
        "phone": "; ".join(x.value for x in c.phones),
        "linkedin": c.linkedin.value if c.linkedin else "",
        "telegram": c.telegram.value if c.telegram else "",
        "github_url": p.github_url,
        "website": c.website or "",
        "other_links": "; ".join(f"{l.label}: {l.url}" for l in c.links if l.url != c.website),
        "location": p.location or "",
        "country": p.country or "",
        "region": p.region or "",
        "continent": p.continent or "",
        "company": p.company or "",
        "followers": p.followers,
        "public_repos": p.public_repos,
        "account_created": (p.created_at or "")[:10],
        "languages": "; ".join(p.languages),
        "skills": "; ".join(f"{s.name} ({s.level.lower()})" for s in p.analysis.skills),
        "human_confidence": p.analysis.human_confidence,
        "activity_status": p.analysis.activity_status,
        "last_push": (p.analysis.last_push or "")[:10],
        "period_commits": period.commits if period else "",
        "contact_sources": "; ".join(sources),
        "saved_at": saved_at,
        "note": note,
        "status": status,
        "follow_up": follow_up,
    }


def to_csv(rows: Iterable[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


CACHE_FLUSH_SECONDS = 30  # how often new cache entries are written to disk


class Store:
    def __init__(self, data_dir: Path, cache_ttl_hours: int = 24):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.ttl = timedelta(hours=cache_ttl_hours)
        self.cache = JsonFile(self.dir / "profiles_cache.json", {})
        self.saved = JsonFile(self.dir / "saved_profiles.json", {})
        self.history = JsonFile(self.dir / "search_history.json", [])
        self.saved_csv = self.dir / "saved_profiles.csv"
        # The cache grows to tens of MB, so it is kept in memory and written in the background at most every
        # CACHE_FLUSH_SECONDS instead of being read and rewritten for every profile.
        self._cache: Optional[dict] = None
        self._cache_index: dict[str, str] = {}  # lowercase login -> key
        self._cache_dirty = False
        self._cache_flushed = time.monotonic()
        self._flush_thread: Optional[threading.Thread] = None

    # --- cache ---------------------------------------------------------------

    def _cache_data(self) -> dict:
        with self.cache.lock:
            if self._cache is None:
                self._cache = self.cache.read()
                self._cache_index = {v["login"].lower(): k for k, v in self._cache.items()}
            return self._cache

    def cached_entries(self) -> list[dict]:
        return list(self._cache_data().values())

    def get_cached(self, login: str) -> Optional[Profile]:
        data = self._cache_data()
        entry = data.get(self._cache_index.get(login.lower(), ""))
        if not entry:
            return None
        fetched = datetime.fromisoformat(entry["fetched_at"])
        if datetime.now(timezone.utc) - fetched > self.ttl:
            return None
        return Profile.model_validate(entry)

    def put_cached(self, profile: Profile) -> None:
        data = self._cache_data()
        with self.cache.lock:
            key = str(profile.id)
            old = data.get(key)
            if old and old["login"].lower() != profile.login.lower():
                self._cache_index.pop(old["login"].lower(), None)  # renamed account
            # Entries are replaced, never mutated, so a background flush can serialize a shallow copy safely.
            data[key] = profile.model_dump(mode="json", exclude={"period_activity", "saved"})
            self._cache_index[profile.login.lower()] = key
            self._cache_dirty = True
        if time.monotonic() - self._cache_flushed >= CACHE_FLUSH_SECONDS:
            self.flush_cache(background=True)

    def delete_cached(self, login: str) -> bool:
        data = self._cache_data()
        with self.cache.lock:
            keys = [k for k, v in data.items() if v["login"].lower() == login.lower()]
            for k in keys:
                del data[k]
            self._cache_index.pop(login.lower(), None)
            self._cache_dirty = True
        self.flush_cache()  # a deletion request is written to disk right away
        return bool(keys)

    def flush_cache(self, background: bool = False) -> None:
        """Write the cache to disk if it changed. In the background, a flush already running is not repeated."""
        with self.cache.lock:
            if not self._cache_dirty or self._cache is None:
                return
            if background and self._flush_thread and self._flush_thread.is_alive():
                return
            snapshot = dict(self._cache)
            self._cache_dirty = False
            self._cache_flushed = time.monotonic()
        if background:
            self._flush_thread = threading.Thread(target=self.cache.write, args=(snapshot, True),
                                                  name="cache-flush", daemon=True)
            self._flush_thread.start()
        else:
            if self._flush_thread and self._flush_thread.is_alive():
                self._flush_thread.join()
            self.cache.write(snapshot, compact=True)

    # --- saved profiles -------------------------------------------------------

    def list_saved(self) -> list[SavedEntry]:
        entries = [SavedEntry.model_validate(v) for v in self.saved.read().values()]
        return sorted(entries, key=lambda e: e.saved_at, reverse=True)

    def saved_logins(self) -> set[str]:
        return {v["login"].lower() for v in self.saved.read().values()}

    def save(self, profile: Profile, note: str = "") -> SavedEntry:
        return self.save_many([profile], note)[0]

    def save_many(self, profiles: list[Profile], note: str = "") -> list[SavedEntry]:
        with self.saved.lock:
            data = self.saved.read()
            entries = []
            for profile in profiles:
                key = str(profile.id)
                previous = data.get(key)
                entry = SavedEntry(
                    login=profile.login,
                    saved_at=previous["saved_at"] if previous else _now(),
                    note=note or (previous or {}).get("note", ""),
                    status=(previous or {}).get("status", ""),
                    follow_up=(previous or {}).get("follow_up"),
                    updated_at=(previous or {}).get("updated_at"),
                    profile=profile.model_copy(update={"saved": True}),
                )
                data[key] = entry.model_dump(mode="json")
                entries.append(entry)
            self.saved.write(data)
            self._write_saved_csv()
            return entries

    def follow_ups_due(self, today: date) -> int:
        """Saved people whose follow-up date is today or earlier, unless marked not interested."""
        return sum(1 for e in self.list_saved()
                   if e.follow_up and e.follow_up <= today and e.status != "not_interested")

    def update_saved(self, login: str, changes: dict) -> Optional[SavedEntry]:
        """Change the tracking fields (note, status, follow_up) of a saved profile."""
        with self.saved.lock:
            data = self.saved.read()
            key = next((k for k, v in data.items() if v["login"].lower() == login.lower()), None)
            if key is None:
                return None
            entry = SavedEntry.model_validate({**data[key], **changes, "updated_at": _now()})
            data[key] = entry.model_dump(mode="json")
            self.saved.write(data)
            self._write_saved_csv()
            return entry

    def unsave(self, login: str) -> bool:
        with self.saved.lock:
            data = self.saved.read()
            keys = [k for k, v in data.items() if v["login"].lower() == login.lower()]
            for k in keys:
                del data[k]
            self.saved.write(data)
            self._write_saved_csv()
            return bool(keys)

    def clear_saved(self) -> int:
        with self.saved.lock:
            n = len(self.saved.read())
            self.saved.write({})
            self._write_saved_csv()
            return n

    def saved_rows(self) -> list[dict]:
        return [profile_to_row(e.profile, e.saved_at, e.note, e.status, e.follow_up.isoformat() if e.follow_up else "")
                for e in self.list_saved()]

    def _write_saved_csv(self) -> None:
        tmp = self.saved_csv.with_suffix(".tmp")
        # utf-8-sig so Excel opens non-ASCII names correctly.
        tmp.write_text(to_csv(self.saved_rows()), encoding="utf-8-sig", newline="")
        os.replace(tmp, self.saved_csv)

    # --- search history ------------------------------------------------------

    def add_history(self, params: dict, query: str, result_count: int) -> None:
        with self.history.lock:
            items = self.history.read()
            items.insert(0, {"at": _now(), "params": params, "query": query, "results": result_count})
            self.history.write(items[:100])

    def list_history(self) -> list[dict]:
        return self.history.read()

    def clear_history(self) -> None:
        self.history.write([])
