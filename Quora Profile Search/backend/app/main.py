import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .api import router
from .config import get_settings
from .db import init_db

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    from .db import SessionLocal
    from .services.pipeline import purge_stale_reddit_snippets

    with SessionLocal() as db:  # retention for Reddit records that can't be checked for deletion
        purge_stale_reddit_snippets(db)
    yield


app = FastAPI(title="Contact Discovery API", version="1.0.0", lifespan=lifespan,
              description="Finds publicly available professional information about US-based people "
                          "on Quora, Medium and Reddit.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)

# Desktop / single-server mode: serve the built dashboard (frontend/dist) from the API server.
_static = get_settings().static_dir
if _static and Path(_static, "index.html").exists():
    _root = Path(_static).resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (_root / path).resolve()
        if path and f.is_file() and _root in f.parents:
            return FileResponse(f)
        return FileResponse(_root / "index.html")  # client-side routes
