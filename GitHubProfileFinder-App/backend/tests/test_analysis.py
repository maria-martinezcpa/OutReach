from datetime import datetime, timezone

from app.analysis import analyze
from app.models import Contacts

NOW = datetime(2026, 9, 1, tzinfo=timezone.utc)


def repo(name, lang="Python", created="2022-01-10T00:00:00Z", pushed="2026-08-01T00:00:00Z", fork=False, **kw):
    return {"name": name, "language": lang, "created_at": created, "pushed_at": pushed, "fork": fork,
            "stargazers_count": kw.get("stars", 0), "description": kw.get("description"), "topics": kw.get("topics", [])}


def test_established_human_account_is_high():
    user = {"login": "geo-dev", "type": "User", "created_at": "2015-03-01T00:00:00Z", "name": "Geo Dev",
            "bio": "GIS developer", "location": "Oslo", "company": "Acme", "blog": "geo.dev",
            "followers": 50, "following": 20}
    repos = [
        repo("postgis-tools", description="PostGIS helpers", created=f"2021-{m:02d}-01T00:00:00Z",
             pushed=f"2026-0{1 + m % 8}-01T00:00:00Z")
        for m in range(1, 7)
    ] + [repo("webmap", lang="TypeScript", topics=["leaflet", "react"]), repo("cli", lang="Go")]
    a = analyze(user, repos, Contacts(website="https://geo.dev"), NOW)
    assert a.human_confidence == "HIGH"
    assert a.activity_status == "ACTIVE"
    skills = {s.name: s for s in a.skills}
    assert skills["PostGIS"].level == "HIGH"
    assert "postgis-tools" in skills["PostGIS"].evidence_repos
    assert skills["GIS"].sources == ["GitHub bio"]
    assert "not verified" in skills["Python"].basis
    assert a.limitations


def test_bot_account_is_low():
    a = analyze({"login": "dependabot[bot]", "type": "Bot"}, [], Contacts(), NOW)
    assert a.human_confidence == "LOW"
    assert a.evidence[0].effect == "against"


def test_empty_account_is_insufficient_data():
    a = analyze({"login": "x", "type": "User", "created_at": "2026-08-20T00:00:00Z"}, [], Contacts(), NOW)
    assert a.human_confidence == "INSUFFICIENT_DATA"
    assert a.activity_status == "UNKNOWN"


def test_mass_follow_pattern_counts_against():
    user = {"login": "growth", "type": "User", "created_at": "2024-01-01T00:00:00Z", "followers": 3, "following": 5000}
    a = analyze(user, [repo("a")], Contacts(), NOW)
    assert any(s.signal == "Follow pattern" and s.effect == "against" for s in a.evidence)
    assert a.human_confidence == "LOW"


def test_inactive_status():
    a = analyze({"login": "old", "type": "User"}, [repo("a", pushed="2020-01-01T00:00:00Z")], Contacts(), NOW)
    assert a.activity_status == "INACTIVE"
