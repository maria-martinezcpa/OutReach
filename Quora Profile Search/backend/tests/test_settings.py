"""Desktop Settings page API. Runs in a subprocess because settings files are chosen at import time."""

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = r"""
import json, os
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
out = {}
out["initial"] = c.get("/api/settings").json()
r = c.put("/api/settings", json={"anthropic_api_key": "sk-ant-secret-1234", "reddit_user_agent": 'web:x:1.0 (by /u/me) "q"',
                                 "search_provider": "google", "not_allowed": "x"})
out["saved"] = r.json()
# masked value sent back unchanged must not overwrite the real key
if "values" in out["saved"]:
    out["resave"] = c.put("/api/settings", json={"anthropic_api_key": out["saved"]["values"]["anthropic_api_key"]}).json()
out["bad"] = c.put("/api/settings", json={"search_provider": "bing"}).status_code
from app.config import get_settings
out["real_key"] = get_settings().anthropic_api_key
out["ua"] = get_settings().reddit_user_agent
print("RESULT" + json.dumps(out))
"""


def run(tmp_path: Path, editable: bool) -> dict:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{(tmp_path / 'db.sqlite').as_posix()}",
           "APP_ENV_FILE": str(tmp_path / "settings.env"), "SETTINGS_EDITABLE": str(editable).lower(),
           "ANTHROPIC_API_KEY": ""}
    env.pop("ANTHROPIC_API_KEY")
    p = subprocess.run([sys.executable, "-c", SCRIPT], cwd=tmp_path, env={**env, "PYTHONPATH": str(Path(__file__).parent.parent)},
                       capture_output=True, text=True, timeout=120)
    line = next((x for x in p.stdout.splitlines() if x.startswith("RESULT")), None)
    assert line, p.stderr[-2000:]
    return json.loads(line[6:])


def test_settings_roundtrip(tmp_path):
    out = run(tmp_path, editable=True)
    assert out["initial"]["editable"] is True and out["initial"]["configured"]["anthropic_api_key"] is False
    saved = out["saved"]
    assert saved["configured"]["anthropic_api_key"] is True
    assert saved["values"]["anthropic_api_key"].endswith("1234") and "secret" not in saved["values"]["anthropic_api_key"]
    assert saved["values"]["search_provider"] == "google"
    assert out["real_key"] == "sk-ant-secret-1234"  # masked resave kept the real key
    assert out["ua"] == 'web:x:1.0 (by /u/me) "q"'   # quoting survives the round trip
    assert out["bad"] == 422
    assert "NOT_ALLOWED" not in (tmp_path / "settings.env").read_text()


def test_settings_read_only_on_server(tmp_path):
    out = run(tmp_path, editable=False)
    assert out["initial"]["editable"] is False
    assert out["saved"]["detail"].startswith("Settings can only be edited")
