import asyncio
import logging
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .analysis import analyze
from .contacts import extract_contacts, extract_country, extract_roles
from .github_client import GitHubClient, GitHubError, RateLimitError
from .regions import matches_region
from .models import PeriodActivity, PeriodRepo, Profile, RepoSummary, SearchResponse
from .storage import Store

log = logging.getLogger(__name__)

GITHUB_SEARCH_LIMIT = 1000
ENRICH_BATCH = 10  # profiles checked concurrently per batch in background searches

OnItem = Callable[[Profile], Awaitable[None]]
OnProgress = Callable[[dict], Awaitable[None]]


class SearchParams(BaseModel):
    mode: Literal["repositories", "users", "commits", "followers"] = "repositories"
    q: str = ""
    followers_of: Optional[str] = None  # followers mode: the account whose followers are scanned
    # Any-of keywords: a person is included when they match at least one of them.
    keywords: list[str] = Field(default_factory=list, max_length=30)
    language: Optional[str] = None
    location: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None  # region, continent or group, e.g. "Western Europe", "Asia", "Nordics"
    since: Optional[date] = None
    until: Optional[date] = None
    min_followers: int = Field(0, ge=0)
    min_repos: int = Field(0, ge=0)
    min_account_age_years: float = Field(0, ge=0)
    require_email: bool = False
    require_phone: bool = False
    require_linkedin: bool = False
    require_telegram: bool = False
    require_website: bool = False
    # Keyword searches end at GitHub's 1,000-result limit on their own; followers lists have no such limit.
    page: int = Field(1, ge=1)
    per_page: int = Field(10, ge=1, le=30)

    @field_validator("keywords", mode="before")
    @classmethod
    def split_keywords(cls, v):
        """Accept a list, or one string separated by commas/new lines ("gis, bim, revit")."""
        items = v if isinstance(v, list) else [v] if v else []
        out: list[str] = []
        for item in items:
            for k in re.split(r"[,\n]", str(item)):
                k = " ".join(k.replace('"', "").split())
                if k and k.lower() not in {x.lower() for x in out}:
                    out.append(k[:60])
        return out

    @field_validator("followers_of", mode="before")
    @classmethod
    def clean_login(cls, v):
        v = str(v or "").strip().removeprefix("https://github.com/").strip("/").lstrip("@")
        if v and not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})", v):
            raise ValueError("Enter a valid GitHub username for the followers search")
        return v or None

    @property
    def terms(self) -> list[str]:
        """Everything the person must match at least one of: the keywords, plus a raw `q` query if given."""
        return self.keywords + ([self.q.strip()] if self.q.strip() else [])

    @model_validator(mode="after")
    def check_period(self):
        if self.since and self.until and self.since > self.until:
            raise ValueError("'since' must be on or before 'until'")
        if self.until and not self.since:
            self.since = date(2008, 1, 1)
        if self.since and not self.until:
            self.until = date.today()
        return self

    @property
    def has_period(self) -> bool:
        return self.since is not None


def _quote(v: str) -> str:
    v = v.strip().replace('"', "")
    return f'"{v}"' if " " in v else v


MAX_OR_TERMS = 6  # GitHub allows at most five AND/OR/NOT operators per query
MAX_QUERY_LEN = 256


def _term(k: str) -> str:
    return f'"{k}"' if " " in k and not k.startswith('"') else k


def build_queries(p: SearchParams) -> list[str]:
    """One GitHub query per group of keywords joined with OR. More keywords than GitHub accepts in one query
    are split over several queries, whose results are merged."""
    if p.mode == "followers":
        return [build_query(p, "")]  # followers are listed, not searched: keywords are matched locally
    keywords = [_term(k) for k in p.keywords]
    raw = p.q.strip()
    if not keywords:
        return [build_query(p, raw)]
    qualifiers = build_query(p, "", require_terms=False)
    room = MAX_QUERY_LEN - len(qualifiers) - len(raw) - 2
    groups: list[list[str]] = [[]]
    for k in keywords:
        g = groups[-1]
        if g and (len(g) >= MAX_OR_TERMS - (1 if raw else 0) or len(" OR ".join(g + [k])) > room):
            groups.append([k])
        else:
            g.append(k)
    # A raw q is AND-ed with each group, so it narrows every group the same way.
    return [" ".join(x for x in (raw, " OR ".join(g), qualifiers) if x) for g in groups]


def build_query(p: SearchParams, text: Optional[str] = None, require_terms: bool = True) -> str:
    if text is None:
        return " ‖ ".join(build_queries(p))
    if p.mode == "followers":
        if not p.followers_of:
            raise ValueError("Enter the GitHub username whose followers you want to scan")
        return (f"followers of @{p.followers_of}" + (f" matching {' OR '.join(p.terms)}" if p.terms else "")
                + (f" · commits {p.since.isoformat()} → {p.until.isoformat()}" if p.has_period else ""))

    parts = [text] if text else []
    if p.mode == "repositories":
        if p.language:
            parts.append(f"language:{_quote(p.language)}")
        if p.has_period:
            # A repository can only contain commits from the period if it was pushed on/after its start.
            # Commit dates themselves are verified per user afterwards.
            parts.append(f"pushed:>={p.since.isoformat()}")
        if not parts and require_terms:
            raise ValueError("Enter keywords, a language or a commit date range to search repositories")
        return " ".join(parts)

    if p.mode == "commits":
        if p.has_period:
            parts.append(f"author-date:{p.since.isoformat()}..{p.until.isoformat()}")
        if not parts and require_terms:
            raise ValueError("Enter keywords or a commit date range to search commits")
        return " ".join(parts)

    parts.append("type:user")
    if p.location:
        parts.append(f"location:{_quote(p.location)}")
    if p.language:
        parts.append(f"language:{_quote(p.language)}")
    if p.min_followers:
        parts.append(f"followers:>={p.min_followers}")
    if p.min_repos:
        parts.append(f"repos:>={p.min_repos}")
    if p.min_account_age_years:
        cutoff = date.today() - timedelta(days=int(p.min_account_age_years * 365.25))
        parts.append(f"created:<={cutoff.isoformat()}")
    if len(parts) == 1 and require_terms:
        raise ValueError("Enter keywords or at least one filter to search users")
    if not require_terms:
        parts.remove("type:user")
        parts.insert(0, "type:user")
    return " ".join(parts)


def keyword_pattern(k: str) -> re.Pattern:
    """Whole-word, case-insensitive match; '-', '_' and spaces are interchangeable ("web-gis" ~ "web gis")."""
    words = [re.escape(w) for w in re.split(r"[\s_\-]+", k.strip('"').lower()) if w]
    return re.compile(r"(?<![a-z0-9])" + r"[\s_\-]*".join(words) + r"(?![a-z0-9])", re.I)


def matched_keywords(terms: list[str], *texts: str) -> list[str]:
    text = " ".join(t for t in texts if t)
    return [k for k in terms if keyword_pattern(k).search(text)]


def profile_text(p: Profile) -> str:
    parts = [p.login, p.name or "", p.bio or "", p.company or "", " ".join(p.languages)]
    parts += [r.title for r in p.roles] + [s.name for s in p.analysis.skills]
    for r in p.repositories:
        parts += [r.name, r.description or "", " ".join(r.topics), r.language or ""]
    return " ".join(parts)


def has_contact(p: Profile) -> bool:
    """Results must offer at least one way to reach the person: email, phone, LinkedIn or Telegram."""
    c = p.contacts
    return bool(c.emails or c.phones or c.linkedin or c.telegram)


def _in_range(ts: str, since_iso: str, until_iso: str) -> bool:
    return bool(ts) and since_iso <= ts.replace("+00:00", "Z") <= until_iso


class ProfileService:
    def __init__(self, gh: GitHubClient, store: Store, period_repo_limit: int = 6):
        self.gh = gh
        self.store = store
        self.period_repo_limit = period_repo_limit
        self._period_cache: dict[tuple[str, date, date], PeriodActivity] = {}
        self._inflight: dict[str, asyncio.Task] = {}

    async def get_profile(self, login: str, refresh: bool = False) -> Profile:
        if not refresh:
            cached = self.store.get_cached(login)
            if cached:
                return self._mark_saved(cached)
        key = login.lower()
        if key not in self._inflight:
            self._inflight[key] = asyncio.ensure_future(self._build(login))
        try:
            profile = await self._inflight[key]
        finally:
            self._inflight.pop(key, None)
        return self._mark_saved(profile)

    def _mark_saved(self, profile: Profile) -> Profile:
        return profile.model_copy(update={"saved": profile.login.lower() in self.store.saved_logins()})

    async def _build(self, login: str) -> Profile:
        user = await self.gh.user(login)
        login = user["login"]
        social, repos, readme = await asyncio.gather(
            self.gh.social_accounts(login), self.gh.repos(login), self.gh.profile_readme(login)
        )
        contacts = extract_contacts(user, social, readme)
        analysis = analyze(user, repos, contacts)
        repos_sorted = sorted(repos, key=lambda r: r.get("pushed_at") or "", reverse=True)
        languages = [l for l, _ in Counter(r["language"] for r in repos if r.get("language") and not r.get("fork")).most_common()]
        profile = Profile(
            id=user["id"],
            login=login,
            name=user.get("name"),
            avatar_url=user.get("avatar_url"),
            github_url=user.get("html_url") or f"https://github.com/{login}",
            bio=user.get("bio"),
            company=user.get("company"),
            location=user.get("location"),
            country=extract_country(user.get("location")),
            hireable=user.get("hireable"),
            type=user.get("type", "User"),
            roles=extract_roles(user.get("bio"), readme),
            contacts=contacts,
            followers=user.get("followers", 0),
            following=user.get("following", 0),
            public_repos=user.get("public_repos", 0),
            created_at=user.get("created_at"),
            languages=languages,
            repositories=[
                RepoSummary(
                    id=r["id"], name=r["name"], url=r["html_url"], description=r.get("description"),
                    language=r.get("language"), stars=r.get("stargazers_count", 0), forks=r.get("forks_count", 0),
                    topics=r.get("topics") or [], fork=r.get("fork", False),
                    created_at=r.get("created_at"), pushed_at=r.get("pushed_at"),
                )
                for r in repos_sorted[:30]
            ],
            analysis=analysis,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        self.store.put_cached(profile)
        return profile

    async def period_activity(self, profile: Profile, since: date, until: date) -> PeriodActivity:
        """Count commits authored by the user, by commit date, in their most recently pushed repositories."""
        key = (profile.login.lower(), since, until)
        if key in self._period_cache:
            return self._period_cache[key]
        since_iso, until_iso = f"{since.isoformat()}T00:00:00Z", f"{until.isoformat()}T23:59:59Z"
        candidates = [r for r in profile.repositories if r.pushed_at and r.pushed_at >= since_iso]
        candidates = candidates[: self.period_repo_limit]
        dates_per_repo = await asyncio.gather(
            *(self.gh.commit_dates(profile.login, r.name, profile.login, since_iso, until_iso) for r in candidates)
        )
        # The commits API filters by committer date; keep only commits whose *author* date is in range too.
        in_range = [[d for d in dates if _in_range(d, since_iso, until_iso)] for dates in dates_per_repo]
        all_dates = [d for dates in in_range for d in dates]
        activity = PeriodActivity(
            since=since, until=until, commits=len(all_dates),
            commits_capped=any(len(d) >= 100 for d in dates_per_repo),
            repos=[PeriodRepo(name=r.name, commits=len(d)) for r, d in zip(candidates, in_range) if d],
            checked_repos=len(candidates),
            last_commit_at=max(all_dates) if all_dates else None,
        )
        self._period_cache[key] = activity
        return activity

    @staticmethod
    def rejection_reason(p: Profile, params: SearchParams) -> Optional[str]:
        c = p.contacts
        if p.type != "User":
            return "not a user account"
        if not has_contact(p):
            return "no email, phone, LinkedIn or Telegram"
        if params.mode == "followers" and params.terms and not p.matched_keywords:
            return "no keyword match"
        if params.has_period and (not p.period_activity or p.period_activity.commits == 0):
            return "no commits in period"
        if params.require_email and not c.emails:
            return "no public email"
        if params.require_phone and not c.phones:
            return "no public phone"
        if params.require_linkedin and not c.linkedin:
            return "no LinkedIn"
        if params.require_telegram and not c.telegram:
            return "no Telegram"
        if params.require_website and not c.website:
            return "no website"
        if params.mode != "users":
            if params.location and params.location.lower() not in f"{p.location or ''} {p.country or ''}".lower():
                return "location mismatch"
            if p.followers < params.min_followers:
                return "too few followers"
            if p.public_repos < params.min_repos:
                return "too few repositories"
            if params.min_account_age_years and p.created_at:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(p.created_at.replace("Z", "+00:00"))).days / 365.25
                if age < params.min_account_age_years:
                    return "account too new"
            if params.mode in ("commits", "followers") and params.language and params.language.lower() not in [l.lower() for l in p.languages]:
                return "language mismatch"
        if params.country and (p.country or "").lower() != params.country.lower():
            return "country mismatch"
        if params.region and not matches_region(params.region, p.region, p.continent, p.country):
            return "region mismatch"
        return None

    async def _candidates(
        self, params: SearchParams, queries: list[str]
    ) -> tuple[list[str], int, bool, dict[str, PeriodActivity], dict[str, str]]:
        """Run every query for this page and merge: logins interleaved across queries, without duplicates."""
        results = await asyncio.gather(*(self._candidates_one(params, q) for q in queries))
        logins: list[str] = []
        seen: set[str] = set()
        for i in range(max((len(r[0]) for r in results), default=0)):
            for r in results:
                if i < len(r[0]) and r[0][i].lower() not in seen:
                    seen.add(r[0][i].lower())
                    logins.append(r[0][i])
        hits: dict[str, PeriodActivity] = {}
        texts: dict[str, str] = {}
        for r in results:
            for k, v in r[3].items():
                hits.setdefault(k, v)
            for k, v in r[4].items():
                texts[k] = texts.get(k, "") + " " + v
        return logins, sum(r[1] for r in results), any(r[2] for r in results), hits, texts

    async def _candidates_one(
        self, params: SearchParams, query: str
    ) -> tuple[list[str], int, bool, dict[str, PeriodActivity], dict[str, str]]:
        """Return (logins, total GitHub matches, has more pages, commit evidence per login for commit search,
        text GitHub matched per login)."""
        hits: dict[str, PeriodActivity] = {}
        texts: dict[str, str] = {}
        if params.mode == "users":
            size = params.per_page
            data = await self.gh.search_users(query, params.page, size)
            logins = [u["login"] for u in data.get("items", []) if u.get("type") == "User"]
        elif params.mode == "commits":
            size = min(100, params.per_page * 4)
            data = await self.gh.search_commits(query, params.page, size)
            logins = []
            per_login: dict[str, list[tuple[str, str]]] = {}
            for item in data.get("items", []):
                author = item.get("author") or {}
                if author.get("type") != "User":
                    continue  # commit e-mail not linked to a GitHub account, or a bot
                login = author["login"]
                if login not in per_login:
                    logins.append(login)
                    per_login[login] = []
                repo = (item.get("repository") or {}).get("full_name", "")
                d = ((item.get("commit") or {}).get("author") or {}).get("date", "")
                per_login[login].append((repo, d))
                texts[login.lower()] = texts.get(login.lower(), "") + " " + (item.get("commit") or {}).get("message", "")[:500]
            for login, commits in per_login.items():
                repos = Counter(r for r, _ in commits)
                hits[login.lower()] = PeriodActivity(
                    since=params.since, until=params.until, commits=len(commits),
                    repos=[PeriodRepo(name=r, commits=n) for r, n in repos.most_common()],
                    checked_repos=len(repos), last_commit_at=max(d for _, d in commits) or None,
                    source="GitHub commit search (matching commits on this results page)",
                )
        elif params.mode == "followers":
            # Every follower goes through the same profile, contact and filter checks as searched people.
            size = min(100, params.per_page * 4)
            owner, page = await asyncio.gather(
                self.gh.user(params.followers_of), self.gh.followers(params.followers_of, params.page, size))
            logins = [u["login"] for u in page if u.get("type") == "User"]
            total = owner.get("followers", 0)
            return logins, total, len(page) >= size, hits, texts
        else:
            size = min(100, params.per_page * 4)
            data = await self.gh.search_repos(query, params.page, size)
            logins = []
            for repo in data.get("items", []):
                owner = repo.get("owner") or {}
                if owner.get("type") == "User":
                    if owner["login"] not in logins:
                        logins.append(owner["login"])
                    texts[owner["login"].lower()] = texts.get(owner["login"].lower(), "") + " " + " ".join(
                        [repo.get("name") or "", repo.get("description") or "", " ".join(repo.get("topics") or [])])
        total = data.get("total_count", 0)
        # GitHub search only exposes the first 1000 results of any query.
        seen_so_far = params.page * size
        return logins, total, total > seen_so_far and seen_so_far < GITHUB_SEARCH_LIMIT, hits, texts

    async def search(
        self,
        params: SearchParams,
        *,
        cap: bool = True,
        record_history: bool = True,
        exclude: frozenset[str] | set[str] = frozenset(),
        limit: Optional[int] = None,
        on_item: Optional[OnItem] = None,
        on_progress: Optional[OnProgress] = None,
    ) -> SearchResponse:
        """Run one page of a search.

        cap:         limit candidates to 2 x per_page (interactive search); background jobs check all of them.
        exclude:     lowercase logins already found, skipped without spending API calls.
        limit:       stop checking candidates once this many matches are found (saves API calls);
                     `page_complete` in the response is False when candidates were left unchecked.
        on_item:     awaited with each matching profile the moment it is found.
        on_progress: awaited with counters after every checked candidate.
        """
        queries = build_queries(params)
        query = " ‖ ".join(queries)
        logins, total, has_more, hits, texts = await self._candidates(params, queries)
        logins = [l for l in logins if l.lower() not in exclude]
        if cap and params.mode != "users":
            logins = logins[: params.per_page * 2]
        if on_progress:
            await on_progress({"candidates": len(logins), "checked": 0, "filtered_out": 0, "found": 0,
                               "total_candidates": total, "query": query})

        async def enrich(login: str) -> tuple[str, Profile | BaseException]:
            try:
                profile = await self.get_profile(login)
                if not has_contact(profile) or (
                    params.region and not matches_region(params.region, profile.region, profile.continent, profile.country)
                ):
                    return login, profile  # rejected anyway: skip the commit-date API calls
                if params.terms:
                    matched = matched_keywords(params.terms, texts.get(login.lower(), ""), profile_text(profile))
                    profile = profile.model_copy(update={"matched_keywords": matched})
                    if params.mode == "followers" and not matched:
                        return login, profile
                if login.lower() in hits:
                    activity = hits[login.lower()]
                elif params.has_period:
                    activity = await self.period_activity(profile, params.since, params.until)
                else:
                    activity = None
                if activity:
                    profile = profile.model_copy(update={"period_activity": activity})
                return login, profile
            except Exception as e:  # reported per login below
                return login, e

        items: list[Profile] = []
        failed: list[str] = []
        filtered, checked, warning = 0, 0, None
        batch = ENRICH_BATCH if limit else max(len(logins), 1)
        for start in range(0, len(logins), batch):
            if (limit and len(items) >= limit) or warning:
                break
            tasks = [asyncio.ensure_future(enrich(l)) for l in logins[start:start + batch]]
            try:
                for next_done in asyncio.as_completed(tasks):
                    login, res = await next_done
                    checked += 1
                    if isinstance(res, RateLimitError):
                        warning = res.message
                        failed.append(login)
                    elif isinstance(res, GitHubError):
                        failed.append(login)
                    elif isinstance(res, BaseException):
                        log.error("Failed to enrich %s: %r", login, res)
                        failed.append(login)
                    elif self.rejection_reason(res, params):
                        filtered += 1
                    else:
                        items.append(res)
                        if on_item:
                            await on_item(res)
                    if on_progress:
                        await on_progress({"candidates": len(logins), "checked": checked, "filtered_out": filtered,
                                           "found": len(items), "total_candidates": total, "query": query})
            finally:
                for t in tasks:
                    t.cancel()
        if warning and not items:
            raise RateLimitError(None, warning)

        if record_history:
            self.store.add_history(params.model_dump(mode="json", exclude_defaults=True), query, len(items))
        return SearchResponse(
            items=items, page=params.page, per_page=params.per_page, total_candidates=total,
            checked=checked, filtered_out=filtered, failed=failed, query=query, has_more=has_more,
            warning=warning, page_complete=checked >= len(logins),
        )
