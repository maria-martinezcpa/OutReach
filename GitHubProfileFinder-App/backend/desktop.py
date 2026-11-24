"""Desktop app: runs the backend in-process and shows the interface in a native window (Edge WebView2).

Data (tokens, saved profiles, background searches) lives in a `data` folder next to the program, and
settings can be put in a `.env` file next to it. Logs go to `logs/app.log`.
"""

import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
HOME = Path(sys.executable).parent if FROZEN else Path(__file__).resolve().parent
RESOURCES = Path(getattr(sys, "_MEIPASS", HOME))

# A windowed program has no console: send output to a log file before anything logs.
(HOME / "logs").mkdir(exist_ok=True)
_log_file = open(HOME / "logs" / "app.log", "a", encoding="utf-8", buffering=1)
if sys.stdout is None or FROZEN:
    sys.stdout = _log_file
if sys.stderr is None or FROZEN:
    sys.stderr = _log_file

from dotenv import load_dotenv  # noqa: E402

load_dotenv(HOME / ".env")
os.environ.setdefault("DATA_DIR", str(HOME / "data"))

import uvicorn  # noqa: E402
import webview  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402

from app.main import app  # noqa: E402  (reads DATA_DIR / .env set above)

FRONTEND = RESOURCES / "frontend_dist" if FROZEN else HOME.parent / "frontend" / "dist"
log = logging.getLogger("desktop")


@app.get("/{path:path}", include_in_schema=False)
async def frontend(path: str):
    """Serve the built interface; unknown paths return index.html so in-app links like /settings work."""
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    file = (FRONTEND / path).resolve()
    if path and file.is_file() and FRONTEND.resolve() in file.parents:
        return FileResponse(file)
    return FileResponse(FRONTEND / "index.html")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    if not (FRONTEND / "index.html").exists():
        raise SystemExit(f"Interface not built: {FRONTEND} is missing. Run `npm run build` in frontend/.")
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, access_log=False))
    thread = threading.Thread(target=server.run, name="backend", daemon=True)
    thread.start()
    for _ in range(200):  # wait up to 20 s for the backend to start
        if server.started:
            break
        time.sleep(0.1)
    log.info("Backend running on http://127.0.0.1:%d", port)

    webview.settings["ALLOW_DOWNLOADS"] = True  # CSV/JSON exports
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True  # GitHub/LinkedIn links open in the browser
    webview.create_window("GitHub Profile Finder", f"http://127.0.0.1:{port}/", width=1400, height=900,
                          min_size=(900, 600))
    webview.start()

    # Window closed: stop the backend cleanly so background searches are saved and resume next time.
    server.should_exit = True
    thread.join(timeout=15)


if __name__ == "__main__":
    main()
