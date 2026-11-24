"""Background searches that keep paging through GitHub results and collect every match.

Each job runs as its own asyncio task, so several searches run at the same time (they share the
GitHub client's request throttle). Job state and results are persisted to data/jobs/<id>.json after
every page; jobs that were running when the server stopped resume automatically on startup.
"""

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .github_client import GitHubClient, GitHubError, RateLimitError
from .models import Profile
from .service import ProfileService, SearchParams, build_query

log = logging.getLogger(__name__)

JobStatus = Literal["running", "waiting", "paused", "completed", "failed"]


class JobCreate(SearchParams):
    per_page: int = Field(20, ge=1, le=30)
    target: int = Field(100, ge=1, description="Stop after this many matching people (no upper limit)")
    name: str = ""


class JobState(BaseModel):
    id: str
    name: str
    query: str
    params: dict
    target: int
    status: JobStatus = "running"
    created_at: str
    updated_at: str
    next_page: int = 1
    pages_done: int = 0
    checked: int = 0
    filtered_out: int = 0
    failed: int = 0
    total_candidates: int = 0
    found: int = 0
    wait_until: Optional[str] = None
    message: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class JobManager:
    def __init__(self, service: ProfileService, gh: GitHubClient, data_dir: Path, page_delay: float = 1.0):
        self.service = service
        self.gh = gh
        self.dir = Path(data_dir) / "jobs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.page_delay = page_delay
        self.jobs: dict[str, JobState] = {}
        self.results: dict[str, list[Profile]] = {}
        self.tasks: dict[str, asyncio.Task] = {}
        self._shutting_down = False
        self._wakers: set[asyncio.Event] = set()
        self.recheck_interval = 30.0  # seconds between real quota checks while waiting

    def wake_waiting(self) -> int:
        """End every rate-limit wait now (e.g. after switching to a token with quota left)."""
        for w in self._wakers:
            w.set()
        return len(self._wakers)

    # --- persistence -------------------------------------------------------------

    def _path(self, job_id: str) -> Path:
        return self.dir / f"{job_id}.json"

    def _save(self, job: JobState) -> None:
        if job.id not in self.jobs:  # deleted while its task was finishing
            return
        job.updated_at = _now()
        job.found = len(self.results[job.id])
        data = {"job": job.model_dump(), "results": [p.model_dump(mode="json") for p in self.results[job.id]]}
        tmp = self._path(job.id).with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self._path(job.id))

    def load(self) -> None:
        """Load jobs from disk and resume the ones that were running when the server stopped."""
        for path in self.dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                job = JobState.model_validate(data["job"])
                self.jobs[job.id] = job
                self.results[job.id] = [Profile.model_validate(p) for p in data["results"]]
            except Exception:
                log.exception("Could not load job file %s", path)
                continue
            if job.status in ("running", "waiting"):
                self._start(job.id)

    async def shutdown(self) -> None:
        self._shutting_down = True
        tasks = list(self.tasks.values())
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # --- control -------------------------------------------------------------------

    def create(self, req: JobCreate) -> JobState:
        params = req.model_dump(mode="json", exclude={"target", "name", "page"})
        query = build_query(SearchParams(**params))  # raises ValueError for empty searches
        job = JobState(
            id=uuid.uuid4().hex[:10],
            name=req.name.strip() or (query[:100] if req.mode == "followers" else "")
            or ", ".join(req.keywords)[:60] or req.q.strip() or query,
            query=query,
            params=params,
            target=req.target,
            created_at=_now(),
            updated_at=_now(),
        )
        self.jobs[job.id] = job
        self.results[job.id] = []
        self._save(job)
        self._start(job.id)
        return job

    def _start(self, job_id: str) -> None:
        job = self.jobs[job_id]
        job.status = "running"
        job.message = None
        self.tasks[job_id] = asyncio.create_task(self._run(job_id), name=f"job-{job_id}")

    def get(self, job_id: str) -> JobState:
        if job_id not in self.jobs:
            raise KeyError(job_id)
        return self.jobs[job_id]

    def list(self) -> list[JobState]:
        return sorted(self.jobs.values(), key=lambda j: j.created_at, reverse=True)

    async def pause(self, job_id: str) -> JobState:
        job = self.get(job_id)
        task = self.tasks.pop(job_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if job.status in ("running", "waiting"):
            job.status = "paused"
            job.wait_until = None
            self._save(job)
        return job

    def resume(self, job_id: str, extra: int = 0) -> JobState:
        """Continue a paused/failed job, or a completed one with `extra` more results allowed."""
        job = self.get(job_id)
        if job_id in self.tasks:
            return job
        if extra:
            job.target += extra
        if job.status == "completed" and job.found >= job.target:
            raise ValueError("Target already reached. Raise the target to continue.")
        if job.status == "completed" and job.message == "No more search results":
            raise ValueError("GitHub has no more results for this search.")
        self._start(job_id)
        self._save(job)
        return job

    def remove_accounts(self, logins: set[str]) -> int:
        """Remove these people (lowercase logins) from every search's results; returns how many entries went.
        Lists are changed in place, so a running search keeps using the same list and won't re-add them."""
        removed = 0
        for job_id, results in self.results.items():
            keep = [p for p in results if p.login.lower() not in logins]
            if len(keep) != len(results):
                removed += len(results) - len(keep)
                results[:] = keep
                self._save(self.jobs[job_id])
        return removed

    async def delete(self, job_id: str) -> None:
        self.get(job_id)
        task = self.tasks.pop(job_id, None)
        self.jobs.pop(job_id, None)
        self.results.pop(job_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._path(job_id).unlink(missing_ok=True)

    # --- worker ------------------------------------------------------------------------

    async def _quota_available(self) -> bool:
        try:
            res = (await self.gh.rate_limit()).get("resources", {})
        except GitHubError:
            return False
        return (res.get("core") or {}).get("remaining", 0) > 50 and (res.get("search") or {}).get("remaining", 0) > 0

    def _rate_limit_wait(self, reset_at: Optional[int]) -> float:
        now = time.time()
        exhausted = [r["reset"] for r in self.gh.rate.values() if r.get("remaining") == 0 and r.get("reset")]
        reset = reset_at or (min(exhausted) if exhausted else None)
        return max(reset - now + 5, 10) if reset else 60

    async def _wait(self, job: JobState, seconds: float, message: str) -> None:
        job.status = "waiting"
        job.message = message
        job.wait_until = datetime.fromtimestamp(time.time() + seconds, timezone.utc).isoformat(timespec="seconds")
        self._save(job)
        waker = asyncio.Event()
        self._wakers.add(waker)
        deadline = time.time() + seconds
        try:
            # GitHub's servers sometimes disagree about the quota, so a computed reset time can be far too late.
            # Re-check the real quota periodically (the /rate_limit call is free) and continue as soon as it is back.
            while (left := deadline - time.time()) > 0:
                try:
                    await asyncio.wait_for(waker.wait(), timeout=min(self.recheck_interval, left))
                    break  # woken: token switched or "Continue now"
                except TimeoutError:
                    pass
                if await self._quota_available():
                    break
        finally:
            self._wakers.discard(waker)
        job.status = "running"
        job.wait_until = None
        job.message = None

    async def _run(self, job_id: str) -> None:
        job = self.jobs[job_id]
        results = self.results[job_id]
        seen = {p.login.lower() for p in results}

        async def add(profile: Profile) -> None:
            # Called the moment a match is found, so it is visible to the UI before the page finishes.
            if len(results) < job.target and profile.login.lower() not in seen:
                seen.add(profile.login.lower())
                results.append(profile)
                job.found = len(results)

        try:
            while len(results) < job.target:
                params = SearchParams(**job.params, page=job.next_page)
                base_checked, base_filtered = job.checked, job.filtered_out

                async def progress(d: dict) -> None:
                    job.checked = base_checked + d["checked"]
                    job.filtered_out = base_filtered + d["filtered_out"]
                    job.total_candidates = d["total_candidates"]

                try:
                    resp = await self.service.search(
                        params, cap=False, record_history=False, exclude=frozenset(seen),
                        limit=job.target - len(results), on_item=add, on_progress=progress,
                    )
                except RateLimitError as e:
                    await self._wait(job, self._rate_limit_wait(e.reset_at), "GitHub rate limit reached, waiting to continue")
                    continue
                except GitHubError as e:
                    if e.status >= 500:
                        await self._wait(job, 30, f"GitHub error, retrying: {e.message}")
                        continue
                    raise

                job.checked = base_checked + resp.checked
                job.filtered_out = base_filtered + resp.filtered_out
                job.total_candidates = resp.total_candidates

                if resp.warning:
                    # Some profiles on this page were not fetched; retry the page after the limit resets.
                    self._save(job)
                    await self._wait(job, self._rate_limit_wait(None), "GitHub rate limit reached, waiting to continue")
                    continue

                job.failed += len(resp.failed)
                if not resp.page_complete:
                    # Target reached part-way through a page: stay on it so "continue" checks the rest.
                    self._save(job)
                    continue
                job.pages_done += 1
                job.next_page += 1
                self._save(job)
                if not resp.has_more:
                    job.status = "completed"
                    job.message = "No more search results"
                    break
                await asyncio.sleep(self.page_delay)
            else:
                job.status = "completed"
                job.message = "Target reached"
        except asyncio.CancelledError:
            # Keep status "running" on server shutdown so the job resumes on the next start.
            if not self._shutting_down and job.status in ("running", "waiting"):
                job.status = "paused"
            job.wait_until = None
            raise
        except Exception as e:
            log.exception("Background search %s failed", job_id)
            job.status = "failed"
            job.message = str(getattr(e, "message", e))
        finally:
            self._save(job)
            if self.tasks.get(job_id) is asyncio.current_task():
                self.tasks.pop(job_id, None)
