from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .config import EDITABLE_KEYS, SECRET_KEYS, get_settings, save_user_settings
from .db import get_db
from .models import Contact, Person, Profile, SearchQuery, SearchResult
from .schemas import (AssistantReply, AssistantRequest, DuplicateGroup, PersonDetail, PersonSummary, PersonUpdate,
                      SearchOut, SearchRequest, SearchWithResults)
from .services.ai import ClaudeService
from .services.rules import RuleBasedAI, use_claude
from .services.export import to_csv, to_xlsx
from .services.pipeline import purge_deleted_reddit, run_search_job
from .services.quality import refresh_quality
from .services.medium import parse_medium_url
from .services.quora import profile_slug
from .services.verify import norm

router = APIRouter(prefix="/api")


def _summary(p: Person) -> PersonSummary:
    s = PersonSummary.model_validate(p)
    s.profile_count = sum(1 for x in p.profiles if x.match_status != "anchor")
    s.verified_count = sum(1 for x in p.profiles if x.match_status == "verified")
    s.contact_count = len(p.contacts)
    return s


def _load_people(db: Session, stmt) -> list[Person]:
    return list(db.scalars(stmt.options(selectinload(Person.profiles), selectinload(Person.contacts))).unique())


def _record(p: Person) -> dict:
    """Plain-data view of a person for the AI assistant (only stored facts + sources)."""
    return PersonDetail.model_validate(p).model_dump(mode="json")


def _ai():
    s = get_settings()
    return ClaudeService(s) if use_claude(s) else RuleBasedAI(s)


def _get_person(db: Session, person_id: int) -> Person:
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    return p


@router.get("/health")
def health():
    s = get_settings()
    return {"status": "ok", "search_provider": s.search_provider, "regions": [x.strip() for x in s.regions.split(",") if x.strip()],
            "ai_model": s.claude_model, "reddit_configured": bool(s.reddit_client_id and s.reddit_client_secret),
            "ai_mode": "claude" if use_claude(s) else "rules",
            "reddit_mode": "api" if (s.reddit_client_id and s.reddit_client_secret) else "search",
            "background": "celery" if s.celery_broker_url else "in-process",
            "default_subreddits": s.reddit_default_subreddits.split(",")}


# --- searches ----------------------------------------------------------------
@router.post("/searches", response_model=SearchOut, status_code=202)
def create_search(req: SearchRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    if req.query_type == "url":
        if profile_slug(req.query):
            req.sources = ["quora"]
        elif parse_medium_url(req.query):
            req.sources = ["medium"]
        else:
            raise HTTPException(422, "Enter a Quora or Medium profile URL, e.g. https://www.quora.com/profile/Jane-Doe "
                                     "or https://medium.com/@janedoe")
    if not req.sources:
        raise HTTPException(422, "Choose at least one source")
    search = SearchQuery(query=req.query.strip(), query_type=req.query_type, sources=list(req.sources),
                         filters=req.model_dump(exclude={"query", "query_type", "sources"}), status="pending")
    db.add(search)
    db.commit()
    if get_settings().celery_broker_url:
        from .tasks import run_search

        run_search.delay(search.id)
    else:
        background.add_task(run_search_job, search.id)
    return search


@router.get("/searches", response_model=list[SearchOut])
def list_searches(limit: int = Query(50, le=200), db: Session = Depends(get_db)):
    return list(db.scalars(select(SearchQuery).order_by(SearchQuery.created_at.desc()).limit(limit)))


@router.get("/searches/{search_id}", response_model=SearchWithResults)
def get_search(search_id: int, db: Session = Depends(get_db)):
    search = db.get(SearchQuery, search_id)
    if not search:
        raise HTTPException(404, "Search not found")
    people = _load_people(db, select(Person).join(SearchResult).where(SearchResult.search_id == search_id)
                          .order_by(SearchResult.relevance.desc()))
    out = SearchWithResults.model_validate(search)
    out.people = [_summary(p) for p in people]
    return out


@router.delete("/searches/{search_id}", status_code=204)
def delete_search(search_id: int, db: Session = Depends(get_db)):
    search = db.get(SearchQuery, search_id)
    if search:
        db.delete(search)
        db.commit()


# --- people ------------------------------------------------------------------
class PeopleFilter(BaseModel):
    q: str | None = None
    platform: Literal["quora", "medium", "reddit"] | None = None
    country: str | None = None
    location: str | None = None  # city or state
    title: str | None = None
    company: str | None = None
    industry: str | None = None
    skill: str | None = None
    language: str | None = None
    min_years: int | None = None
    max_years: int | None = None
    freelance: bool | None = None
    has_contact: bool = False
    verified_only: bool = False
    tag: str | None = None
    category: str | None = None
    search_id: int | None = None


def _filter_people(db: Session, f: PeopleFilter, limit: int = 1000) -> list[Person]:
    stmt = select(Person)
    if f.q:
        like = f"%{f.q.strip().removeprefix('u/')}%"
        stmt = stmt.where(or_(Person.full_name.ilike(like), Person.reddit_username.ilike(like),
                              Person.job_title.ilike(like), Person.company.ilike(like)))
    for col, val in ((Person.source_platform, f.platform), (Person.country, f.country)):
        if val:
            stmt = stmt.where(col == val)
    for col, val in ((Person.job_title, f.title), (Person.company, f.company), (Person.industry, f.industry),
                     (Person.category, f.category)):
        if val:
            stmt = stmt.where(col.ilike(f"%{val}%"))
    if f.location:
        like = f"%{f.location}%"
        stmt = stmt.where(or_(Person.city.ilike(like), Person.state.ilike(like), Person.location.ilike(like)))
    if f.min_years is not None:
        stmt = stmt.where(Person.years_experience >= f.min_years)
    if f.max_years is not None:
        stmt = stmt.where(Person.years_experience <= f.max_years)
    if f.freelance is not None:
        stmt = stmt.where(Person.freelance_available.is_(f.freelance))
    if f.verified_only:
        stmt = stmt.where(Person.profiles.any(Profile.match_status == "verified"))
    if f.has_contact:
        stmt = stmt.where(Person.contacts.any())
    if f.search_id:
        stmt = stmt.join(SearchResult).where(SearchResult.search_id == f.search_id)
    people = _load_people(db, stmt.order_by(Person.updated_at.desc()).limit(limit))

    # JSON-array filters in Python, for portability across Postgres/SQLite
    def has(values: list, needle: str | None) -> bool:
        return not needle or any(needle.lower() in v.lower() for v in values or [])

    return [p for p in people if has(p.skills + p.programming_languages, f.skill)
            and has(p.programming_languages, f.language) and has(p.tags, f.tag)]


@router.get("/people", response_model=list[PersonSummary])
def list_people(f: PeopleFilter = Depends(), limit: int = Query(500, le=2000), db: Session = Depends(get_db)):
    return [_summary(p) for p in _filter_people(db, f, limit)]


@router.get("/people/duplicates", response_model=list[DuplicateGroup])
def find_duplicates(db: Session = Depends(get_db)):
    """Records that probably describe the same person: shared profile URL, shared email, or same name+company."""
    people = _load_people(db, select(Person))
    by_id = {p.id: p for p in people}
    parent = {p.id: p.id for p in people}
    reason: dict[int, set[str]] = defaultdict(set)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(ids: list[int], why: str):
        for other in ids[1:]:
            a, b = find(ids[0]), find(other)
            if a != b:
                parent[b] = a
        for i in ids:
            reason[i].add(why)

    keys: dict[tuple, list[int]] = defaultdict(list)
    for p in people:
        for x in p.profiles:
            if x.match_status in ("verified", "self_reported", "anchor"):
                keys[("Same profile URL", x.url.rstrip("/").lower())].append(p.id)
        for c in p.contacts:
            keys[("Same email", c.value)].append(p.id)
        if p.full_name and p.company:
            keys[("Same name and company", norm(p.full_name) + "|" + norm(p.company))].append(p.id)
    for (why, _), ids in keys.items():
        ids = sorted(set(ids))
        if len(ids) > 1:
            union(ids, why)

    groups: dict[int, list[int]] = defaultdict(list)
    for pid in by_id:
        groups[find(pid)].append(pid)
    out = []
    for members in groups.values():
        if len(members) > 1:
            why = sorted(set().union(*(reason[m] for m in members)))
            out.append(DuplicateGroup(reason=", ".join(why), people=[_summary(by_id[m]) for m in sorted(members)]))
    return out


@router.get("/people/{person_id}", response_model=PersonDetail)
def get_person(person_id: int, db: Session = Depends(get_db)):
    return _get_person(db, person_id)


@router.patch("/people/{person_id}", response_model=PersonDetail)
def update_person(person_id: int, body: PersonUpdate, db: Session = Depends(get_db)):
    p = _get_person(db, person_id)
    changes = body.model_dump(exclude_unset=True)
    organizational = {"category", "tags", "notes"}
    for k, v in changes.items():
        if isinstance(v, list):
            v = [x.strip() for x in v if x and x.strip()]
        setattr(p, k, v)
    edited = set(p.edited_fields or []) | (set(changes) - organizational)
    p.edited_fields = sorted(edited)
    refresh_quality(p)
    db.commit()
    db.refresh(p)
    return p


class MergeBody(BaseModel):
    other_id: int


@router.post("/people/{person_id}/merge", response_model=PersonDetail)
def merge_people(person_id: int, body: MergeBody, db: Session = Depends(get_db)):
    """Merge `other_id` into `person_id`. Fills empty fields only; keeps all sources."""
    if person_id == body.other_id:
        raise HTTPException(422, "Cannot merge a record into itself")
    keep, other = _get_person(db, person_id), _get_person(db, body.other_id)
    for f in ("full_name", "reddit_username", "alias", "job_title", "company", "industry", "experience", "years_experience",
              "freelance_available", "location", "city", "state", "location_evidence", "category", "notes"):
        if getattr(keep, f) in (None, "") and getattr(other, f) not in (None, ""):
            setattr(keep, f, getattr(other, f))
    for f in ("skills", "programming_languages", "interests", "tags", "conflicts", "edited_fields"):
        setattr(keep, f, sorted(set(getattr(keep, f) or []) | set(getattr(other, f) or [])))
    urls = {x.url for x in keep.profiles}
    for x in list(other.profiles):
        if x.url not in urls:
            x.person = keep
    values = {c.value for c in keep.contacts}
    for c in list(other.contacts):
        if c.value not in values:
            c.person = keep
    keep_searches = {r.search_id for r in db.scalars(select(SearchResult).where(SearchResult.person_id == keep.id))}
    for r in db.scalars(select(SearchResult).where(SearchResult.person_id == other.id)):
        if r.search_id not in keep_searches:
            r.person_id = keep.id
    db.flush()
    db.delete(other)
    db.flush()
    db.refresh(keep)
    refresh_quality(keep)
    db.commit()
    return keep


@router.delete("/people/{person_id}", status_code=204)
def delete_person(person_id: int, db: Session = Depends(get_db)):
    """Removes a person and everything stored about them (also used for removal requests)."""
    p = db.get(Person, person_id)
    if p:
        db.delete(p)
        db.commit()


@router.delete("/people/{person_id}/profiles/{profile_id}", status_code=204)
def reject_profile(person_id: int, profile_id: int, db: Session = Depends(get_db)):
    """Discard a wrong match (the original source can't be removed; delete the person instead)."""
    prof = db.get(Profile, profile_id)
    if prof and prof.person_id == person_id and prof.match_status != "anchor":
        person = prof.person
        db.delete(prof)
        db.flush()
        db.refresh(person)
        refresh_quality(person)
        db.commit()


@router.delete("/people/{person_id}/contacts/{contact_id}", status_code=204)
def delete_contact(person_id: int, contact_id: int, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if c and c.person_id == person_id:
        person = c.person
        db.delete(c)
        db.flush()
        db.refresh(person)
        refresh_quality(person)
        db.commit()


@router.post("/people/{person_id}/summary", response_model=PersonDetail)
def summarize_person(person_id: int, db: Session = Depends(get_db)):
    p = _get_person(db, person_id)
    p.ai_summary = _ai().summarize(_record(p))
    db.commit()
    db.refresh(p)
    return p


@router.get("/tags")
def list_tags(db: Session = Depends(get_db)):
    tags, cats = Counter(), Counter()
    for p in db.scalars(select(Person)):
        tags.update(p.tags or [])
        if p.category:
            cats[p.category] += 1
    return {"tags": [{"name": k, "count": v} for k, v in tags.most_common()],
            "categories": [{"name": k, "count": v} for k, v in cats.most_common()]}


# --- assistant ---------------------------------------------------------------
@router.post("/assistant", response_model=AssistantReply)
def assistant(req: AssistantRequest, db: Session = Depends(get_db)):
    record = _record(_get_person(db, req.person_id)) if req.person_id else None
    if req.messages[-1].role != "user":
        raise HTTPException(422, "Last message must be from the user")
    reply = _ai().chat([m.model_dump() for m in req.messages], record)
    return AssistantReply(reply=reply)


# --- export ------------------------------------------------------------------
@router.get("/export")
def export(format: Literal["csv", "xlsx"] = "csv", f: PeopleFilter = Depends(),
           ids: str | None = Query(None, description="Comma-separated person ids"), db: Session = Depends(get_db)):
    people = _filter_people(db, f, limit=100_000)
    if ids:
        wanted = {int(x) for x in ids.split(",") if x.strip().isdigit()}
        people = [p for p in people if p.id in wanted]
    name = f"contacts{'-search-' + str(f.search_id) if f.search_id else ''}"
    if format == "xlsx":
        return Response(to_xlsx(people), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})
    return Response(to_csv(people), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


# --- stats & analytics -------------------------------------------------------
@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    return {
        "people": db.scalar(select(func.count(Person.id))),
        "verified_profiles": db.scalar(select(func.count(Profile.id)).where(Profile.match_status == "verified")),
        "possible_profiles": db.scalar(select(func.count(Profile.id))
                                       .where(Profile.match_status.in_(["possible", "self_reported"]))),
        "emails": db.scalar(select(func.count(Contact.id))),
        "searches": db.scalar(select(func.count(SearchQuery.id))),
    }


@router.get("/analytics")
def analytics(db: Session = Depends(get_db)):
    people = _load_people(db, select(Person))
    status = Counter(x.match_status for p in people for x in p.profiles if x.match_status != "anchor")
    provenance = Counter(c.provenance for p in people for c in p.contacts)
    since = datetime.now(timezone.utc) - timedelta(days=30)
    per_day = Counter()
    for s in db.scalars(select(SearchQuery)):
        created = s.created_at if s.created_at.tzinfo else s.created_at.replace(tzinfo=timezone.utc)
        if created >= since:
            per_day[created.date().isoformat()] += 1
    buckets = Counter(min(4, int(p.confidence * 5)) for p in people)
    top = lambda c, n=10: [{"name": k, "count": v} for k, v in c.most_common(n)]  # noqa: E731
    return {
        "by_platform": top(Counter(p.source_platform for p in people)),
        "by_state": top(Counter(p.state for p in people if p.state)),
        "top_skills": top(Counter(s for p in people for s in p.skills), 12),
        "top_languages": top(Counter(s for p in people for s in p.programming_languages), 12),
        "profile_status": top(status),
        "contact_provenance": top(provenance),
        "freelance": {"available": sum(1 for p in people if p.freelance_available),
                      "not_stated": sum(1 for p in people if p.freelance_available is None)},
        "with_contact": sum(1 for p in people if p.contacts),
        "confidence_histogram": [{"name": f"{i * 20}–{i * 20 + 20}%", "count": buckets.get(i, 0)} for i in range(5)],
        "searches_per_day": [{"name": d, "count": per_day[d]} for d in sorted(per_day)],
        "total_people": len(people),
    }


# --- settings (desktop app) ---------------------------------------------------
SEARCH_PROVIDERS = ("tavily", "serper", "brave", "google")
PROVIDER_KEYS = {"tavily": ("tavily_api_key",), "serper": ("serper_api_key",), "brave": ("brave_api_key",),
                 "google": ("google_api_key", "google_cse_id")}


def _mask(v: str | None) -> str:
    return "" if not v else ("•" * 8 + v[-4:] if len(v) > 8 else "•" * len(v))


@router.get("/settings")
def read_settings():
    s = get_settings()
    values = {k: (_mask(getattr(s, k)) if k in SECRET_KEYS else getattr(s, k) or "") for k in EDITABLE_KEYS}
    configured = {k: bool(getattr(s, k)) for k in EDITABLE_KEYS}
    # The built-in user agent is a placeholder; Reddit requires the real username in it
    configured["reddit_user_agent"] = "your_reddit_username" not in (s.reddit_user_agent or "your_reddit_username")
    from .services.search_engine import SearchEngine
    provider = SearchEngine(s).provider()  # selected provider, or whichever one has a key
    search_ready = all(getattr(s, k, None) for k in PROVIDER_KEYS.get(provider, ("_",)))
    return {"editable": s.settings_editable, "values": values, "configured": configured, "search_ready": search_ready,
            "active_provider": provider, "ai_active": "claude" if use_claude(s) else "rules"}


@router.put("/settings")
def write_settings(body: dict[str, str]):
    if not get_settings().settings_editable:
        raise HTTPException(403, "Settings can only be edited in the desktop app; edit .env instead")
    # Masked values come back unchanged from the form: ignore them so we don't overwrite the real key
    changes = {k: v for k, v in body.items() if k in EDITABLE_KEYS and "•" not in (v or "")}
    if "ai_mode" in changes and changes["ai_mode"] not in ("auto", "off"):
        raise HTTPException(422, "ai_mode must be 'auto' or 'off'")
    if "search_provider" in changes and changes["search_provider"] not in SEARCH_PROVIDERS:
        raise HTTPException(422, f"search_provider must be one of: {', '.join(SEARCH_PROVIDERS)}")
    save_user_settings(changes)
    return read_settings()


# --- compliance --------------------------------------------------------------
@router.post("/maintenance/reddit-sync")
def reddit_sync(db: Session = Depends(get_db)):
    """Remove records whose source Reddit post was deleted or removed."""
    return {"removed": purge_deleted_reddit(db)}
