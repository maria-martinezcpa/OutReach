"""Search job orchestration.

Quora:  search-engine API → Quora profile snippets → AI extraction → US filter →
        name-based discovery of GitHub / LinkedIn / websites → verification → save.
Reddit: official API → posts in chosen communities → AI extraction → US filter →
        ONLY the links/contacts the author posted → reciprocal-link verification → save.
        (No name/username searches on other sites: Reddit accounts are pseudonymous.)
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import SessionLocal
from ..models import Contact, Person, Profile, SearchQuery, SearchResult
from ..schemas import SearchRequest
from .ai import ClaudeService, ExtractedPerson
from .rules import RuleBasedAI, use_claude
from .contacts import EMAIL_RE, crawl_site, email_belongs_to_site, is_business_email
from .fetcher import PoliteFetcher, is_blocked, registered_domain
from .github import GitHubClient
from . import medium
from .quality import company_conflict, refresh_quality
from .quora import build_queries, quora_profile_hits
from .reddit import RedditClient, RedditError, RedditPost, extract_links
from .search_engine import SearchEngine, SearchEngineError, SearchHit
from .regions import REGION_LABEL, region_of
from .verify import Candidate, Identity, links_to, score_candidate

log = logging.getLogger(__name__)

# Never treated as "the person's website": people-search/data-broker sites, encyclopedias, aggregators.
NOT_PERSONAL_SITES = {
    "spokeo.com", "whitepages.com", "beenverified.com", "zoominfo.com", "rocketreach.co", "apollo.io",
    "signalhire.com", "contactout.com", "lusha.com", "peoplefinders.com", "truepeoplesearch.com", "radaris.com",
    "intelius.com", "mylife.com", "fastpeoplesearch.com", "crunchbase.com", "wikipedia.org", "youtube.com",
    "amazon.com", "reddit.com", "redd.it", "pinterest.com", "glassdoor.com", "indeed.com", "yelp.com",
    "bloomberg.com", "theorg.com", "idcrawl.com", "peekyou.com", "clustrmaps.com", "nuwber.com", "usphonebook.com",
    # file/doc hosts — résumés there often hold home addresses/phone numbers, so we don't read them
    "docs.google.com", "drive.google.com", "dropbox.com", "imgur.com", "i.imgur.com", "onedrive.live.com",
}
PORTFOLIO_HOSTS = {"behance.net", "dribbble.com", "artstation.com", "medium.com", "substack.com",
                   "dev.to", "hashnode.dev", "about.me", "linktr.ee", "notion.site", "carrd.co", "kaggle.com",
                   "upwork.com", "fiverr.com", "toptal.com", "codepen.io", "vercel.app", "netlify.app", "github.io"}
SOCIAL_HOSTS = {"x.com", "twitter.com", "mastodon.social", "bsky.app", "stackoverflow.com", "youtube.com"}
URL_IN_TEXT = re.compile(r"\b((?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|ai|app|xyz|tech)(?:/[^\s,)]*)?)", re.I)
GITHUB_USER_RE = re.compile(r"^https?://(?:www\.)?github\.com/([A-Za-z0-9-]{1,39})/?$")


def _host_in(url: str, hosts: set[str]) -> bool:
    h = registered_domain(url)
    return any(h == d or h.endswith("." + d) for d in hosts)


def _set_if(obj, field: str, value):
    """Fill/refresh a field only with a real value, and never overwrite a user's edit."""
    if value not in (None, "", []) and field not in (obj.edited_fields or []):
        setattr(obj, field, value)


def _merge_list(obj, field: str, values: list[str]):
    if values and field not in (obj.edited_fields or []):
        current = getattr(obj, field) or []
        setattr(obj, field, sorted(set(current) | set(values), key=str.lower))


def classify_link(url: str) -> str | None:
    if _host_in(url, NOT_PERSONAL_SITES) or "mailto:" in url:
        return None
    host = registered_domain(url)
    if host == "github.com":
        return "github" if GITHUB_USER_RE.match(url.split("?")[0]) else None
    if host.endswith("linkedin.com"):
        return "linkedin" if "/in/" in url else None
    if _host_in(url, PORTFOLIO_HOSTS):
        return "portfolio"
    if _host_in(url, SOCIAL_HOSTS):
        return "social"
    if is_blocked(url):
        return None
    return "website"


REDDIT_POST_RE = re.compile(r"^https?://(?:www\.|old\.|new\.)?reddit\.com/r/([A-Za-z0-9_]+)/comments/([a-z0-9]+)", re.I)
REDDIT_TITLE_TAIL = re.compile(r"\s*(?::\s*r/[A-Za-z0-9_]+|[-–|]\s*Reddit)\s*$", re.I)


REDDIT_REGION_HINT = {
    frozenset({"US"}): '("based in" OR USA OR "United States" OR California OR "New York" OR Texas OR EST OR PST)',
    frozenset({"EU"}): '("based in" OR Europe OR EU OR UK OR London OR Germany OR France OR Netherlands OR Spain OR Poland)',
    frozenset({"US", "EU"}): '("based in" OR USA OR UK OR Germany OR Europe OR London OR "New York" OR California)',
}


def clean_reddit_title(title: str) -> str:
    """'[For Hire] React dev : r/forhire' → '[For Hire] React dev'."""
    prev = None
    while prev != title:
        prev, title = title, REDDIT_TITLE_TAIL.sub("", title).strip()
    return title


def reddit_profile_urls(username: str) -> list[str]:
    return [f"https://www.reddit.com/user/{username}", f"https://www.reddit.com/u/{username}",
            f"https://reddit.com/user/{username}", f"https://reddit.com/u/{username}",
            f"https://old.reddit.com/user/{username}"]


class SearchJob:
    def __init__(self, db: Session, settings: Settings | None = None):
        self.db = db
        self.s = settings or get_settings()
        self.engine = SearchEngine(self.s)
        self.claude = ClaudeService(self.s) if use_claude(self.s) else RuleBasedAI(self.s)
        self.fetcher = PoliteFetcher(self.s)
        self.github = GitHubClient(self.s)
        self.reddit = RedditClient(self.s)

    # ------------------------------------------------------------------
    def run(self, search: SearchQuery) -> None:
        req = SearchRequest(query=search.query, query_type=search.query_type, sources=search.sources or ["quora"],
                            **search.filters)
        search.status = "running"
        self.db.commit()
        notes, errors = [], []
        if "quora" in req.sources:
            try:
                notes.append(self._run_quora(search, req))
            except SearchEngineError as e:
                errors.append(f"Quora: {e}")
        if "medium" in req.sources:
            try:
                notes.append(self._run_medium(search, req))
            except SearchEngineError as e:
                errors.append(f"Medium: {e}")
        if "reddit" in req.sources and req.query_type != "url":
            try:
                if self.s.reddit_client_id and self.s.reddit_client_secret:
                    notes.append(self._run_reddit(search, req))
                else:  # no Reddit API keys: fall back to search-engine snippets
                    notes.append(self._run_reddit_via_search(search, req))
            except (RedditError, SearchEngineError) as e:
                errors.append(f"Reddit: {e}")

        search.result_count = len(search.results)
        msg = " ".join(n for n in notes if n)
        if search.excluded_non_us:
            where = " or ".join(REGION_LABEL[r] for r in req.regions)
            msg += f" {search.excluded_non_us} excluded: not in {where}, or location not stated."
        if search.excluded_no_contact:
            msg += f" {search.excluded_no_contact} excluded: no GitHub link or published email."
        if errors:
            msg += " Problems: " + "; ".join(errors)
        status = "failed" if errors and not notes else "done"
        self._finish(search, msg.strip() or "No results.", status)

    def _progress(self, search: SearchQuery, message: str) -> None:
        search.message = message
        self.db.commit()

    def _finish(self, search: SearchQuery, message: str, status: str = "done") -> None:
        search.status, search.message = status, message
        search.finished_at = datetime.now(timezone.utc)
        self.db.commit()

    def _link_result(self, search: SearchQuery, person: Person) -> None:
        if not self.db.scalar(select(SearchResult).where(SearchResult.search_id == search.id,
                                                         SearchResult.person_id == person.id)):
            self.db.add(SearchResult(search_id=search.id, person_id=person.id, relevance=person.confidence))
        self.db.commit()

    def _keep(self, p: ExtractedPerson, req: SearchRequest, search: SearchQuery) -> bool:
        if not p.is_individual_person:
            return False
        if p.country not in req.regions:
            search.excluded_non_us += 1  # outside the selected regions, or location not stated
            return False
        if req.state:
            loc = " ".join(filter(None, [p.location, p.city, p.state])).lower()
            if req.state.lower() not in loc:
                return False
        return True

    def _apply_extraction(self, person: Person, p: ExtractedPerson) -> None:
        for f in ("full_name", "job_title", "company", "industry", "experience", "years_experience",
                  "freelance_available", "location", "city", "state", "location_evidence"):
            _set_if(person, f, getattr(p, f))
        for f in ("skills", "programming_languages", "interests"):
            _merge_list(person, f, getattr(p, f))
        person.country = p.country

    def _email_ok(self, email: str) -> bool:
        """Business addresses always; personal ones (gmail…) only if enabled. Callers ensure self-publication."""
        return is_business_email(email) or bool(self.s.include_personal_emails)

    @staticmethod
    def has_contact(person: Person) -> bool:
        """A published email, or a GitHub the person linked themselves / that is cross-link verified.
        A GitHub account that merely shares the name ('possible') does not count."""
        return bool(person.contacts) or any(
            x.platform == "github" and x.match_status in ("verified", "self_reported") for x in person.profiles)

    def _finalize(self, search: SearchQuery, req: SearchRequest, person: Person, is_new: bool) -> bool:
        refresh_quality(person)
        if req.require_contact and not self.has_contact(person):
            search.excluded_no_contact = (search.excluded_no_contact or 0) + 1
            if is_new:
                self.db.delete(person)  # nothing useful found: don't keep a record of this person
            self.db.commit()
            return False
        self._link_result(search, person)
        return True

    def _add_conflict(self, person: Person, text: str | None) -> None:
        if text and text not in (person.conflicts or []):
            person.conflicts = [*(person.conflicts or []), text]

    def _upsert_profile(self, person: Person, **kw) -> Profile:
        prof = self.db.scalar(select(Profile).where(Profile.person_id == person.id, Profile.url == kw["url"]))
        if not prof:
            prof = Profile(person=person, platform=kw["platform"], url=kw["url"])
            self.db.add(prof)
        for k, v in kw.items():
            if v is not None:
                setattr(prof, k, v)
        self.db.flush()
        return prof

    def _save_contact(self, person: Person, value: str, kind: str, source: str, evidence: str,
                      status: str, provenance: str) -> None:
        value = value.lower()
        c = self.db.scalar(select(Contact).where(Contact.person_id == person.id, Contact.value == value))
        is_new = c is None
        if not c:
            c = Contact(person=person, kind=kind, value=value, source_url=source)
            self.db.add(c)
        # upgrade, never downgrade, an existing contact's verification
        if is_new or c.verification_status != "verified" or status == "verified":
            c.verification_status, c.provenance, c.source_url = status, provenance, source
            c.evidence = evidence[:500]
        c.is_business = is_business_email(value)
        self.db.flush()

    # ================================================================ Quora
    def _run_quora(self, search: SearchQuery, req: SearchRequest) -> str:
        limit = req.max_candidates or self.s.max_candidates_per_search
        self._progress(search, "Quora: searching for public profiles…")
        hits: list[SearchHit] = []
        seen: set[str] = set()
        for q in build_queries(req):
            for h in quora_profile_hits(self.engine.search(q, count=20)):
                if h.url.lower() not in seen:
                    seen.add(h.url.lower())
                    hits.append(h)
            if len(hits) >= limit:
                break
        hits = hits[:limit]
        search.candidates_found += len(hits)
        if not hits:
            return "Quora: no public profiles found in the search index."

        self._progress(search, f"Quora: extracting details from {len(hits)} profiles…")
        items = [{"index": i, "url": h.url, "text": f"{h.title}\n{h.snippet}"} for i, h in enumerate(hits)]
        kept = 0
        for p in self.claude.extract_people(items, "quora"):
            if not p.full_name or not self._keep(p, req, search):
                continue
            hit = hits[p.index]
            self._progress(search, f"Quora: looking up public profiles for {p.full_name}…")
            existing = self.db.scalar(select(Profile).where(Profile.platform == "quora", Profile.url == hit.url))
            person = existing.person if existing else Person(source_platform="quora", skills=[])
            if not existing:
                self.db.add(person)
            self._apply_extraction(person, p)
            self.db.flush()
            self._upsert_profile(person, platform="quora", url=hit.url, title=hit.title, snippet=hit.snippet,
                                 match_status="anchor", match_score=1.0, source_url=hit.url,
                                 match_reasons=["Original source: Quora profile returned by the search engine"])
            try:
                self._discover_quora(person, hit)
            except Exception:
                log.exception("Enrichment failed for %s", p.full_name)
            kept += self._finalize(search, req, person, existing is None)
        return f"Quora: {kept} people."

    def _discover_quora(self, person: Person, anchor: SearchHit) -> None:
        """Name-based discovery for real-name sources (Quora, Medium). `anchor` is the original profile."""
        identity = Identity(person.full_name or "", person.company, person.job_title, person.location, person.country)
        anchor_links = [m.group(1) for m in URL_IN_TEXT.finditer(anchor.snippet or "")]
        cands: list[tuple[Candidate, str]] = []
        site_emails: dict[str, list] = {}
        gh_info: dict[str, tuple] = {}

        # 1) GitHub — official API, public fields only
        for login in self.github.search_users(identity.full_name):
            u = self.github.get_user(login)
            if not u:
                continue
            links = [x for x in [u.blog, f"https://x.com/{u.twitter}" if u.twitter else None] if x]
            cands.append((Candidate("github", u.html_url, " ".join(filter(None, [u.name, u.bio, u.company])),
                                    name=u.name, company=u.company, location=u.location, outbound_links=links),
                          f"https://api.github.com/users/{login}"))
            gh_info[u.html_url] = (u.email, u.company, u.location)

        # 2) LinkedIn — search-engine snippets only (LinkedIn prohibits automated access)
        qual = f'"{person.company}"' if person.company else (f'"{person.job_title}"' if person.job_title else "")
        try:
            for h in self.engine.search(f'site:linkedin.com/in "{identity.full_name}" {qual}', count=5):
                if "linkedin.com/in/" in h.url:
                    cands.append((Candidate("linkedin", h.url.split("?")[0], f"{h.title} {h.snippet}",
                                            name=h.title.split(" - ")[0].strip() or None), h.url))
        except SearchEngineError as e:
            log.warning("LinkedIn search failed: %s", e)

        # 3) Personal websites & portfolios — search, then polite crawl (robots.txt honored)
        site_urls: list[tuple[str, str]] = []
        for c, _ in cands:
            if c.platform == "github":
                site_urls += [(link, c.url) for link in c.outbound_links if not is_blocked(link)]
        site_urls += [(link if "://" in link else "https://" + link, anchor.url) for link in anchor_links]
        excl = " ".join(f"-site:{d}" for d in ("quora.com", "medium.com", "linkedin.com", "github.com",
                                                 "facebook.com", "x.com", "twitter.com", "instagram.com", "reddit.com"))
        try:
            for h in self.engine.search(f'"{identity.full_name}" {qual} {excl}', count=8):
                site_urls.append((h.url, h.url))
        except SearchEngineError as e:
            log.warning("Website search failed: %s", e)

        seen_hosts: set[str] = set()
        for url, src in site_urls:
            host = registered_domain(url)
            if not host or host in seen_hosts or is_blocked(url) or _host_in(url, NOT_PERSONAL_SITES):
                continue
            seen_hosts.add(host)
            if len(seen_hosts) > 6:
                break
            root = url if _host_in(url, PORTFOLIO_HOSTS) else f"https://{urlparse(url).hostname}/"
            pages, emails = crawl_site(self.fetcher, root, self.s.max_site_pages)
            if not pages:
                continue
            platform = "portfolio" if _host_in(root, PORTFOLIO_HOSTS) else "website"
            text = " ".join(p.text for p in pages)[:15000]
            links = [link for p in pages for link in p.links]
            cands.append((Candidate(platform, pages[0].url, text, outbound_links=links), src))
            site_emails[pages[0].url] = emails

        # 4) Verify: iterate so a profile verified in one pass can verify others in the next
        cluster, cluster_out = [anchor.url], list(anchor_links)
        results: dict[str, tuple] = {}
        for _ in range(3):
            changed = False
            for c, src in cands:
                r = score_candidate(identity, c, cluster, cluster_out)
                prev = results.get(c.url)
                if prev is None or prev[0].status != r.status:
                    results[c.url] = (r, c, src)
                    if r.status == "verified" and c.url not in cluster:
                        cluster.append(c.url)
                        cluster_out += c.outbound_links
                        changed = True
            if not changed:
                break

        # 5) Save profiles, conflicts and published business emails
        for url, (r, c, src) in results.items():
            if not r.status:
                continue
            self._upsert_profile(person, platform=c.platform, url=url, title=c.name, snippet=c.text[:500],
                                 match_status=r.status, match_score=r.score, match_reasons=r.reasons, source_url=src)
            if c.platform == "github" and url in gh_info:
                email, gh_company, gh_loc = gh_info[url]
                if r.status == "verified":
                    self._add_conflict(person, company_conflict(person.company, gh_company, "GitHub"))
                    if region_of(gh_loc) not in (None, person.country):
                        self._add_conflict(person, f"Location differs: GitHub says '{gh_loc}'")
                if email and self._email_ok(email):
                    self._save_contact(person, email, "email", url, "Public email field on the GitHub profile",
                                       r.status, "independently_verified" if r.status == "verified" else "self_reported")
            for e in site_emails.get(url, []):
                own_domain = email_belongs_to_site(e.value, url)
                if not self._email_ok(e.value) or not (own_domain or e.via_mailto):
                    continue
                ok = r.status == "verified" and own_domain
                self._save_contact(person, e.value, "email", e.source_url, e.evidence,
                                   "verified" if ok else "possible", "independently_verified" if ok else "self_reported")
        self.db.flush()

    # =============================================================== Medium
    def _run_medium(self, search: SearchQuery, req: SearchRequest) -> str:
        """Search-engine results for Medium authors + each author's official RSS feed. Never crawls Medium."""
        limit = req.max_candidates or self.s.max_candidates_per_search
        self._progress(search, "Medium: searching for authors…")
        authors: dict[str, medium.MediumAuthor] = {}
        for q in medium.build_queries(req):
            for key, a in medium.group_by_author(self.engine.search(q, count=20)).items():
                cur = authors.setdefault(key, a)
                if cur is not a:
                    cur.profile_snippets += a.profile_snippets
                    cur.article_snippets += a.article_snippets
            if len(authors) >= limit:
                break
        found = list(authors.values())[:limit]
        search.candidates_found += len(found)
        if not found:
            return "Medium: no matching authors found in the search index."

        self._progress(search, f"Medium: reading public feeds for {len(found)} authors…")
        for a in found:
            xml = self.fetcher.get_feed(medium.feed_url(a.username))
            if xml:
                a.display_name, a.recent_titles, a.topics = medium.parse_feed(xml)

        items = [{"index": i, "url": a.profile_url, "text": a.text()} for i, a in enumerate(found)]
        kept = 0
        for p in self.claude.extract_people(items, "medium"):
            if not p.full_name or not self._keep(p, req, search):
                continue
            a = found[p.index]
            self._progress(search, f"Medium: looking up public profiles for {p.full_name}…")
            existing = self.db.scalar(select(Profile).where(Profile.platform == "medium", Profile.url == a.profile_url))
            person = existing.person if existing else Person(source_platform="medium", skills=[])
            if not existing:
                self.db.add(person)
            self._apply_extraction(person, p)
            self.db.flush()
            snippet = "\n".join(a.profile_snippets + a.article_snippets[:2])[:1000]
            self._upsert_profile(person, platform="medium", url=a.profile_url, title=a.display_name,
                                 snippet=snippet, match_status="anchor", match_score=1.0, source_url=a.profile_url,
                                 match_reasons=["Original source: Medium author found via the search engine"
                                                + (" and their public RSS feed" if a.display_name else "")])
            try:
                self._discover_quora(person, SearchHit(a.display_name or "", a.profile_url, snippet))
            except Exception:
                log.exception("Enrichment failed for %s", p.full_name)
            kept += self._finalize(search, req, person, existing is None)
        return f"Medium: {kept} people."

    # =============================================================== Reddit
    def _reddit_query(self, req: SearchRequest) -> str:
        terms = [req.query.strip()]
        if req.profession:
            terms.append(f'"{req.profession}"')
        terms += [f'"{s}"' for s in req.skills[:3]]
        if req.company:
            terms.append(f'"{req.company}"')
        if req.require_contact:
            terms.append("(github OR email OR portfolio)")
        return " ".join(terms)

    def _run_reddit(self, search: SearchQuery, req: SearchRequest) -> str:
        limit = req.max_candidates or self.s.max_candidates_per_search
        subs = req.subreddits or [s.strip() for s in self.s.reddit_default_subreddits.split(",") if s.strip()]
        self._progress(search, f"Reddit: searching r/{'+'.join(subs)}…")
        posts: dict[str, RedditPost] = {}
        for post in self.reddit.search_posts(self._reddit_query(req), subs, limit=min(100, limit * 3)):
            posts.setdefault(post.author.lower(), post)  # newest post per author (results sorted by new)
            if len(posts) >= limit:
                break
        search.candidates_found += len(posts)
        if not posts:
            return "Reddit: no matching public posts."

        self._progress(search, f"Reddit: extracting details from {len(posts)} posts…")
        rows, bios = [], {}
        for i, post in enumerate(posts.values()):
            user = self.reddit.get_user(post.author)
            bios[post.author] = user.bio if user else ""
            text = post.text[:6000] + (f"\n\nAuthor's public profile bio: {bios[post.author]}" if bios[post.author] else "")
            rows.append({"index": i, "url": post.url, "subreddit": post.subreddit, "flair": post.link_flair, "text": text})
        plist = list(posts.values())
        kept = 0
        for p in self.claude.extract_people(rows, "reddit"):
            if not self._keep(p, req, search):
                continue
            post = plist[p.index]
            self._progress(search, f"Reddit: checking links posted by u/{post.author}…")
            person = self.db.scalar(select(Person).where(Person.reddit_username == post.author))
            is_new = person is None
            if not person:
                person = Person(source_platform="reddit", reddit_username=post.author, skills=[])
                self.db.add(person)
            self._apply_extraction(person, p)
            self.db.flush()
            self._upsert_profile(person, platform="reddit", url=post.url, title=post.title[:500],
                                 snippet=post.body[:500], match_status="anchor", match_score=1.0, source_url=post.url,
                                 external_id=post.fullname,
                                 match_reasons=[f"Original source: post by u/{post.author} in r/{post.subreddit}"])
            try:
                self._discover_reddit(person, post.url, rows[p.index]["text"], post.author)
            except Exception:
                log.exception("Reddit enrichment failed for u/%s", post.author)
            kept += self._finalize(search, req, person, is_new)
        return f"Reddit: {kept} people."

    def _run_reddit_via_search(self, search: SearchQuery, req: SearchRequest) -> str:
        """Reddit without API keys: search-engine results for public posts (title + snippet only).
        Reddit pages are never fetched. Authors are usually unknown, so people are keyed by their post."""
        limit = req.max_candidates or self.s.max_candidates_per_search
        subs = req.subreddits or [s.strip() for s in self.s.reddit_default_subreddits.split(",") if s.strip()]
        self._progress(search, f"Reddit (via search engine): searching r/{', r/'.join(subs)}…")
        posts: dict[str, tuple[SearchHit, str, str]] = {}
        # Snippets are short: favor posts whose title/opening states a location, or few would pass the region check
        hint = f'"{req.state}"' if req.state else REDDIT_REGION_HINT[frozenset(req.regions)]
        for sub_name in subs:
            for h in self.engine.search(f"site:reddit.com/r/{sub_name} {self._reddit_query(req)} {hint}", count=20):
                m = REDDIT_POST_RE.match(h.url)
                if m and m.group(2).lower() not in posts:
                    posts[m.group(2).lower()] = (h, m.group(1), m.group(2).lower())
            if len(posts) >= limit:
                break
        found = list(posts.values())[:limit]
        search.candidates_found += len(found)
        if not found:
            return "Reddit: no matching public posts in the search index."

        self._progress(search, f"Reddit: extracting details from {len(found)} post snippets…")
        rows = [{"index": i, "url": h.url, "subreddit": sub_name,
                 "text": f"{clean_reddit_title(h.title)}\n\n{h.snippet}"} for i, (h, sub_name, _) in enumerate(found)]
        kept = 0
        for p in self.claude.extract_people(rows, "reddit"):
            if not self._keep(p, req, search):
                continue
            h, sub_name, post_id = found[p.index]
            url = f"https://www.reddit.com/r/{sub_name}/comments/{post_id}/"
            title = clean_reddit_title(h.title)
            existing = self.db.scalar(select(Profile).where(Profile.platform == "reddit", Profile.url == url))
            person = existing.person if existing else Person(source_platform="reddit", skills=[],
                                                             alias=f"r/{sub_name}: {title[:80]}")
            if not existing:
                self.db.add(person)
            self._apply_extraction(person, p)
            self.db.flush()
            self._upsert_profile(person, platform="reddit", url=url, title=title[:500], snippet=h.snippet[:500],
                                 match_status="anchor", match_score=1.0, source_url=url,
                                 external_id=f"search:t3_{post_id}",
                                 match_reasons=[f"Original source: public post in r/{sub_name}, read from a "
                                                "search-engine snippet (Reddit API not configured)"])
            try:
                self._discover_reddit(person, url, rows[p.index]["text"], None)
            except Exception:
                log.exception("Reddit enrichment failed for %s", url)
            kept += self._finalize(search, req, person, existing is None)
        note = f"Reddit (search snippets): {kept} people."
        if req.require_contact and search.excluded_no_contact:
            note += (" Search snippets show only the start of each post, so GitHub links and emails are usually cut "
                     "off. Add Reddit API keys in Settings to read whole posts.")
        return note

    def _discover_reddit(self, person: Person, post_url: str, text: str, author: str | None) -> None:
        """Only links and emails the author published themselves. Verified = the linked page links back
        to the author's Reddit account (only checkable when the username is known)."""
        back = reddit_profile_urls(author) if author else []
        posted_by = f"Posted by u/{author} in their own Reddit post" if author else "Posted in the author's own Reddit post"

        # Emails written in the post/bio by the author
        for e in {m.lower() for m in EMAIL_RE.findall(text)}:
            if self._email_ok(e):
                i = text.lower().find(e)
                self._save_contact(person, e, "email", post_url, text[max(0, i - 80): i + len(e) + 80],
                                   "possible", "self_reported")

        for link in extract_links(text)[:10]:
            platform = classify_link(link)
            if not platform:
                continue
            url = link.split("#")[0]
            status, reasons, snippet = "self_reported", [posted_by], None

            if platform == "github":
                login = GITHUB_USER_RE.match(url.split("?")[0]).group(1)  # type: ignore[union-attr]
                u = self.github.get_user(login)
                if not u:
                    continue
                url = u.html_url
                snippet = " ".join(filter(None, [u.name, u.bio, u.company, u.location]))
                gh_links = [x for x in [u.blog] if x] + ([u.bio] if u.bio else [])
                if author and (links_to([x for x in gh_links if x], back[0])
                               or any(f"u/{author}".lower() in (x or "").lower() for x in gh_links)):
                    status = "verified"
                    reasons.append("GitHub profile links back to the Reddit account")
                self._add_conflict(person, company_conflict(person.company, u.company, "GitHub"))
                if region_of(u.location) not in (None, person.country):
                    self._add_conflict(person, f"Location differs: GitHub says '{u.location}'")
                if u.email and self._email_ok(u.email):
                    self._save_contact(person, u.email, "email", u.html_url, "Public email field on the GitHub profile",
                                       "verified" if status == "verified" else "possible",
                                       "independently_verified" if status == "verified" else "self_reported")
            elif platform in ("website", "portfolio"):
                pages, emails = crawl_site(self.fetcher, url, self.s.max_site_pages)
                if pages:
                    snippet = pages[0].text[:500]
                    links = [lk for pg in pages for lk in pg.links]
                    if back and any(links_to(links, b) for b in back):
                        status = "verified"
                        reasons.append("Website links back to the Reddit account")
                    for e in emails:
                        own = email_belongs_to_site(e.value, url)
                        if self._email_ok(e.value) and (own or e.via_mailto):
                            ok = status == "verified" and own
                            self._save_contact(person, e.value, "email", e.source_url, e.evidence,
                                               "verified" if ok else "possible",
                                               "independently_verified" if ok else "self_reported")
            # linkedin / social: not fetched (ToS) — kept as self-reported links

            self._upsert_profile(person, platform=platform, url=url, snippet=snippet, match_status=status,
                                 match_score=0.95 if status == "verified" else 0.7, match_reasons=reasons,
                                 source_url=post_url)
        self.db.flush()


# =================================================================== jobs
def run_search_job(search_id: int) -> None:
    """Background-task / Celery entry point."""
    db = SessionLocal()
    try:
        search = db.get(SearchQuery, search_id)
        if not search:
            return
        try:
            SearchJob(db).run(search)
        except Exception as e:  # surface the failure to the UI instead of a stuck "running" job
            log.exception("Search %s failed", search_id)
            db.rollback()
            search = db.get(SearchQuery, search_id)
            search.status, search.message = "failed", f"{type(e).__name__}: {e}"
            search.finished_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


def purge_deleted_reddit(db: Session, client: RedditClient | None = None) -> int:
    """Delete records whose source Reddit post was deleted/removed (Reddit Data API Terms)."""
    client = client or RedditClient(get_settings())
    profs = list(db.scalars(select(Profile).where(Profile.platform == "reddit", Profile.external_id.like("t3_%"))))
    if not profs:
        return 0
    alive = client.existing_fullnames([p.external_id for p in profs if p.external_id])
    removed = 0
    for prof in profs:
        if prof.external_id not in alive:
            person = prof.person
            db.delete(prof)
            db.flush()
            if not any(x.platform == "reddit" and x.match_status == "anchor" and x.id != prof.id
                       for x in person.profiles):
                db.delete(person)  # their only Reddit source is gone → remove everything derived from it
            removed += 1
    db.commit()
    return removed


SNIPPET_RETENTION_DAYS = 30


def purge_stale_reddit_snippets(db: Session, days: int = SNIPPET_RETENTION_DAYS) -> int:
    """Records found through search snippets can't be checked for deletion without the Reddit API,
    so they expire after `days` days (re-run a search to refresh them)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    removed = 0
    for prof in list(db.scalars(select(Profile).where(Profile.platform == "reddit",
                                                       Profile.external_id.like("search:%")))):
        found = prof.discovered_at if prof.discovered_at.tzinfo else prof.discovered_at.replace(tzinfo=timezone.utc)
        if found < cutoff:
            person = prof.person
            db.delete(prof)
            db.flush()
            if not any(x.platform == "reddit" and x.match_status == "anchor" and x.id != prof.id
                       for x in person.profiles):
                db.delete(person)
            removed += 1
    db.commit()
    return removed
