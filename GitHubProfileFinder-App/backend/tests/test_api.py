"""End-to-end API tests with GitHub mocked by respx (no network access needed)."""

import csv
import json
import io

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.config import settings

GH = "https://api.github.com"


def user_json(login, uid, **kw):
    return {"login": login, "id": uid, "type": "User", "html_url": f"https://github.com/{login}",
            "avatar_url": "", "created_at": "2016-01-01T00:00:00Z", "followers": 20, "following": 5,
            "public_repos": 3, **kw}


def repo_json(owner, name, rid, pushed="2026-05-01T00:00:00Z", **kw):
    return {"id": rid, "name": name, "html_url": f"https://github.com/{owner}/{name}", "language": "Python",
            "created_at": "2020-01-01T00:00:00Z", "pushed_at": pushed, "fork": False, "stargazers_count": 1,
            "forks_count": 0, "topics": ["gis"], "owner": {"login": owner, "type": "User"}, **kw}


def commit_json(author_date, login=None, repo=None):
    c = {"sha": author_date, "commit": {"author": {"date": author_date}}}
    if login is not None:
        c["author"] = {"login": login, "type": "User"} if login else None
        c["repository"] = {"full_name": repo}
    return c


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "github_token", "test-token")
    from app.main import app
    with respx.mock(base_url=GH, assert_all_called=False) as mock:
        mock.get("/search/repositories").respond(json={"total_count": 2, "items": [
            repo_json("alice", "gis-tools", 1), repo_json("bob", "maps", 2),
            {**repo_json("acme-org", "x", 3), "owner": {"login": "acme-org", "type": "Organization"}},
        ]})
        mock.get("/users/alice").respond(json=user_json(
            "alice", 11, name="Alice", location="Berlin, Germany", email="alice@example.net",
            bio="Senior GIS Developer. Phone: +49 30 1234567", blog="alice.dev"))
        mock.get("/users/bob").respond(json=user_json("bob", 12, location="Austin, TX", email="bob@example.org"))
        for login in ("alice", "bob"):
            mock.get(f"/users/{login}/social_accounts").respond(json=[])
            mock.get(f"/repos/{login}/{login}/readme").respond(404)
        mock.get("/users/alice/repos").respond(json=[repo_json("alice", "gis-tools", 1)])
        mock.get("/users/bob/repos").respond(json=[repo_json("bob", "maps", 2)])
        # alice committed in the period, bob did not. The third commit was authored before the
        # period (only committed/rebased inside it) and must not count.
        mock.get("/repos/alice/gis-tools/commits").respond(json=[
            commit_json("2026-03-01T10:00:00Z"), commit_json("2026-02-01T10:00:00Z"),
            commit_json("2025-12-31T23:00:00Z"),
        ])
        mock.get("/repos/bob/maps/commits").respond(json=[])
        mock.get("/search/topics").respond(json={"items": [
            {"name": "unity", "display_name": "Unity", "short_description": "Unity is a game engine."},
            {"name": "gis", "display_name": "GIS", "short_description": "Geographic information systems."},
        ]})
        with TestClient(app) as c:
            c.mock = mock
            yield c


def test_search_with_period_filters_to_committers(client):
    r = client.get("/api/search", params={"q": "gis", "since": "2026-01-01", "until": "2026-06-30"})
    assert r.status_code == 200, r.text
    body = r.json()
    # Repos pushed after the period may still hold commits from it, so only the start is used here.
    assert "pushed:>=2026-01-01" in body["query"]
    assert [p["login"] for p in body["items"]] == ["alice"]
    alice = body["items"][0]
    assert alice["period_activity"]["commits"] == 2
    assert alice["period_activity"]["last_commit_at"] == "2026-03-01T10:00:00Z"
    assert alice["country"] == "Germany"
    assert alice["contacts"]["emails"][0]["value"] == "alice@example.net"
    assert alice["contacts"]["phones"][0]["value"] == "+49 30 1234567"
    assert alice["roles"][0]["title"] == "Senior GIS Developer"
    assert body["filtered_out"] == 1
    assert client.get("/api/history").json()[0]["results"] == 1


def test_location_post_filter_in_repository_mode(client):
    r = client.get("/api/search", params={"q": "gis", "location": "germany"})
    assert [p["login"] for p in r.json()["items"]] == ["alice"]


def test_search_requires_criteria(client):
    assert client.get("/api/search").status_code == 400


def test_invalid_period_rejected(client):
    r = client.get("/api/search", params={"q": "x", "since": "2026-02-01", "until": "2026-01-01"})
    assert r.status_code == 422


def test_save_export_and_delete(client, tmp_path):
    assert client.post("/api/saved/alice", json={"note": "GIS lead"}).status_code == 200
    saved = client.get("/api/saved").json()
    assert saved[0]["login"] == "alice" and saved[0]["note"] == "GIS lead"

    # Saved profiles are mirrored to CSV on disk.
    rows = list(csv.DictReader(io.StringIO((tmp_path / "saved_profiles.csv").read_text(encoding="utf-8-sig"))))
    assert rows[0]["username"] == "alice" and rows[0]["country"] == "Germany"
    assert rows[0]["email"] == "alice@example.net" and rows[0]["website"] == "https://alice.dev"

    r = client.get("/api/export/csv")
    assert r.headers["content-type"].startswith("text/csv")
    assert "alice@example.net" in r.text
    assert client.get("/api/export/json").json()["count"] == 1

    assert client.delete("/api/profiles/alice").json() == {"cache_removed": True, "saved_removed": True}
    assert client.get("/api/saved").json() == []


def test_rate_limit_is_reported(client):
    client.mock.get("/users/ratelimited").respond(
        403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000"}, json={"message": "limit"})
    r = client.get("/api/profiles/ratelimited")
    assert r.status_code == 429
    assert "rate limit" in r.json()["detail"].lower()


def test_retries_server_errors(client):
    route = client.mock.get("/users/flaky")
    route.side_effect = [httpx.Response(502), httpx.Response(200, json=user_json("flaky", 99))]
    client.mock.get("/users/flaky/social_accounts").respond(json=[])
    client.mock.get("/users/flaky/repos").respond(json=[])
    client.mock.get("/repos/flaky/flaky/readme").respond(404)
    client.app.state.gh.backoff_base = 0
    assert client.get("/api/profiles/flaky").json()["login"] == "flaky"
    assert route.call_count == 2


def test_invalid_login_rejected(client):
    assert client.get("/api/profiles/bad..name").status_code == 400


def test_commit_search_mode_uses_commit_dates(client):
    route = client.mock.get("/search/commits").respond(json={"total_count": 3, "items": [
        commit_json("2026-04-02T09:00:00Z", "alice", "acme/engine"),
        commit_json("2026-04-01T09:00:00Z", "alice", "alice/gis-tools"),
        commit_json("2026-04-01T08:00:00Z", "", "x/y"),  # email not linked to any account
    ]})
    r = client.get("/api/search", params={"mode": "commits", "q": "shader", "since": "2026-04-01", "until": "2026-04-30"})
    assert r.status_code == 200, r.text
    assert route.calls[0].request.url.params["q"] == "shader author-date:2026-04-01..2026-04-30"
    [alice] = r.json()["items"]
    activity = alice["period_activity"]
    assert activity["commits"] == 2
    assert {x["name"] for x in activity["repos"]} == {"acme/engine", "alice/gis-tools"}
    assert activity["last_commit_at"] == "2026-04-02T09:00:00Z"
    assert "commit search" in activity["source"]


def parse_sse(text):
    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def test_stream_sends_each_match_as_found(client):
    r = client.get("/api/search/stream", params={"q": "gis", "since": "2026-01-01", "until": "2026-06-30"})
    assert r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    kinds = [e for e, _ in events]
    assert kinds[0] == "progress" and kinds[-1] == "done"
    assert [d["login"] for e, d in events if e == "item"] == ["alice"]
    # An item is emitted before the page summary.
    assert kinds.index("item") < kinds.index("done")
    assert events[-1][1]["filtered_out"] == 1 and "items" not in events[-1][1]


def test_stream_reports_errors_as_events(client):
    events = parse_sse(client.get("/api/search/stream").text)
    assert events == [("failed", {"detail": "Enter keywords, a language or a commit date range to search repositories"})]
    events = parse_sse(client.get("/api/search/stream", params={"q": "x", "since": "2026-05-01", "until": "2026-01-01"}).text)
    assert events[0][0] == "failed" and "since" in events[0][1]["detail"]


def test_suggestions(client):
    kw = client.get("/api/suggest", params={"field": "keyword", "q": "uni"}).json()
    assert kw[0]["value"] == "unity" and "game engine" in kw[0]["hint"]
    langs = [s["value"] for s in client.get("/api/suggest", params={"field": "language", "q": "type"}).json()]
    assert langs[0] == "TypeScript"
    assert client.get("/api/suggest", params={"field": "location", "q": "berl"}).json()[0]["value"] == "Berlin"
    assert "Germany" in [s["value"] for s in client.get("/api/suggest", params={"field": "country", "q": "germ"}).json()]
    assert client.get("/api/suggest", params={"field": "keyword", "q": ""}).json() == []


def test_people_without_email_phone_or_linkedin_are_skipped(client):
    client.mock.get("/search/repositories").respond(json={"total_count": 1, "items": [repo_json("carol", "tools", 9)]})
    client.mock.get("/users/carol").respond(json=user_json("carol", 13, blog="carol.dev", bio="Game developer"))
    client.mock.get("/users/carol/social_accounts").respond(json=[{"provider": "twitter", "url": "https://x.com/carol"}])
    client.mock.get("/repos/carol/carol/readme").respond(404)
    client.mock.get("/users/carol/repos").respond(json=[repo_json("carol", "tools", 9)])
    commits = client.mock.get("/repos/carol/tools/commits").respond(json=[commit_json("2026-03-01T10:00:00Z")])
    body = client.get("/api/search", params={"q": "tools", "since": "2026-01-01", "until": "2026-06-30"}).json()
    # A website and Twitter are not enough: email, phone or LinkedIn is required.
    assert body["items"] == [] and body["filtered_out"] == 1
    assert not commits.called  # no commit-date API calls spent on someone who will be skipped


def rate_limit_for(request):
    auth = request.headers.get("authorization", "")
    if "bad" in auth:
        return httpx.Response(401, json={"message": "Bad credentials"})
    # GitHub's /rate_limit can be stale: it claims everything is unused. The app must not show this.
    return httpx.Response(200, json={"resources": {
        "core": {"limit": 5000, "used": 0, "remaining": 5000, "reset": 1900000000},
        "search": {"limit": 30, "used": 0, "remaining": 30, "reset": 1900000000}}})


def quota_headers(limit, remaining, resource="core", reset=1900000000):
    return {"x-ratelimit-limit": str(limit), "x-ratelimit-remaining": str(remaining),
            "x-ratelimit-used": str(limit - remaining), "x-ratelimit-reset": str(reset),
            "x-ratelimit-resource": resource}


def user_for(req):
    """/user answers with the real quota in its headers, like GitHub does."""
    auth = req.headers["authorization"]
    second = "ghp_second" in auth
    return httpx.Response(200, json={"login": "second-account" if second else "env-account"},
                          headers=quota_headers(5000, 4321 if second else 0))


def test_token_management(client, tmp_path):
    client.mock.get("/rate_limit").mock(side_effect=rate_limit_for)
    client.mock.get("/user").mock(side_effect=user_for)

    [env] = client.get("/api/tokens").json()
    assert env["source"] == "env" and env["active"] and env["core"]["remaining"] == 0
    assert "test-token" not in str(env)  # only a masked form reaches the browser

    assert client.post("/api/tokens", json={"token": "ghp_bad0000000000000000000000"}).status_code == 400
    assert client.post("/api/tokens", json={"token": "not a token"}).status_code == 400

    r = client.post("/api/tokens", json={"token": "ghp_second000000000000000000000", "label": "Backup"})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["login"] == "second-account" and new["masked"] == "ghp_…0000"
    assert client.post("/api/tokens", json={"token": "ghp_second000000000000000000000"}).status_code == 409

    # Adding does not switch away from a working active token; activating does, immediately.
    assert client.app.state.gh._client.headers["Authorization"] == "Bearer test-token"
    client.post(f"/api/tokens/{new['id']}/activate")
    assert client.app.state.gh._client.headers["Authorization"] == "Bearer ghp_second000000000000000000000"
    listed = {t["id"]: t for t in client.get("/api/tokens").json()}
    assert listed[new["id"]]["active"] and listed[new["id"]]["core"]["remaining"] == 4321
    assert listed[new["id"]]["core"]["used"] == 679 and listed[new["id"]]["search"] is None

    assert client.delete("/api/tokens/env").status_code == 400
    assert client.delete(f"/api/tokens/{new['id']}").json()["active"] == "env"
    assert client.app.state.gh._client.headers["Authorization"] == "Bearer test-token"


def test_region_filter_and_region_fields(client):
    # alice is in Berlin (Western Europe), bob in Austin, TX (Northern America); both have contacts.
    body = client.get("/api/search", params={"q": "gis", "region": "Europe"}).json()
    assert [p["login"] for p in body["items"]] == ["alice"]
    assert body["items"][0]["region"] == "Western Europe" and body["items"][0]["continent"] == "Europe"
    body = client.get("/api/search", params={"q": "gis", "region": "North America"}).json()
    assert [p["login"] for p in body["items"]] == ["bob"]
    assert client.get("/api/suggest", params={"field": "region", "q": "euro"}).json()[0]["value"] == "Europe"


def test_multi_keyword_search_includes_anyone_matching_any_keyword(client):
    def search(request):
        q = request.url.params["q"]
        items = []
        if "bim" in q:  # first group of keywords
            items.append(repo_json("alice", "gis-tools", 1, description="BIM and Revit helpers"))
        if "dynamo" in q:  # second group
            items += [repo_json("bob", "maps", 2, description="Dynamo scripts"),
                      repo_json("alice", "other", 3)]  # alice again: must not be duplicated
        return httpx.Response(200, json={"total_count": len(items), "items": items})

    route = client.mock.get("/search/repositories").mock(side_effect=search)
    kws = "bim, revit, ifc, cad, gis, qgis, dynamo"  # 7 keywords: more than one GitHub query holds
    body = client.get("/api/search", params={"keywords": kws}).json()
    sent = [c.request.url.params["q"] for c in route.calls]
    assert sent == ["bim OR revit OR ifc OR cad OR gis OR qgis", "dynamo"]
    assert sorted(p["login"] for p in body["items"]) == ["alice", "bob"]
    alice = next(p for p in body["items"] if p["login"] == "alice")
    bob = next(p for p in body["items"] if p["login"] == "bob")
    assert set(alice["matched_keywords"]) >= {"bim", "revit", "gis"}
    assert bob["matched_keywords"] == ["gis", "dynamo"]  # "gis" comes from the fixture repo topics

    # The same works as repeated parameters and in the streaming endpoint.
    body = client.get("/api/search", params=[("keywords", "bim"), ("keywords", "dynamo")]).json()
    assert len(body["items"]) == 2
    events = parse_sse(client.get("/api/search/stream", params={"keywords": "bim,dynamo"}).text)
    assert sorted(d["login"] for e, d in events if e == "item") == ["alice", "bob"]


def test_background_search_with_keywords_is_named_after_them(client):
    r = client.post("/api/jobs", json={"keywords": ["gis", "bim"], "target": 1})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "gis, bim" and r.json()["query"] == "gis OR bim"


def test_followers_mode_checks_each_follower_like_any_other_candidate(client):
    client.mock.get("/users/mapper").respond(json=user_json("mapper", 50, followers=3))
    route = client.mock.get("/users/mapper/followers").respond(json=[
        {"login": "alice", "type": "User"}, {"login": "bob", "type": "User"}, {"login": "bot", "type": "Bot"},
    ])
    r = client.get("/api/search", params={"mode": "followers", "followers_of": "@mapper", "keywords": "senior"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] == "followers of @mapper matching senior"
    assert body["total_candidates"] == 3
    assert not body["has_more"]
    # alice matches "senior" through her bio; bob has contacts but no keyword match
    assert [p["login"] for p in body["items"]] == ["alice"]
    assert body["items"][0]["contacts"]["emails"][0]["source"] == "GitHub public email"
    assert body["filtered_out"] == 1
    assert route.calls.last.request.url.params["page"] == "1"


def test_followers_mode_requires_a_username(client):
    assert client.get("/api/search", params={"mode": "followers"}).status_code == 400
    assert client.get("/api/search", params={"mode": "followers", "followers_of": "bad name!"}).status_code == 422


def test_background_followers_search_is_named_after_the_account(client):
    r = client.post("/api/jobs", json={"mode": "followers", "followers_of": "mapper", "target": 5})
    assert r.status_code in (200, 201), r.text
    assert r.json()["name"] == "followers of @mapper"
    client.delete(f"/api/jobs/{r.json()['id']}")


def test_track_outreach_on_saved_profiles(client, tmp_path):
    assert client.patch("/api/saved/alice", json={"status": "contacted"}).status_code == 404  # not saved yet
    client.post("/api/saved/alice", json={"note": "GIS lead"})

    r = client.patch("/api/saved/alice", json={"status": "contacted", "follow_up": "2026-10-05"})
    assert r.status_code == 200, r.text
    e = r.json()
    assert (e["status"], e["follow_up"], e["note"]) == ("contacted", "2026-10-05", "GIS lead")  # note kept
    assert e["updated_at"]

    # Saving again (e.g. from another search) keeps the tracking fields.
    client.post("/api/saved/alice")
    assert client.get("/api/saved").json()[0]["status"] == "contacted"

    rows = list(csv.DictReader(io.StringIO((tmp_path / "saved_profiles.csv").read_text(encoding="utf-8-sig"))))
    assert (rows[0]["status"], rows[0]["follow_up"]) == ("contacted", "2026-10-05")

    e = client.patch("/api/saved/alice", json={"follow_up": None, "note": "Replied, call next week"}).json()
    assert (e["status"], e["follow_up"], e["note"]) == ("contacted", None, "Replied, call next week")
    assert client.patch("/api/saved/alice", json={"status": "spam"}).status_code == 422
    assert client.patch("/api/saved/alice", json={"status": "drafted"}).json()["status"] == "drafted"


def test_draft_settings_are_saved(client):
    d = client.get("/api/draft-settings").json()
    assert d["app"] == "mailto" and d["signature"] == "" and d["default_template"] == "default"
    assert [t["name"] for t in d["templates"]] == ["Default"] and "{first_name}" in d["templates"][0]["body"]
    new = {"app": "gmail", "custom_url": "", "signature": "Luke\n{github_url}", "default_template": "bim",
           "templates": [{"id": "default", "name": "GIS", "subject": "Hi {first_name}", "body": "About {repo}"},
                         {"id": "bim", "name": "BIM", "subject": "BIM", "body": "Revit?"}]}
    assert client.put("/api/draft-settings", json=new).json().items() >= new.items()
    assert client.get("/api/draft-settings").json().items() >= new.items()
    assert client.put("/api/draft-settings", json={**new, "app": "fax"}).status_code == 422
    assert client.put("/api/draft-settings", json={**new, "custom_url": "javascript:alert(1)"}).status_code == 422
    assert client.put("/api/draft-settings", json={**new, "templates": []}).status_code == 422
    dup = [new["templates"][0], {**new["templates"][1], "id": "default"}]
    assert client.put("/api/draft-settings", json={**new, "templates": dup}).status_code == 422
    # A missing default falls back to the first template.
    assert client.put("/api/draft-settings", json={**new, "default_template": "gone"}).json()["default_template"] == "default"


def test_old_single_template_settings_become_the_default_template(tmp_path):
    from app.drafts import DraftStore
    (tmp_path / "drafts.json").write_text(
        '{"app": "outlook", "custom_url": "", "subject": "Old subject", "body": "Old body"}', encoding="utf-8")
    s = DraftStore(tmp_path).get()
    assert s.app == "outlook"
    assert [(t.id, t.name, t.subject, t.body) for t in s.templates] == [("default", "Default", "Old subject", "Old body")]


def test_open_url_only_opens_draft_links(client, monkeypatch):
    from app import drafts
    opened = []
    monkeypatch.setattr(drafts, "open_url", opened.append)
    url = "mailto:alice@example.net?subject=Hi&body=Hello"
    assert client.post("/api/open-url", json={"url": url}).json() == {"opened": True}
    assert opened == [url]
    for bad in ("file:///C:/Windows/system32/calc.exe", "C:\evil.exe", "http://example.com"):
        assert client.post("/api/open-url", json={"url": bad}).status_code == 422
    assert opened == [url]


def test_saved_summary_counts_follow_ups_due(client):
    assert client.get("/api/saved/summary").json() == {"total": 0, "follow_ups_due": 0}
    client.post("/api/saved/alice")
    client.post("/api/saved/bob")
    client.patch("/api/saved/alice", json={"follow_up": "2020-01-01", "status": "contacted"})
    client.patch("/api/saved/bob", json={"follow_up": "2999-01-01"})
    assert client.get("/api/saved/summary").json() == {"total": 2, "follow_ups_due": 1}
    client.patch("/api/saved/alice", json={"status": "not_interested"})  # closed: no longer due
    assert client.get("/api/saved/summary").json()["follow_ups_due"] == 0


def test_rate_limit_shows_real_usage_not_the_stale_rate_limit_endpoint(client):
    client.mock.get("/rate_limit").mock(side_effect=rate_limit_for)  # stale: 0 used
    user = client.mock.get("/user").respond(200, json={"login": "me"}, headers=quota_headers(5000, 4990))

    r = client.get("/api/rate-limit").json()
    assert (r["core"]["used"], r["core"]["remaining"], r["core"]["limit"]) == (10, 4990, 5000)
    assert r["search"] is None  # unknown until a search runs
    assert user.call_count == 1

    # Real traffic keeps it current without extra requests.
    client.mock.get("/search/users").respond(200, json={"total_count": 0, "items": []},
                                             headers=quota_headers(30, 27, "search"))
    client.get("/api/search", params={"mode": "users", "q": "nobody"})
    r = client.get("/api/rate-limit").json()
    assert r["core"]["used"] == 10 and r["search"]["used"] == 3
    assert user.call_count == 1  # served from what the app already saw

    # Once the window resets, one small request refreshes it.
    client.app.state.gh.rate["core"]["reset"] = 1
    client.get("/api/rate-limit")
    assert user.call_count == 2


def test_all_accounts_merges_every_search_once(client):
    from app.jobs import JobState
    from app.models import Profile
    mgr = client.app.state.jobs
    alice = client.get("/api/profiles/alice").json()
    bob = client.get("/api/profiles/bob").json()
    for jid, name, created, people in [("j1", "older gis", "2026-01-01T00:00:00+00:00", [alice, bob]),
                                       ("j2", "newer bim", "2026-02-01T00:00:00+00:00", [alice])]:
        mgr.jobs[jid] = JobState(id=jid, name=name, query=name, params={}, target=10, status="completed",
                                 created_at=created, updated_at=created)
        mgr.results[jid] = [Profile.model_validate(p) for p in people]
    client.post("/api/saved/bob")

    accounts = client.get("/api/accounts").json()
    assert [a["login"] for a in accounts] == ["alice", "bob"]  # newest search first, no duplicates
    assert accounts[0]["found_in"] == ["newer bim", "older gis"]
    assert accounts[1]["found_in"] == ["older gis"] and accounts[1]["saved"] is True
    assert accounts[0]["contacts"]["emails"][0]["value"] == "alice@example.net"


def test_remove_selected_accounts_everywhere(client):
    from app.jobs import JobState
    from app.models import Profile
    mgr = client.app.state.jobs
    alice, bob = client.get("/api/profiles/alice").json(), client.get("/api/profiles/bob").json()
    for jid in ("j1", "j2"):
        mgr.jobs[jid] = JobState(id=jid, name=jid, query=jid, params={}, target=10, status="completed",
                                 created_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-01T00:00:00+00:00")
        mgr.results[jid] = [Profile.model_validate(alice), Profile.model_validate(bob)]
    running_list = mgr.results["j1"]
    client.post("/api/saved/alice")

    r = client.post("/api/accounts/remove", json={"logins": ["ALICE"]}).json()
    assert r == {"accounts": 1, "search_results_removed": 2, "cache_removed": 1, "saved_removed": 1}
    assert [a["login"] for a in client.get("/api/accounts").json()] == ["bob"]
    assert [p["login"] for p in client.get("/api/jobs/j2/results").json()] == ["bob"]
    assert running_list is mgr.results["j1"] and [p.login for p in running_list] == ["bob"]  # changed in place
    assert client.get("/api/saved").json() == []
    assert client.app.state.store.get_cached("alice") is None
    assert (client.app.state.jobs.dir / "j2.json").read_text(encoding="utf-8").count('"login": "alice"') == 0
    assert client.post("/api/accounts/remove", json={"logins": []}).status_code == 422
    assert client.post("/api/accounts/remove", json={"logins": ["bad name!"]}).status_code == 400


def test_mailbox_settings_and_email_address_as_custom_link(client, tmp_path):
    from app.drafts import DraftStore
    base = client.get("/api/draft-settings").json()
    assert base["gmail_link"] == "https://mail.google.com/mail/" and base["sender_provider"] == "auto"
    s = {**base, "app": "my_email", "sender_email": "me@outlook.com", "gmail_link": "https://mail.google.com/mail/u/1"}
    out = client.put("/api/draft-settings", json=s).json()
    assert out["gmail_link"] == "https://mail.google.com/mail/u/1/" and out["sender_email"] == "me@outlook.com"
    assert client.put("/api/draft-settings", json={**s, "sender_email": ""}).status_code == 422
    assert client.put("/api/draft-settings", json={**s, "outlook_link": "http://evil.example/"}).status_code == 422
    assert client.put("/api/draft-settings", json={**s, "sender_email": "not-an-email"}).status_code == 422

    # Settings saved with an email address typed as a custom link become "my mailbox".
    (tmp_path / "drafts.json").write_text('{"app": "custom", "custom_url": "https://kevin@outlook.com"}', encoding="utf-8")
    d = DraftStore(tmp_path).get()
    assert (d.app, d.sender_email, d.custom_url) == ("my_email", "kevin@outlook.com", "")


def test_seen_marks_are_kept_and_cleared_on_remove(client, tmp_path):
    assert client.get("/api/seen").json() == {}
    assert client.post("/api/seen", json={"logins": ["Alice", "bob"]}).json() == {"changed": 2, "total": 2}
    first = client.get("/api/seen").json()["alice"]
    assert client.post("/api/seen", json={"logins": ["alice"]}).json()["changed"] == 0  # already seen
    assert client.get("/api/seen").json()["alice"] == first  # keeps the first time
    assert '"alice"' in (tmp_path / "seen.json").read_text(encoding="utf-8")
    assert client.post("/api/seen", json={"logins": ["bob"], "seen": False}).json() == {"changed": 1, "total": 1}
    client.post("/api/accounts/remove", json={"logins": ["alice"]})
    assert client.get("/api/seen").json() == {}
    assert client.post("/api/seen", json={"logins": ["bad name!"]}).status_code == 400


def test_followers_scan_by_commit_period_keeps_only_recent_committers(client):
    client.mock.get("/users/mapper").respond(json=user_json("mapper", 50, followers=2))
    client.mock.get("/users/mapper/followers").respond(json=[{"login": "alice", "type": "User"}, {"login": "bob", "type": "User"}])
    r = client.get("/api/search", params={"mode": "followers", "followers_of": "mapper",
                                          "since": "2026-01-01", "until": "2026-06-30"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] == "followers of @mapper · commits 2026-01-01 → 2026-06-30"
    # The fixture gives alice commits in the period and bob none.
    assert [p["login"] for p in body["items"]] == ["alice"]
    assert body["items"][0]["period_activity"]["commits"] == 2
    job = client.post("/api/jobs", json={"mode": "followers", "followers_of": "mapper", "since": "2026-01-01",
                                         "until": "2026-06-30", "target": 5}).json()
    assert job["name"] == "followers of @mapper · commits 2026-01-01 → 2026-06-30"
    client.delete(f"/api/jobs/{job['id']}")
