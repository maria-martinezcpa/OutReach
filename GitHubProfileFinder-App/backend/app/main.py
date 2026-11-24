import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from .config import settings
from .github_client import GitHubClient, GitHubError, RateLimitError
from .jobs import JobCreate, JobManager, JobState
from . import drafts
from .drafts import DraftSettings, DraftStore, OpenRequest
from .seen import SeenStore
from .models import Account, Profile, SavedEntry, SavedUpdate, SaveRequest, SearchResponse
from .service import ProfileService, SearchParams
from .storage import Store, profile_to_row, to_csv
from .suggest import SuggestionIndex
from .github_app import GitHubAppAuth, GitHubAppConfig, GitHubAppError
from .tokens import APP_ID, TokenCreate, TokenInfo, TokenStore, check_token, mask

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("app")

LOGIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    tokens = TokenStore(settings.data_dir, settings.github_token)
    gh = GitHubClient(tokens.active_token())
    store = Store(settings.data_dir, settings.cache_ttl_hours)
    app.state.tokens = tokens
    app.state.gh = gh
    app.state.store = store
    app.state.service = ProfileService(gh, store, settings.period_repo_check_limit)
    app.state.jobs = JobManager(app.state.service, gh, settings.data_dir)
    app.state.jobs.load()
    app.state.app_config = GitHubAppConfig(settings.data_dir, settings.github_app_id,
                                           settings.github_app_installation_id, settings.github_app_private_key_path)
    app.state.app_auth = None
    cfg = app.state.app_config.load()
    if cfg:
        app.state.app_auth = GitHubAppAuth(cfg["app_id"], cfg["private_key"], cfg.get("installation_id"))
        tokens.github_app_configured = True
    try:
        await apply_active_token(app)
    except GitHubAppError as e:
        log.error("GitHub App token could not be created: %s", e)
    renewer = asyncio.create_task(_renew_app_token(app), name="github-app-renewal")
    app.state.drafts = DraftStore(settings.data_dir)
    app.state.seen = SeenStore(settings.data_dir)
    app.state.suggest = SuggestionIndex(gh, store, settings.data_dir)
    app.state.suggest.start()
    if not gh.has_token:
        log.warning("No GitHub token configured: GitHub allows only 60 requests/hour without one")
    yield
    renewer.cancel()
    await app.state.suggest.stop()
    await app.state.jobs.shutdown()
    store.flush_cache()  # write profiles fetched since the last background flush
    await gh.close()


app = FastAPI(
    title="GitHub Profile Finder API",
    version="1.0.0",
    description="Search GitHub users, collect self-published public contact details and analyse public activity.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimitError)
async def rate_limit_handler(_: Request, exc: RateLimitError):
    reset = datetime.fromtimestamp(exc.reset_at, timezone.utc).isoformat() if exc.reset_at else None
    detail = exc.message + (f". Limit resets at {reset}" if reset else "")
    return JSONResponse(status_code=429, content={"detail": detail, "reset_at": reset})


@app.exception_handler(GitHubError)
async def github_error_handler(_: Request, exc: GitHubError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


def service(request: Request) -> ProfileService:
    return request.app.state.service


def store(request: Request) -> Store:
    return request.app.state.store


def valid_login(login: str) -> str:
    if not LOGIN_RE.match(login):
        raise HTTPException(400, "Invalid GitHub username")
    return login


@app.get("/api/health")
async def health(request: Request):
    gh: GitHubClient = request.app.state.gh
    return {"status": "ok", "github_token_configured": gh.has_token}


@app.get("/api/rate-limit")
async def rate_limit(request: Request):
    """Real quota of the active token, from the headers of GitHub's responses (see GitHubClient.current_rate)."""
    return await request.app.state.gh.current_rate()


def _with_live_quota(info: TokenInfo, gh: GitHubClient) -> TokenInfo:
    """For the active token, use the most recent quota the app's own requests saw."""
    if not info.active:
        return info
    core, live_core = info.core, gh.live_rate("core")
    if live_core and (not core or live_core["observed_at"] >= core.get("observed_at", 0)):
        core = live_core
    return info.model_copy(update={"core": core, "search": gh.live_rate("search") or info.search})


@app.get("/api/search", response_model=SearchResponse)
async def search(params: Annotated[SearchParams, Query()], svc: ProfileService = Depends(service)):
    try:
        return await svc.search(params)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _error_detail(e: Exception) -> str:
    if isinstance(e, RateLimitError) and e.reset_at:
        reset = datetime.fromtimestamp(e.reset_at, timezone.utc).astimezone().strftime("%H:%M")
        return f"{e.message}. It resets at {reset}."
    if isinstance(e, (GitHubError,)):
        return e.message
    return str(e)


@app.get("/api/search/stream")
async def search_stream(request: Request, svc: ProfileService = Depends(service)):
    """Server-sent events: `progress` counters, one `item` per matching profile as soon as it is found,
    then `done` (page summary) or `failed` ({detail})."""

    async def events():
        try:
            params = SearchParams.model_validate(dict(request.query_params))
        except ValidationError as e:
            msg = str(e.errors()[0].get("msg", "invalid value")).removeprefix("Value error, ")
            yield _sse("failed", {"detail": f"Invalid search: {msg}"})
            return

        queue: asyncio.Queue = asyncio.Queue()

        async def on_item(p: Profile) -> None:
            await queue.put(("item", p.model_dump(mode="json")))

        async def on_progress(d: dict) -> None:
            await queue.put(("progress", d))

        async def run() -> None:
            try:
                resp = await svc.search(params, on_item=on_item, on_progress=on_progress)
                await queue.put(("done", resp.model_dump(mode="json", exclude={"items"})))
            except (ValueError, GitHubError) as e:
                await queue.put(("failed", {"detail": _error_detail(e)}))
            except Exception:
                log.exception("Streaming search failed")
                await queue.put(("failed", {"detail": "Unexpected server error"}))
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        try:
            while (msg := await queue.get()) is not None:
                yield _sse(*msg)
        finally:
            task.cancel()  # client went away: stop spending API calls

    return StreamingResponse(
        events(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/suggest")
async def suggest(request: Request, field: Literal["keyword", "language", "location", "country", "region"],
                  q: str = Query("", max_length=100)):
    return await request.app.state.suggest.suggest(field, q)


@app.get("/api/suggest/status")
async def suggest_status(request: Request):
    return request.app.state.suggest.status()


@app.get("/api/profiles/{login}", response_model=Profile)
async def get_profile(login: str, refresh: bool = False, svc: ProfileService = Depends(service)):
    return await svc.get_profile(valid_login(login), refresh=refresh)


@app.delete("/api/profiles/{login}")
async def delete_profile_data(login: str, st: Store = Depends(store)):
    """Remove every stored copy of this user's data (cache and saved list)."""
    valid_login(login)
    return {"cache_removed": st.delete_cached(login), "saved_removed": st.unsave(login)}


@app.get("/api/saved", response_model=list[SavedEntry])
async def list_saved(st: Store = Depends(store)):
    return st.list_saved()


@app.get("/api/saved/summary")
async def saved_summary(st: Store = Depends(store)):
    """Counts for the navigation badge; the date is this computer's local date."""
    return {"total": len(st.saved_logins()), "follow_ups_due": st.follow_ups_due(date.today())}


@app.post("/api/saved/{login}", response_model=SavedEntry)
async def save_profile(login: str, body: Optional[SaveRequest] = None,
                       svc: ProfileService = Depends(service), st: Store = Depends(store)):
    profile = await svc.get_profile(valid_login(login))
    return st.save(profile, body.note if body else "")


@app.patch("/api/saved/{login}", response_model=SavedEntry)
async def update_saved(login: str, body: SavedUpdate, st: Store = Depends(store)):
    entry = st.update_saved(valid_login(login), body.model_dump(exclude_unset=True, mode="json"))
    if not entry:
        raise HTTPException(404, "Profile is not saved")
    return entry


@app.delete("/api/saved/{login}")
async def unsave_profile(login: str, st: Store = Depends(store)):
    if not st.unsave(valid_login(login)):
        raise HTTPException(404, "Profile is not saved")
    return {"removed": login}


@app.delete("/api/saved")
async def clear_saved(st: Store = Depends(store)):
    return {"removed": st.clear_saved()}


@app.get("/api/export/{fmt}")
async def export(
    fmt: Literal["csv", "json"],
    logins: Optional[str] = Query(None, description="Comma-separated usernames; defaults to all saved profiles"),
    svc: ProfileService = Depends(service),
    st: Store = Depends(store),
):
    if logins:
        names = [valid_login(l.strip()) for l in logins.split(",") if l.strip()][:200]
        profiles = [await svc.get_profile(n) for n in names]
        rows = [profile_to_row(p) for p in profiles]
        full = [p.model_dump(mode="json") for p in profiles]
    else:
        saved = st.list_saved()
        rows = st.saved_rows()
        full = [e.model_dump(mode="json") for e in saved]
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if fmt == "csv":
        return Response(
            "﻿" + to_csv(rows), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="github-profiles-{stamp}.csv"'},
        )
    return Response(
        json.dumps({"exported_at": stamp, "count": len(full), "profiles": full}, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="github-profiles-{stamp}.json"'},
    )


@app.get("/api/history")
async def history(st: Store = Depends(store)):
    return st.list_history()


@app.delete("/api/history")
async def clear_history(st: Store = Depends(store)):
    st.clear_history()
    return {"cleared": True}


# --- Background searches -------------------------------------------------------------


def jobs(request: Request) -> JobManager:
    return request.app.state.jobs


def get_job(job_id: str, mgr: JobManager = Depends(jobs)) -> JobState:
    try:
        return mgr.get(job_id)
    except KeyError:
        raise HTTPException(404, "Background search not found") from None


@app.post("/api/jobs", response_model=JobState, status_code=201)
async def create_job(req: JobCreate, mgr: JobManager = Depends(jobs)):
    try:
        return mgr.create(req)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/jobs", response_model=list[JobState])
async def list_jobs(mgr: JobManager = Depends(jobs)):
    return mgr.list()


@app.get("/api/jobs/{job_id}", response_model=JobState)
async def job_detail(job: JobState = Depends(get_job)):
    return job


@app.get("/api/accounts", response_model=list[Account])
async def all_accounts(mgr: JobManager = Depends(jobs), st: Store = Depends(store)):
    """Everyone found by any background search, once each (newest search first), with the searches that
    found them. Filtering (by email, domain, skill…) happens in the interface."""
    saved = st.saved_logins()
    accounts: dict[str, Account] = {}
    for job in sorted(mgr.list(), key=lambda j: j.created_at, reverse=True):
        for p in mgr.results.get(job.id, []):
            key = p.login.lower()
            if key in accounts:
                if job.name not in accounts[key].found_in:
                    accounts[key].found_in.append(job.name)
            else:
                accounts[key] = Account(**p.model_dump(), found_in=[job.name]).model_copy(update={"saved": key in saved})
    return list(accounts.values())


class RemoveAccounts(BaseModel):
    logins: list[str] = Field(min_length=1, max_length=5000)


@app.post("/api/accounts/remove")
async def remove_accounts(body: RemoveAccounts, request: Request, mgr: JobManager = Depends(jobs), st: Store = Depends(store)):
    """Delete everything stored about these people: search results, profile cache and Saved list."""
    logins = {valid_login(l.strip()).lower() for l in body.logins}
    from_searches = mgr.remove_accounts(logins)
    cache = sum(st.delete_cached(l) for l in logins)
    saved = sum(st.unsave(l) for l in logins)
    request.app.state.seen.unmark(logins)
    return {"accounts": len(logins), "search_results_removed": from_searches, "cache_removed": cache, "saved_removed": saved}


class SeenChange(BaseModel):
    logins: list[str] = Field(min_length=1, max_length=5000)
    seen: bool = True


@app.get("/api/seen")
async def list_seen(request: Request) -> dict[str, str]:
    """People already looked at: lowercase login -> when first seen."""
    return request.app.state.seen.all()


@app.post("/api/seen")
async def change_seen(body: SeenChange, request: Request):
    logins = {valid_login(l.strip()).lower() for l in body.logins}
    st: SeenStore = request.app.state.seen
    changed = st.mark(logins) if body.seen else st.unmark(logins)
    return {"changed": changed, "total": len(st.all())}


@app.get("/api/jobs/{job_id}/results", response_model=list[Profile])
async def job_results(offset: int = Query(0, ge=0), job: JobState = Depends(get_job),
                      mgr: JobManager = Depends(jobs), st: Store = Depends(store)):
    saved = st.saved_logins()
    return [p.model_copy(update={"saved": p.login.lower() in saved}) for p in mgr.results[job.id][offset:]]


@app.post("/api/jobs/{job_id}/pause", response_model=JobState)
async def pause_job(job: JobState = Depends(get_job), mgr: JobManager = Depends(jobs)):
    return await mgr.pause(job.id)


@app.post("/api/jobs/{job_id}/resume", response_model=JobState)
async def resume_job(extra: int = Query(0, ge=0), job: JobState = Depends(get_job),
                     mgr: JobManager = Depends(jobs)):
    try:
        return mgr.resume(job.id, extra)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/jobs/{job_id}/wake", response_model=JobState)
async def wake_job(job: JobState = Depends(get_job), mgr: JobManager = Depends(jobs)):
    """Stop waiting for the rate limit and try again now."""
    if job.status != "waiting":
        raise HTTPException(400, "This search is not waiting")
    mgr.wake_waiting()
    return job


@app.delete("/api/jobs/{job_id}")
async def delete_job(job: JobState = Depends(get_job), mgr: JobManager = Depends(jobs)):
    await mgr.delete(job.id)
    return {"deleted": job.id}


@app.post("/api/jobs/{job_id}/save-all")
async def save_job_results(job: JobState = Depends(get_job), mgr: JobManager = Depends(jobs),
                           st: Store = Depends(store)):
    return {"saved": len(st.save_many(mgr.results[job.id]))}


@app.get("/api/jobs/{job_id}/export/{fmt}")
async def export_job(fmt: Literal["csv", "json"], job: JobState = Depends(get_job), mgr: JobManager = Depends(jobs)):
    profiles = mgr.results[job.id]
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", job.name)[:40].strip("-") or job.id
    if fmt == "csv":
        return Response(
            "\ufeff" + to_csv(profile_to_row(p) for p in profiles), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="search-{safe}.csv"'},
        )
    body = {"search": job.model_dump(), "count": len(profiles), "profiles": [p.model_dump(mode="json") for p in profiles]}
    return Response(
        json.dumps(body, indent=2, ensure_ascii=False), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="search-{safe}.json"'},
    )


# --- GitHub tokens -------------------------------------------------------------------


def tokens(request: Request) -> TokenStore:
    return request.app.state.tokens


async def apply_active_token(app: FastAPI) -> None:
    """Point the GitHub client at the active token and wake searches waiting on a rate limit."""
    ts: TokenStore = app.state.tokens
    if ts.active_id() == APP_ID and app.state.app_auth:
        token = await app.state.app_auth.token()
    else:
        token = ts.active_token()
    app.state.gh.set_token(token)
    if hasattr(app.state, "jobs"):
        app.state.jobs.wake_waiting()


async def _renew_app_token(app: FastAPI) -> None:
    """GitHub App installation tokens expire after one hour: renew them shortly before that."""
    while True:
        await asyncio.sleep(60)
        auth: Optional[GitHubAppAuth] = app.state.app_auth
        if auth and app.state.tokens.active_id() == APP_ID and auth.needs_renewal():
            try:
                app.state.gh.set_token(await auth.token(force=True))
                log.info("Renewed GitHub App installation token")
            except GitHubAppError as e:
                log.error("Could not renew GitHub App token: %s", e)


async def _apply_active_token(request: Request) -> None:
    try:
        await apply_active_token(request.app)
    except GitHubAppError as e:
        raise HTTPException(400, str(e)) from e


async def _app_token_info(request: Request, active: Optional[str]) -> Optional[TokenInfo]:
    auth: Optional[GitHubAppAuth] = request.app.state.app_auth
    if not auth:
        return None
    base = {"id": APP_ID, "label": f"GitHub App{f': {auth.app_name}' if auth.app_name else ''}",
            "masked": "installation token (renewed automatically)", "source": "github_app", "active": active == APP_ID}
    try:
        check = await check_token(await auth.token())
    except GitHubAppError as e:
        return TokenInfo(**base, valid=False, error=str(e))
    check["login"] = auth.account or check.get("login")
    return TokenInfo(**base, added_at=auth.expires_at, **check)


@app.get("/api/tokens", response_model=list[TokenInfo])
async def list_tokens(request: Request, ts: TokenStore = Depends(tokens)):
    active = ts.active_id()
    entries = ts.entries()
    app_info, *checks = await asyncio.gather(_app_token_info(request, active),
                                             *(check_token(e["token"]) for e in entries))
    infos = ([app_info] if app_info else []) + [
        TokenInfo(id=e["id"], label=e["label"], masked=mask(e["token"]), source=e["source"], added_at=e["added_at"],
                  active=e["id"] == active, **{"login": e["login"], **c})
        for e, c in zip(entries, checks)
    ]
    return [_with_live_quota(i, request.app.state.gh) for i in infos]


@app.post("/api/tokens", response_model=TokenInfo, status_code=201)
async def add_token(body: TokenCreate, request: Request, ts: TokenStore = Depends(tokens)):
    token = body.token.strip()
    if not re.fullmatch(r"[A-Za-z0-9_]{20,255}", token):
        raise HTTPException(400, "That does not look like a GitHub token (e.g. ghp_… or github_pat_…)")
    check = await check_token(token)
    if check.get("valid") is False:
        raise HTTPException(400, check["error"])
    if check.get("valid") is None:
        raise HTTPException(502, check.get("error") or "Could not verify the token with GitHub")
    try:
        tid = ts.add(token, body.label, check.get("login"))
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    await _apply_active_token(request)
    return TokenInfo(id=tid, label=body.label.strip() or f"@{check.get('login')}", masked=mask(token), source="app",
                     active=ts.active_id() == tid, **check)


@app.post("/api/tokens/{token_id}/activate")
async def activate_token(token_id: str, request: Request, ts: TokenStore = Depends(tokens)):
    try:
        ts.activate(token_id)
    except KeyError:
        raise HTTPException(404, "Token not found") from None
    await _apply_active_token(request)
    return {"active": token_id}


@app.delete("/api/tokens/{token_id}")
async def delete_token(token_id: str, request: Request, ts: TokenStore = Depends(tokens)):
    if token_id == APP_ID:
        return await remove_github_app(request)
    try:
        ts.delete(token_id)
    except KeyError:
        raise HTTPException(404, "Token not found") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    await _apply_active_token(request)
    return {"deleted": token_id, "active": ts.active_id()}


# --- GitHub App ------------------------------------------------------------------------


class GitHubAppSetup(BaseModel):
    app_id: str = Field(min_length=1, max_length=20, pattern=r"^[0-9]+$")
    installation_id: Optional[str] = Field(None, max_length=20, pattern=r"^[0-9]*$")
    private_key: str = Field(min_length=100, max_length=10000)


@app.get("/api/github-app")
async def github_app_status(request: Request):
    auth: Optional[GitHubAppAuth] = request.app.state.app_auth
    if not auth:
        return {"configured": False}
    return {"configured": True, "app_id": auth.app_id, "installation_id": auth.installation_id,
            "app_name": auth.app_name, "account": auth.account, "token_expires_at": auth.expires_at,
            "active": request.app.state.tokens.active_id() == APP_ID}


@app.put("/api/github-app")
async def setup_github_app(body: GitHubAppSetup, request: Request, ts: TokenStore = Depends(tokens)):
    """Save GitHub App credentials after proving they work by creating an installation token."""
    if "PRIVATE KEY" not in body.private_key:
        raise HTTPException(400, "Paste the whole .pem private key, including the BEGIN/END lines")
    auth = GitHubAppAuth(body.app_id, body.private_key, body.installation_id or None)
    try:
        await auth.token()
    except GitHubAppError as e:
        raise HTTPException(400, str(e)) from e
    request.app.state.app_config.save(auth.app_id, auth.installation_id, body.private_key.strip())
    request.app.state.app_auth = auth
    ts.github_app_configured = True
    ts.activate(APP_ID)  # a GitHub App installation has the higher limit, so use it
    await _apply_active_token(request)
    return await github_app_status(request)


@app.delete("/api/github-app")
async def remove_github_app(request: Request):
    ts: TokenStore = request.app.state.tokens
    if not request.app.state.app_auth:
        raise HTTPException(404, "No GitHub App is configured")
    request.app.state.app_config.delete()
    request.app.state.app_auth = None
    ts.github_app_configured = False
    await _apply_active_token(request)
    return {"deleted": APP_ID, "active": ts.active_id()}


# --- Personal email drafts ----------------------------------------------------------------


@app.get("/api/draft-settings", response_model=DraftSettings)
async def get_draft_settings(request: Request):
    return request.app.state.drafts.get()


@app.put("/api/draft-settings", response_model=DraftSettings)
async def put_draft_settings(body: DraftSettings, request: Request):
    return request.app.state.drafts.put(body)


@app.post("/api/open-url")
async def open_external(body: OpenRequest):
    """Open one draft link in the user's own app. The desktop window cannot open mailto: links itself."""
    try:
        await asyncio.to_thread(drafts.open_url, body.url)
    except OSError as e:
        raise HTTPException(502, f"Could not open the app for this link: {e}") from e
    return {"opened": True}
