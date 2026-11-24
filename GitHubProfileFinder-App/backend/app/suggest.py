"""Autocomplete suggestions made of strings GitHub search actually understands.

- keyword:  GitHub topics. Featured and curated topics are collected in the background at startup
            (a handful of API calls, well under a minute) and saved for a week; while typing, GitHub's
            topic search fills in when the saved list has few matches.
- language: GitHub (Linguist) language names, usable in `language:` qualifiers.
- location: locations people wrote on GitHub profiles already fetched by this app, plus cities and countries.
- country:  country names the app can detect from profile locations.
"""

import asyncio
import json
import logging
import time
from collections import Counter
from pathlib import Path
from typing import Optional

from .contacts import _CITIES, _LOOKUP
from .github_client import GitHubClient, GitHubError
from .regions import all_region_names
from .storage import Store

log = logging.getLogger(__name__)

TOPICS_TTL = 7 * 24 * 3600

LANGUAGES = [
    "JavaScript", "TypeScript", "Python", "Java", "C#", "C++", "C", "Go", "Rust", "PHP", "Ruby", "Kotlin", "Swift",
    "Dart", "Scala", "R", "Julia", "Lua", "Perl", "Haskell", "Elixir", "Erlang", "Clojure", "F#", "OCaml",
    "Objective-C", "Shell", "PowerShell", "Batchfile", "HTML", "CSS", "SCSS", "Vue", "Svelte", "Astro",
    "Jupyter Notebook", "MATLAB", "Fortran", "COBOL", "Assembly", "Zig", "Nim", "Crystal", "V", "Solidity",
    "Move", "Cairo", "Vyper", "GDScript", "HLSL", "GLSL", "ShaderLab", "WGSL", "CUDA", "Verilog", "VHDL",
    "SystemVerilog", "Groovy", "Visual Basic .NET", "VBA", "Delphi", "Pascal", "Ada", "Prolog", "Scheme",
    "Racket", "Common Lisp", "Emacs Lisp", "Vim Script", "TeX", "Markdown", "Dockerfile", "HCL", "Nix",
    "Makefile", "CMake", "Starlark", "Bicep", "Jsonnet", "PLpgSQL", "PLSQL", "TSQL", "SQL", "Apex",
    "ABAP", "AutoHotkey", "AutoIt", "Arduino", "Processing", "OpenSCAD", "QML", "Elm", "PureScript",
    "ReScript", "ReasonML", "CoffeeScript", "LiveScript", "Haxe", "ActionScript", "Smalltalk", "Tcl",
    "D", "Odin", "Mojo", "Gleam", "Hack", "Raku", "Roff", "Stata", "SAS", "Q#", "Chapel", "Modelica",
]


def _rank(value: str, q: str) -> Optional[int]:
    v, q = value.lower(), q.lower()
    if v == q:
        return 0
    if v.startswith(q):
        return 1
    if any(w.startswith(q) for w in v.replace("-", " ").split()):
        return 2
    if q in v:
        return 3
    return None


class SuggestionIndex:
    def __init__(self, gh: GitHubClient, store: Store, data_dir: Path):
        self.gh = gh
        self.store = store
        self.path = Path(data_dir) / "suggest_topics.json"
        self.topics: dict[str, dict] = {}  # name -> {name, display, description}
        self.ready = False
        self._live_cache: dict[str, list[dict]] = {}
        self._task: Optional[asyncio.Task] = None
        self._load()

    # --- topics warm-up ---------------------------------------------------------

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.topics = {t["name"]: t for t in data["topics"]}
            self.ready = time.time() - data["fetched_at"] < TOPICS_TTL
        except (OSError, ValueError, KeyError):
            pass

    def start(self) -> None:
        if not self.ready:
            self._task = asyncio.create_task(self._warm_up(), name="suggest-warm-up")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    def _add_topics(self, items: list[dict]) -> None:
        for t in items:
            name = t.get("name")
            if name and name not in self.topics:
                self.topics[name] = {
                    "name": name,
                    "display": t.get("display_name") or name,
                    "description": (t.get("short_description") or "")[:120],
                }

    async def _warm_up(self) -> None:
        """Collect featured and curated GitHub topics. Uses ~10 search API calls, spaced out."""
        for q in ("is:featured", "is:curated"):
            for page in range(1, 6):
                try:
                    data = await self.gh.search_topics(q, page=page, per_page=100)
                except GitHubError as e:
                    log.info("Topic warm-up paused: %s", e.message)
                    return
                except Exception:
                    log.exception("Topic warm-up failed")
                    return
                items = data.get("items", [])
                self._add_topics(items)
                if len(items) < 100:
                    break
                await asyncio.sleep(3)
        self.ready = True
        self.path.write_text(json.dumps({"fetched_at": time.time(), "topics": list(self.topics.values())}),
                             encoding="utf-8")
        log.info("Collected %d GitHub topics for suggestions", len(self.topics))

    # --- queries -----------------------------------------------------------------------

    async def keywords(self, q: str, limit: int = 12) -> list[dict]:
        """GitHub's own topic search (most relevant first), topped up from the collected topics."""
        live = await self._live_topics(q)
        names = [t["name"] for t in live if _rank(t["name"], q) is not None or _rank(t.get("display_name") or "", q) is not None]
        out = [self._as_suggestion(self.topics[n]) for n in names if n in self.topics]
        seen = set(names)
        out += [s for s in self._match_topics(q) if s["value"] not in seen]
        return out[:limit]

    async def _live_topics(self, q: str) -> list[dict]:
        key = q.lower()
        if len(key) < 2:
            return []
        if key in self._live_cache:
            return self._live_cache[key]
        # If a shorter prefix already returned every match, filter that instead of spending a search call.
        for n in range(len(key) - 1, 1, -1):
            prev = self._live_cache.get(key[:n])
            if prev is not None and len(prev) < 20:
                return prev
        try:
            items = (await self.gh.search_topics(q, per_page=20)).get("items", [])
        except Exception:  # suggestions are best-effort; never fail the request
            return []
        self._add_topics(items)
        self._live_cache[key] = items
        return items

    @staticmethod
    def _as_suggestion(t: dict) -> dict:
        return {"value": t["name"], "label": t["display"], "hint": t["description"] or "GitHub topic"}

    def _match_topics(self, q: str) -> list[dict]:
        ranked = []
        for t in self.topics.values():
            r = min(x for x in (_rank(t["name"], q), _rank(t["display"], q), 9) if x is not None)
            if r < 9:
                ranked.append((r, len(t["name"]), t))
        ranked.sort(key=lambda x: (x[0], x[1]))
        return [self._as_suggestion(t) for _, _, t in ranked]

    def languages(self, q: str, limit: int = 12) -> list[dict]:
        ranked = sorted(
            ((r, i, lang) for i, lang in enumerate(LANGUAGES) if (r := _rank(lang, q)) is not None),
            key=lambda x: (x[0], x[1]),
        )
        return [{"value": l, "label": l, "hint": "GitHub language"} for _, _, l in ranked[:limit]]

    def _seen_locations(self) -> Counter:
        counts: Counter = Counter()
        for entry in self.store.cached_entries():
            loc = (entry.get("location") or "").strip()
            if loc:
                counts[loc] += 1
        return counts

    def locations(self, q: str, limit: int = 12) -> list[dict]:
        out: dict[str, tuple[int, int, dict]] = {}
        for loc, n in self._seen_locations().items():
            if (r := _rank(loc, q)) is not None:
                out[loc.lower()] = (r, -n, {"value": loc, "label": loc, "hint": f"on {n} GitHub profile{'s' if n > 1 else ''} found so far"})
        for country, cities in _CITIES.items():
            for city in cities:
                if (r := _rank(city, q)) is not None and city not in out:
                    out[city] = (r, 0, {"value": city.title(), "label": city.title(), "hint": f"City · {country}"})
        for country in self._countries():
            if (r := _rank(country, q)) is not None and country.lower() not in out:
                out[country.lower()] = (r, 0, {"value": country, "label": country, "hint": "Country"})
        ranked = sorted(out.values(), key=lambda x: (x[0], x[1], len(x[2]["value"])))
        return [x[2] for x in ranked[:limit]]

    @staticmethod
    def _countries() -> list[str]:
        return sorted(set(_LOOKUP.values()))

    def countries(self, q: str, limit: int = 12) -> list[dict]:
        ranked = sorted(
            ((r, c) for c in self._countries() if (r := _rank(c, q)) is not None),
            key=lambda x: (x[0], x[1]),
        )
        return [{"value": c, "label": c, "hint": "Detected from profile location"} for _, c in ranked[:limit]]

    async def suggest(self, field: str, q: str) -> list[dict]:
        q = q.strip()
        if not q:
            return []
        if field == "keyword":
            return await self.keywords(q)
        if field == "language":
            return self.languages(q)
        if field == "location":
            return self.locations(q)
        if field == "region":
            return self.regions(q)
        if field == "country":
            return self.countries(q)
        return []

    def regions(self, q: str, limit: int = 12) -> list[dict]:
        ranked = sorted(
            ((r, i, name, kind) for i, (name, kind) in enumerate(all_region_names()) if (r := _rank(name, q)) is not None),
            key=lambda x: (x[0], x[1]),
        )
        return [{"value": n, "label": n, "hint": k} for _, _, n, k in ranked[:limit]]

    def status(self) -> dict:
        return {"topics": len(self.topics), "ready": self.ready}
