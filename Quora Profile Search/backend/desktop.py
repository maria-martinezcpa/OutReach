"""Desktop launcher: runs the API + dashboard locally and shows it in a native window.

    python desktop.py            # open the app
    python desktop.py --check    # start the server, verify it responds, exit (no window)

Data lives in %APPDATA%\\ContactDiscovery (database, settings.env with API keys, app.log).
"""

import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_NAME = "Contact Discovery"


def resource_dir() -> Path:
    """Where bundled files live: the PyInstaller temp dir when frozen, the project root otherwise."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / ".config")
    d = base / "ContactDiscovery"
    d.mkdir(parents=True, exist_ok=True)
    return d


def configure_environment() -> Path:
    data = data_dir()
    # A windowed exe has no console: send output to a log file instead of crashing on print/logging
    if sys.stdout is None or sys.stderr is None:
        log = open(data / "app.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
    settings_file = data / "settings.env"
    if not settings_file.exists():
        settings_file.write_text("# API keys and options, edited from the app's Settings page\n", encoding="utf-8")
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{(data / 'contacts.db').as_posix()}")
    os.environ["APP_ENV_FILE"] = str(settings_file)
    os.environ["STATIC_DIR"] = str(resource_dir() / "frontend" / "dist")
    os.environ["SETTINGS_EDITABLE"] = "true"
    os.environ["CELERY_BROKER_URL"] = ""  # searches run in-process
    os.chdir(data)  # keep relative .env lookups inside the app's data folder
    return data


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_until_up(url: str, timeout: float = 30) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=2) as r:
                if r.status == 200:
                    return True
        except OSError:
            time.sleep(0.25)
    return False


def main() -> int:
    data = configure_environment()
    sys.path.insert(0, str(Path(__file__).resolve().parent))

    import uvicorn

    from app.main import app

    port = free_port()
    url = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    up = wait_until_up(url)

    if "--check" in sys.argv:
        ok = up
        if up:
            with urllib.request.urlopen(url + "/", timeout=5) as r:
                ok = b"<div id=\"root\">" in r.read()
        print(f"server {'OK' if up else 'FAILED'} at {url}; dashboard {'OK' if ok else 'MISSING'}; data in {data}")
        server.should_exit = True
        thread.join(timeout=5)
        return 0 if ok else 1

    import webview

    webview.settings["ALLOW_DOWNLOADS"] = True  # CSV / Excel exports
    if up:
        webview.create_window(APP_NAME, url, width=1380, height=900, min_size=(900, 600))
    else:
        webview.create_window(APP_NAME, html=f"<h2>{APP_NAME} couldn't start</h2>"
                                             f"<p>See the log at {data / 'app.log'}</p>", width=640, height=300)
    webview.start()
    server.should_exit = True
    thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
