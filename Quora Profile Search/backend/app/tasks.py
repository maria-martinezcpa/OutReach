"""Celery worker: runs search jobs and the daily Reddit deletion sync.

Start:  celery -A app.tasks worker -B --loglevel=info
"""

from celery import Celery

from .config import get_settings
from .db import SessionLocal, init_db

settings = get_settings()
celery_app = Celery("discovery", broker=settings.celery_broker_url or "redis://localhost:6379/0")
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=60 * 30,
    beat_schedule={"reddit-deletion-sync": {"task": "app.tasks.reddit_deletion_sync", "schedule": 24 * 3600}},
)


@celery_app.on_after_configure.connect
def _setup(**_):
    init_db()


@celery_app.task(name="app.tasks.run_search")
def run_search(search_id: int) -> None:
    from .services.pipeline import run_search_job

    run_search_job(search_id)


@celery_app.task(name="app.tasks.reddit_deletion_sync")
def reddit_deletion_sync() -> int:
    from .services.pipeline import purge_deleted_reddit, purge_stale_reddit_snippets

    db = SessionLocal()
    try:
        removed = purge_stale_reddit_snippets(db)
        if settings.reddit_client_id and settings.reddit_client_secret:
            removed += purge_deleted_reddit(db)
        return removed
    finally:
        db.close()
