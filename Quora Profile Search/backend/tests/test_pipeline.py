"""End-to-end pipeline + API tests with the search engine, Claude, GitHub, Reddit and web fetches stubbed out."""

import os

os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Person, SearchQuery  # noqa: E402
from app.services import pipeline  # noqa: E402
from app.services.ai import ground_extraction  # noqa: E402
from app.services.github import GitHubUser  # noqa: E402
from app.services.reddit import RedditPost, RedditUser  # noqa: E402
from app.services.search_engine import SearchHit  # noqa: E402
from tests.helpers import ep  # noqa: E402

HITS = {
    "quora": [
        SearchHit("Jane Doe - Senior Data Scientist at Acme Corp - Quora",
                  "https://www.quora.com/profile/Jane-Doe-3/answers",
                  "Jane Doe. Senior Data Scientist at Acme Corp. Lives in Seattle, WA. Python, machine learning. janedoe.dev"),
        SearchHit("Raj Kumar - Engineer - Quora", "https://www.quora.com/profile/Raj-Kumar",
                  "Raj Kumar. Engineer at Infosys. Lives in Bangalore, India"),
        SearchHit("Data Science - Quora", "https://www.quora.com/topic/Data-Science", "Topic page"),
    ],
    "linkedin": [SearchHit("Jane Doe - Senior Data Scientist - Acme Corp | LinkedIn",
                           "https://www.linkedin.com/in/janedoe?trk=x", "Seattle, Washington · Acme Corp")],
    "web": [SearchHit("Jane Doe", "https://janedoe.dev/blog/post", "Jane Doe's blog")],
    "reddit": [
        SearchHit("[For Hire] Senior React/Node developer, 8 years, based in Austin, TX : r/forhire",
                  "https://www.reddit.com/r/forhire/comments/abc123/for_hire_senior_react/",
                  "Senior React and Node.js developer with 8 years experience, based in Austin, TX. Available for "
                  "contract work. Portfolio: https://reactpro.dev Contact: hire@reactpro.dev"),
        SearchHit("[For Hire] Python dev in Toronto : r/forhire",
                  "https://www.reddit.com/r/forhire/comments/def456/python_dev/", "Python developer in Toronto, Canada."),
        SearchHit("r/forhire - Reddit", "https://www.reddit.com/r/forhire/", "Subreddit home page"),
    ],
    "medium": [
        SearchHit("Jane Smith – Medium", "https://medium.com/@janesmith",
                  "Staff engineer at Bolt. Writing about Go and distributed systems. Based in Brooklyn, NY. janesmith.dev"),
        SearchHit("Scaling Go services – Jane Smith – Medium", "https://medium.com/@janesmith/scaling-go-services-1a2b",
                  "As a staff engineer at Bolt, I spent 9 years building Go services..."),
        SearchHit("The Code Guy – Medium", "https://thecodeguy.medium.com/", "Tips and tricks. Based in Ohio."),
        SearchHit("Some Publication", "https://medium.com/some-publication/post-1", "A publication post"),
    ],
}

FEEDS = {
    "https://medium.com/feed/@janesmith": """<?xml version="1.0"?><rss><channel><title>Stories by Jane Smith on Medium</title>
      <item><title>Scaling Go services</title><category>golang</category><category>distributed-systems</category></item>
    </channel></rss>""",
}

POSTS = [
    RedditPost("t3_aaa", "forhire", "devsam", "[For Hire] Full-stack developer, 7 years experience",
               "React, TypeScript, Python. Based in Denver, CO. Available for contract work.\n"
               "Portfolio: https://samdev.io GitHub: https://github.com/devsam LinkedIn: https://www.linkedin.com/in/sam-x\n"
               "Email: hello@samdev.io or sam.personal@gmail.com", "/r/forhire/comments/aaa/x/", 1.0, "For Hire"),
    RedditPost("t3_bbb", "forhire", "londondev", "[For Hire] Backend dev", "Go and Rust. London, UK.",
               "/r/forhire/comments/bbb/x/", 1.0, "For Hire"),
    RedditPost("t3_ccc", "forhire", "acme_agency", "[Hiring] Need a React dev", "We are hiring.",
               "/r/forhire/comments/ccc/x/", 1.0, "Hiring"),
]


class FakeEngine:
    def __init__(self, *_):
        pass

    def search(self, q, count=10):
        if q.startswith("site:quora.com"):
            return HITS["quora"]
        if q.startswith("site:reddit.com/r/"):
            return HITS["reddit"]
        if q.startswith("site:medium.com"):
            return HITS["medium"]
        if q.startswith("site:linkedin.com"):
            return HITS["linkedin"]
        return HITS["web"]


class FakeClaude:
    def __init__(self, *_):
        pass

    def extract_people(self, rows, source="quora"):
        if source == "medium":
            by_url = {r["url"]: r["index"] for r in rows}
            out = [
                ep(index=by_url["https://medium.com/@janesmith"], full_name="Jane Smith", job_title="Staff engineer",
                   company="Bolt", years_experience=9, programming_languages=["Go"], location="Brooklyn, NY",
                   city="Brooklyn", state="NY", country="US", location_evidence="Based in Brooklyn, NY"),
                ep(index=by_url["https://medium.com/@thecodeguy"], full_name=None, location="Ohio", state="Ohio",
                   country="US", location_evidence="Based in Ohio"),
            ]
        elif source == "quora":
            out = [
                ep(index=0, full_name="Jane Doe", job_title="Senior Data Scientist", company="Acme Corp",
                   industry="Technology", skills=["Python", "machine learning"], location="Seattle, WA", city="Seattle",
                   state="WA", country="US", location_evidence="Lives in Seattle, WA"),
                ep(index=1, full_name="Raj Kumar", job_title="Engineer", company="Infosys",
                   location="Bangalore, India", country="OTHER", location_evidence="Lives in Bangalore, India"),
            ]
        elif "comments/abc123" in rows[0]["url"]:
            out = [
                ep(index=0, job_title="Senior React/Node developer", years_experience=8, skills=["React", "Node.js"],
                   freelance_available=True, location="Austin, TX", city="Austin", state="TX", country="US",
                   location_evidence="based in Austin, TX"),
                ep(index=1, job_title="Python developer", location="Toronto, Canada", country="OTHER",
                   location_evidence="Toronto, Canada"),
            ]
        else:
            out = [
                ep(index=0, job_title="Full-stack developer", years_experience=7, programming_languages=["TypeScript",
                   "Python"], skills=["React"], freelance_available=True, location="Denver, CO", city="Denver",
                   state="CO", country="US", location_evidence="Based in Denver, CO"),
                ep(index=1, job_title="Backend dev", programming_languages=["Go", "Rust"], location="London, UK",
                   country="OTHER", location_evidence="London, UK"),
                ep(index=2, is_individual_person=False),
            ]
        return [ground_extraction(p, rows[p.index]["text"]) for p in out]

    def summarize(self, record):
        return f"Summary of {record['display_name']}"

    def chat(self, messages, record):
        return "ok"


class FakeGitHub:
    def __init__(self, *_):
        pass

    def search_users(self, name, limit=3):
        return ["janedoe"]

    def get_user(self, login):
        if login == "berlindev":
            return GitHubUser("berlindev", "https://github.com/berlindev", None, None, None, "Berlin, Germany", None,
                              "Backend developer", None)
        if login == "devsam":
            return GitHubUser("devsam", "https://github.com/devsam", "Sam", None, "https://samdev.io",
                              "Denver, CO", None, "Full-stack dev. reddit: u/devsam", None)
        return GitHubUser("janedoe", "https://github.com/janedoe", "Jane Doe", "@AcmeCorp Acme Corp",
                          "https://janedoe.dev", "Seattle, WA", "jane@acmecorp.com", "Data scientist", None)


class FakeReddit:
    deleted: set[str] = set()

    def __init__(self, *_):
        pass

    def search_posts(self, q, subs, limit=25):
        return POSTS

    def get_user(self, name):
        return RedditUser(name, "", f"https://www.reddit.com/user/{name}")

    def existing_fullnames(self, names):
        return {n for n in names if n not in self.deleted}


class FakeFetcher:
    def __init__(self, *_):
        pass

    def get_html(self, url):
        pages = {
            "https://janedoe.dev/": '<h1>Jane Doe</h1> Data scientist at Acme Corp. <a href="/contact">Contact</a> '
                                    '<a href="https://github.com/janedoe">GitHub</a>',
            "https://janedoe.dev/contact": '<a href="mailto:hello@janedoe.dev">hello@janedoe.dev</a> '
                                           'or personal: jane.d@gmail.com',
            "https://janesmith.dev/": '<h1>Jane Smith</h1> Staff engineer at Bolt. '
                                      '<a href="https://medium.com/@janesmith">My Medium</a> '
                                      '<a href="mailto:jane@janesmith.dev">Email</a>',
            "https://reactpro.dev": '<h1>React Pro</h1> <a href="mailto:hire@reactpro.dev">hire me</a>',
            "https://samdev.io": '<h1>Sam</h1> <a href="https://www.reddit.com/user/devsam">my reddit</a> '
                                 '<a href="mailto:work@samdev.io">email</a>',
        }
        return (url, pages[url]) if url in pages else None

    def get_feed(self, url):
        return FEEDS.get(url)


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    for name, fake in (("SearchEngine", FakeEngine), ("ClaudeService", FakeClaude), ("GitHubClient", FakeGitHub),
                       ("PoliteFetcher", FakeFetcher), ("RedditClient", FakeReddit)):
        monkeypatch.setattr(pipeline, name, fake)
    import app.api as api
    monkeypatch.setattr(api, "ClaudeService", FakeClaude)
    FakeReddit.deleted = set()
    from app.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "reddit_client_id", "test-id")
    monkeypatch.setattr(s, "reddit_client_secret", "test-secret")
    monkeypatch.setattr(s, "anthropic_api_key", "test-key")  # use the (fake) Claude path by default


def _run(client, **body):
    r = client.post("/api/searches", json={"query": "developer", "query_type": "profession", **body})
    assert r.status_code == 202, r.text
    s = client.get(f"/api/searches/{r.json()['id']}").json()
    assert s["status"] == "done", s["message"]
    return s


def test_quora_flow():
    with TestClient(app) as client:
        s = _run(client, sources=["quora"])
        assert s["candidates_found"] == 2  # topic page dropped before extraction
        assert s["excluded_non_us"] == 1
        assert [p["display_name"] for p in s["people"]] == ["Jane Doe"]

        d = client.get(f"/api/people/{s['people'][0]['id']}").json()
        by_platform = {p["platform"]: p for p in d["profiles"]}
        assert by_platform["quora"]["match_status"] == "anchor"
        assert by_platform["website"]["match_status"] == "verified"   # Quora snippet names janedoe.dev
        assert by_platform["github"]["match_status"] == "verified"    # website links to GitHub
        assert by_platform["linkedin"]["match_status"] == "possible"  # snippet only, no cross-link
        emails = {c["value"]: c for c in d["contacts"]}
        assert emails["hello@janedoe.dev"]["provenance"] == "independently_verified"
        assert "jane.d@gmail.com" not in emails
        assert d["confidence"] > 0.5
        assert "Years of experience" in d["missing_fields"]


def test_medium_flow():
    with TestClient(app) as client:
        s = _run(client, sources=["medium"])
        assert s["candidates_found"] == 2  # publication post isn't an author URL
        assert [p["display_name"] for p in s["people"]] == ["Jane Smith"]  # pseudonymous "The Code Guy" skipped
        d = client.get(f"/api/people/{s['people'][0]['id']}").json()
        assert d["source_platform"] == "medium" and d["years_experience"] == 9
        by_platform = {p["platform"]: p for p in d["profiles"]}
        assert by_platform["medium"]["match_status"] == "anchor"
        assert by_platform["medium"]["title"] == "Jane Smith"  # display name from the RSS feed
        assert by_platform["website"]["match_status"] == "verified"  # site links to the Medium profile
        assert "github" not in by_platform  # GitHub user "Jane Doe" doesn't match the name
        emails = {c["value"]: c for c in d["contacts"]}
        assert emails["jane@janesmith.dev"]["provenance"] == "independently_verified"
        assert client.get("/api/people?platform=medium").json()[0]["id"] == d["id"]


def test_url_search_picks_matching_source():
    with TestClient(app) as client:
        r = client.post("/api/searches", json={"query": "https://medium.com/@janesmith", "query_type": "url"})
        assert r.json()["sources"] == ["medium"]
        r = client.post("/api/searches", json={"query": "https://www.quora.com/profile/Jane-Doe", "query_type": "url"})
        assert r.json()["sources"] == ["quora"]
        assert client.post("/api/searches", json={"query": "https://example.com/x", "query_type": "url"}).status_code == 422


def test_reddit_without_api_keys_uses_search_snippets(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "reddit_client_id", None)
    with TestClient(app) as client:
        assert client.get("/api/health").json()["reddit_mode"] == "search"
        s = _run(client, sources=["reddit"], subreddits=["forhire"])
        assert s["candidates_found"] == 2  # subreddit home page isn't a post
        assert s["excluded_non_us"] == 1   # Toronto
        assert s["message"].startswith("Reddit (search snippets): 1")
        p = s["people"][0]
        assert p["display_name"] == "r/forhire: [For Hire] Senior React/Node developer, 8 years, based in Austin, TX"
        d = client.get(f"/api/people/{p['id']}").json()
        assert d["reddit_username"] is None and d["full_name"] is None
        anchor = next(x for x in d["profiles"] if x["match_status"] == "anchor")
        assert anchor["url"] == "https://www.reddit.com/r/forhire/comments/abc123/"
        site = next(x for x in d["profiles"] if x["platform"] == "website")
        assert site["match_status"] == "self_reported"  # no username → can't check a link back
        emails = {c["value"]: c for c in d["contacts"]}
        # posted in the Reddit snippet and also on the person's own site — either is a traceable public source
        assert emails["hire@reactpro.dev"]["source_url"] in (anchor["url"], "https://reactpro.dev")
        assert emails["hire@reactpro.dev"]["provenance"] == "self_reported"

        # API-based deletion sync must not touch snippet-sourced records; the 30-day expiry does
        assert client.post("/api/maintenance/reddit-sync").json()["removed"] == 0
        from datetime import datetime, timedelta, timezone
        from app.models import Profile
        from app.services.pipeline import purge_stale_reddit_snippets
        db = SessionLocal()
        prof = db.get(Profile, anchor["id"])
        prof.discovered_at = datetime.now(timezone.utc) - timedelta(days=31)
        db.commit()
        assert purge_stale_reddit_snippets(db) == 1
        db.close()
        assert client.get(f"/api/people/{d['id']}").status_code == 404


def test_old_database_gets_new_columns():
    from sqlalchemy import inspect, text
    from app.db import init_db
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE people DROP COLUMN alias"))
    assert "alias" not in {c["name"] for c in inspect(engine).get_columns("people")}
    init_db()
    assert "alias" in {c["name"] for c in inspect(engine).get_columns("people")}


def test_reddit_flow_only_uses_self_posted_links():
    with TestClient(app) as client:
        s = _run(client, sources=["reddit"])
        assert s["candidates_found"] == 3
        assert s["excluded_non_us"] == 1  # London dev
        assert [p["display_name"] for p in s["people"]] == ["u/devsam"]  # agency [Hiring] post excluded

        d = client.get(f"/api/people/{s['people'][0]['id']}").json()
        assert d["full_name"] is None  # never derived from username/email
        assert d["years_experience"] == 7 and d["freelance_available"] is True
        assert "Full name (not publicly disclosed)" in d["missing_fields"]
        by_platform = {p["platform"]: p for p in d["profiles"]}
        assert by_platform["reddit"]["match_status"] == "anchor"
        assert by_platform["github"]["match_status"] == "verified"        # bio mentions u/devsam
        assert by_platform["website"]["match_status"] == "verified"       # site links back to reddit profile
        assert by_platform["linkedin"]["match_status"] == "self_reported"  # never fetched
        assert all(p["match_status"] != "possible" for p in d["profiles"])  # no name-based guessing for Reddit
        emails = {c["value"]: c for c in d["contacts"]}
        assert emails["hello@samdev.io"]["provenance"] == "self_reported"
        assert emails["hello@samdev.io"]["source_url"].startswith("https://www.reddit.com/r/forhire")
        assert emails["work@samdev.io"]["provenance"] == "independently_verified"
        # personal address the author posted themselves: kept, labeled personal
        assert emails["sam.personal@gmail.com"]["is_business"] is False
        assert emails["hello@samdev.io"]["is_business"] is True

        # filters
        assert len(client.get("/api/people?language=typescript&freelance=true&min_years=5").json()) == 1
        assert client.get("/api/people?min_years=10").json() == []
        assert len(client.get("/api/people?location=denver&has_contact=true").json()) == 1

        # deleted Reddit post → record purged
        FakeReddit.deleted = {"t3_aaa"}
        assert client.post("/api/maintenance/reddit-sync").json()["removed"] == 1
        assert client.get(f"/api/people/{d['id']}").status_code == 404


def test_edit_tags_duplicates_merge_export():
    with TestClient(app) as client:
        jane = _run(client, sources=["quora"])["people"][0]["id"]
        sam = _run(client, sources=["reddit"])["people"][0]["id"]

        r = client.patch(f"/api/people/{sam}", json={"company": "Samdev LLC", "tags": ["react", " frontend "],
                                                     "category": "Freelancers"})
        assert r.status_code == 200
        body = r.json()
        assert body["tags"] == ["react", "frontend"] and "company" in body["edited_fields"]
        assert "category" not in body["edited_fields"]
        assert client.get("/api/people?tag=react").json()[0]["id"] == sam
        assert client.get("/api/tags").json()["categories"][0]["name"] == "Freelancers"

        # A user's edit survives a re-run of discovery
        _run(client, sources=["reddit"])
        assert client.get(f"/api/people/{sam}").json()["company"] == "Samdev LLC"

        # duplicate detection via shared email, then merge
        client.patch(f"/api/people/{jane}", json={"notes": "x"})
        db = SessionLocal()
        from app.models import Contact
        db.add(Contact(person_id=jane, kind="email", value="hello@samdev.io", source_url="https://samdev.io"))
        db.commit()
        db.close()
        groups = client.get("/api/people/duplicates").json()
        assert len(groups) == 1 and "Same email" in groups[0]["reason"]
        merged = client.post(f"/api/people/{jane}/merge", json={"other_id": sam}).json()
        assert merged["reddit_username"] == "devsam" and merged["full_name"] == "Jane Doe"
        assert client.get(f"/api/people/{sam}").status_code == 404

        x = client.get("/api/export?format=xlsx")
        assert x.status_code == 200 and x.content[:2] == b"PK"
        c = client.get(f"/api/export?format=csv&ids={jane}").text
        assert "Jane Doe" in c and "independently verified" in c
        a = client.get("/api/analytics").json()
        assert a["total_people"] == 1 and a["by_platform"][0]["count"] == 1
        assert client.post(f"/api/people/{jane}/summary").json()["ai_summary"] == "Summary of Jane Doe"


def test_rerun_updates_without_duplicates():
    db = SessionLocal()
    from app.config import get_settings
    get_settings().reddit_client_id, get_settings().reddit_client_secret = "test-id", "test-secret"
    for _ in range(2):
        s = SearchQuery(query="Jane Doe", query_type="name", sources=["quora", "medium", "reddit"], filters={})
        db.add(s)
        db.commit()
        pipeline.SearchJob(db).run(s)
    assert db.query(Person).count() == 3
    db.close()


def test_free_mode_without_anthropic_key(monkeypatch):
    """No Anthropic key → rule-based extraction runs end to end (FakeClaude must not be used)."""
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    class Boom:
        def __init__(self, *_):
            raise AssertionError("Claude must not be used in free mode")
    monkeypatch.setattr(pipeline, "ClaudeService", Boom)
    with TestClient(app) as client:
        assert client.get("/api/health").json()["ai_mode"] == "rules"
        s = _run(client, sources=["quora"])
        names = [p["display_name"] for p in s["people"]]
        assert names == ["Jane Doe"]  # Raj Kumar (India) and the topic page are excluded by the rules too
        d = client.get(f"/api/people/{s['people'][0]['id']}").json()
        assert d["job_title"] == "Senior Data Scientist" and d["company"] == "Acme Corp" and d["state"] == "WA"
        summary = client.post(f"/api/people/{d['id']}/summary").json()["ai_summary"]
        assert "Free mode" in summary
        reply = client.post("/api/assistant", json={"person_id": d["id"], "messages": [
            {"role": "user", "content": "Why might these profiles belong to the same person?"}]}).json()["reply"]
        assert "website" in reply


EU_POSTS = [
    SearchHit("[For Hire] Backend developer based in Berlin, Germany : r/forhire",
              "https://www.reddit.com/r/forhire/comments/eu1/backend/",
              "[For Hire] Backend developer, 6 years experience. Python and Go. Based in Berlin, Germany. "
              "GitHub: https://github.com/berlindev"),
    SearchHit("[For Hire] Product designer in Lyon, France : r/forhire",
              "https://www.reddit.com/r/forhire/comments/eu2/designer/",
              "[For Hire] Product designer, Figma and UI/UX. Based in Lyon, France. DM me."),
    SearchHit("[For Hire] React dev in Austin, TX : r/forhire",
              "https://www.reddit.com/r/forhire/comments/us1/react/",
              "[For Hire] React developer based in Austin, TX. Email me: dev.austin@gmail.com"),
]


@pytest.fixture
def free_mode_eu(monkeypatch):
    from app.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "anthropic_api_key", None)
    monkeypatch.setattr(s, "reddit_client_id", None)  # Reddit through search snippets
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setitem(HITS, "reddit", EU_POSTS)
    return s


def test_us_and_europe_with_contact_required(free_mode_eu):
    with TestClient(app) as client:
        s = _run(client, sources=["reddit"], subreddits=["forhire"], regions=["US", "EU"])
        people = {p["display_name"]: p for p in s["people"]}
        assert len(people) == 2, s["message"]
        assert s["excluded_no_contact"] == 1  # Lyon designer posted no GitHub or email
        assert "no GitHub link or published email" in s["message"]
        berlin = next(p for n, p in people.items() if "Berlin" in n)
        austin = next(p for n, p in people.items() if "Austin" in n)
        assert berlin["country"] == "EU" and austin["country"] == "US"
        d = client.get(f"/api/people/{berlin['id']}").json()
        gh = next(x for x in d["profiles"] if x["platform"] == "github")
        assert gh["match_status"] == "self_reported" and gh["url"] == "https://github.com/berlindev"
        d = client.get(f"/api/people/{austin['id']}").json()
        assert d["contacts"][0]["value"] == "dev.austin@gmail.com" and d["contacts"][0]["is_business"] is False
        assert len(client.get("/api/people?country=EU").json()) == 1
        x = client.get("/api/export?format=csv").text
        assert "Europe" in x and "personal" in x


def test_us_only_search_skips_europeans(free_mode_eu):
    with TestClient(app) as client:
        s = _run(client, sources=["reddit"], subreddits=["forhire"], regions=["US"])
        assert [p["country"] for p in s["people"]] == ["US"]
        assert s["excluded_non_us"] == 2 and "not in United States" in s["message"]


def test_personal_emails_can_be_switched_off(free_mode_eu, monkeypatch):
    monkeypatch.setattr(free_mode_eu, "include_personal_emails", False)
    with TestClient(app) as client:
        s = _run(client, sources=["reddit"], subreddits=["forhire"])
        assert [p["country"] for p in s["people"]] == ["EU"]  # Austin's only contact was a gmail address
        assert s["excluded_no_contact"] == 2


def test_contact_requirement_can_be_turned_off(free_mode_eu):
    with TestClient(app) as client:
        s = _run(client, sources=["reddit"], subreddits=["forhire"], require_contact=False)
        assert len(s["people"]) == 3 and not s["excluded_no_contact"]
