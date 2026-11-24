import json
import time

import httpx

from tests.test_api import client, repo_json  # noqa: F401  (fixture reuse)


def wait_for(client, job_id, statuses=("completed", "failed"), timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job still {job['status']}")


def test_background_search_collects_results(client):
    r = client.post("/api/jobs", json={"q": "gis", "since": "2026-01-01", "until": "2026-06-30", "target": 50})
    assert r.status_code == 201, r.text
    job = wait_for(client, r.json()["id"])
    assert job["status"] == "completed"
    assert job["message"] == "No more search results"
    assert job["found"] == 1 and job["filtered_out"] == 1

    results = client.get(f"/api/jobs/{job['id']}/results").json()
    assert [p["login"] for p in results] == ["alice"]
    assert client.get(f"/api/jobs/{job['id']}/results?offset=1").json() == []
    # Background pages are not recorded as individual history entries.
    assert client.get("/api/history").json() == []


def test_simultaneous_searches(client):
    ids = [client.post("/api/jobs", json={"q": q, "target": 10}).json()["id"] for q in ("gis", "maps", "python")]
    finished = [wait_for(client, i) for i in ids]
    assert all(j["status"] == "completed" for j in finished)
    assert {j["name"] for j in client.get("/api/jobs").json()} == {"gis", "maps", "python"}


def test_continues_through_pages_until_target(client):
    pages = {
        "1": [repo_json("alice", "gis-tools", 1)],
        "2": [repo_json("bob", "maps", 2)],
    }
    client.mock.get("/search/repositories").mock(side_effect=lambda req: httpx.Response(200, json={
        "total_count": 500, "items": pages.get(req.url.params["page"], [])}))
    client.app.state.jobs.page_delay = 0
    job_id = client.post("/api/jobs", json={"q": "gis", "target": 2, "per_page": 1}).json()["id"]
    job = wait_for(client, job_id)
    assert job["message"] == "Target reached"
    assert job["pages_done"] == 2
    assert [p["login"] for p in client.get(f"/api/jobs/{job_id}/results").json()] == ["alice", "bob"]

    # Target reached: continuing needs a higher target.
    assert client.post(f"/api/jobs/{job_id}/resume").status_code == 400
    assert client.post(f"/api/jobs/{job_id}/resume?extra=5").json()["target"] == 7


def test_save_all_export_and_delete(client, tmp_path):
    job_id = client.post("/api/jobs", json={"q": "gis", "target": 10}).json()["id"]
    wait_for(client, job_id)
    assert client.post(f"/api/jobs/{job_id}/save-all").json() == {"saved": 2}
    assert {e["login"] for e in client.get("/api/saved").json()} == {"alice", "bob"}
    assert "alice" in client.get(f"/api/jobs/{job_id}/export/csv").text
    assert client.get(f"/api/jobs/{job_id}/export/json").json()["count"] == 2

    assert (tmp_path / "jobs" / f"{job_id}.json").exists()
    client.delete(f"/api/jobs/{job_id}")
    assert not (tmp_path / "jobs" / f"{job_id}.json").exists()
    assert client.get(f"/api/jobs/{job_id}").status_code == 404


def test_empty_job_rejected(client):
    assert client.post("/api/jobs", json={"target": 5}).status_code == 400


def test_running_job_resumes_after_restart(client, tmp_path):
    mgr = client.app.state.jobs
    job_file = tmp_path / "jobs" / "restarted1.json"
    job_file.write_text(json.dumps({"job": {
        "id": "restarted1", "name": "gis", "query": "gis", "params": {"mode": "repositories", "q": "gis"},
        "target": 10, "status": "running", "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00"}, "results": []}))
    client.portal.call(mgr.load)  # runs inside the app's event loop, as on startup
    job = wait_for(client, "restarted1")
    assert job["status"] == "completed" and job["found"] == 2


def test_stops_checking_once_target_reached_and_continues_same_page(client, monkeypatch):
    import app.service
    monkeypatch.setattr(app.service, "ENRICH_BATCH", 1)
    job_id = client.post("/api/jobs", json={"q": "gis", "target": 1}).json()["id"]
    job = wait_for(client, job_id)
    assert job["found"] == 1 and job["checked"] == 1 and job["pages_done"] == 0

    client.post(f"/api/jobs/{job_id}/resume?extra=1")
    job = wait_for(client, job_id)
    assert [p["login"] for p in client.get(f"/api/jobs/{job_id}/results").json()] == ["alice", "bob"]


def test_waiting_search_continues_as_soon_as_quota_is_back(client):
    # First repository search hits a rate limit whose reset is far away; the real quota is fine.
    calls = {"n": 0}

    def search(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000"},
                                  json={"message": "API rate limit exceeded"})
        return httpx.Response(200, json={"total_count": 1, "items": [repo_json("alice", "gis-tools", 1)]})

    client.mock.get("/search/repositories").mock(side_effect=search)
    client.mock.get("/rate_limit").respond(json={"resources": {
        "core": {"limit": 5000, "remaining": 5000, "reset": 0}, "search": {"limit": 30, "remaining": 30, "reset": 0}}})
    client.app.state.jobs.recheck_interval = 0.05
    job_id = client.post("/api/jobs", json={"q": "gis", "target": 5}).json()["id"]
    job = wait_for(client, job_id)
    assert job["status"] == "completed" and job["found"] == 1


def test_continue_now_wakes_a_waiting_search(client):
    calls = {"n": 0}

    def search(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000"},
                                  json={"message": "API rate limit exceeded"})
        return httpx.Response(200, json={"total_count": 1, "items": [repo_json("alice", "gis-tools", 1)]})

    client.mock.get("/search/repositories").mock(side_effect=search)
    job_id = client.post("/api/jobs", json={"q": "gis", "target": 5}).json()["id"]
    wait_for(client, job_id, statuses=("waiting",))
    assert client.post(f"/api/jobs/{job_id}/wake").status_code == 200
    assert wait_for(client, job_id)["found"] == 1


def test_no_app_limit_on_background_search_size(client):
    job = client.post("/api/jobs", json={"mode": "followers", "followers_of": "mapper", "target": 25000}).json()
    assert job["target"] == 25000
    mgr = client.app.state.jobs
    j = mgr.jobs[job["id"]]
    j.status, j.found = "completed", 25000
    mgr.results[job["id"]] = []  # the resume check only looks at found vs target
    client.post(f"/api/jobs/{job['id']}/pause")
    j.status = "completed"
    r = client.post(f"/api/jobs/{job['id']}/resume?extra=5000")
    assert r.status_code == 200, r.text
    assert r.json()["target"] == 30000
    client.delete(f"/api/jobs/{job['id']}")
