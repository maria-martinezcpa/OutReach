import os

os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from app.schemas import SearchRequest  # noqa: E402
from app.services.ai import ground_extraction  # noqa: E402
from tests.helpers import ep  # noqa: E402
from app.services.contacts import email_belongs_to_site, parse_page  # noqa: E402
from app.services.export import _safe  # noqa: E402
from app.services.quora import build_queries, canonical_profile_url, name_from_slug, profile_slug  # noqa: E402
from app.services.us_location import is_us_location  # noqa: E402
from app.services.verify import Candidate, Identity, score_candidate  # noqa: E402


def test_quora_url_parsing():
    assert profile_slug("https://www.quora.com/profile/Jane-Doe-12/answers") == "Jane-Doe-12"
    assert canonical_profile_url("https://es.quora.com/profile/Jane-Doe?ch=1") == "https://www.quora.com/profile/Jane-Doe"
    assert name_from_slug("Jane-Doe-12") == "Jane Doe"
    assert profile_slug("https://www.quora.com/What-is-X") is None


def test_queries_include_us_hint_for_keyword_search():
    qs = build_queries(SearchRequest(query="data scientist", query_type="profession"))
    assert all(q.startswith("site:quora.com/profile") for q in qs)
    assert "United States" in qs[0]


def test_us_location():
    assert is_us_location("Lives in San Francisco, CA") is True
    assert is_us_location("Austin, Texas") is True
    assert is_us_location("USA") is True
    assert is_us_location("Bangalore, India") is False
    assert is_us_location("London, UK") is False
    assert is_us_location("São Paulo, South America") is False
    assert is_us_location(None) is None


def test_grounding_drops_invented_fields():
    src = "Jane Doe - Senior Data Scientist at Acme Corp - Quora. Lives in Seattle, WA. Python, SQL."
    p = ep(full_name="Jane Doe", job_title="Senior Data Scientist", company="Google", skills=["Python", "Kubernetes"],
           location="Seattle, WA", country="US", location_evidence="Lives in Seattle, WA", years_experience=8)
    g = ground_extraction(p, src)
    assert g.company is None            # not in the source → removed
    assert g.skills == ["Python"]       # invented skill removed
    assert g.country == "US" and g.location == "Seattle, WA"
    assert g.years_experience is None   # "8 years" isn't in the source


def test_grounding_requires_verbatim_location_evidence():
    p = ep(full_name="Jane Doe", country="US", location_evidence="Lives in Boston")
    assert ground_extraction(p, "Jane Doe - Quora. Studied at MIT").country == "UNKNOWN"


def test_email_extraction():
    html = """<html><body><a href="mailto:jane@janedoe.dev?subject=Hi">Email me</a>
    Contact: press@acme.com or jane.doe@gmail.com <img src="logo@2x.png"></body></html>"""
    _, emails = parse_page("https://janedoe.dev/contact", html)
    vals = {e.value: e for e in emails}
    assert "jane@janedoe.dev" in vals and vals["jane@janedoe.dev"].via_mailto
    assert vals["jane.doe@gmail.com"].is_business is False
    assert "logo@2x.png" not in vals
    assert email_belongs_to_site("jane@janedoe.dev", "https://www.janedoe.dev/")


def test_verification_levels():
    ident = Identity("Jane Doe", company="Acme Corp", job_title="Data Scientist", region="US")
    gh = Candidate("github", "https://github.com/janedoe", "Jane Doe Data scientist at Acme Corp", name="Jane Doe",
                   company="Acme Corp", location="Seattle, WA", outbound_links=["https://janedoe.dev"])
    site = Candidate("website", "https://janedoe.dev/", "Jane Doe — data scientist",
                     outbound_links=["https://www.quora.com/profile/Jane-Doe"])
    other = Candidate("github", "https://github.com/jdoe", "John Smith", name="John Smith")
    abroad = Candidate("github", "https://github.com/janedoe-uk", "Jane Doe", name="Jane Doe", location="London, UK")

    anchor = ["https://www.quora.com/profile/Jane-Doe"]
    assert score_candidate(ident, site, anchor).status == "verified"
    assert score_candidate(ident, gh, anchor).status == "possible"
    assert score_candidate(ident, gh, anchor + [site.url]).status == "verified"  # links to verified website
    assert score_candidate(ident, other, anchor).status is None
    assert score_candidate(ident, abroad, anchor).status is None  # US person, London GitHub → rejected
    eu = Identity("Jane Doe", region="EU")
    assert score_candidate(eu, abroad, anchor).status == "possible"  # same London GitHub fits a European person
    assert score_candidate(eu, gh, anchor).status is None             # …and a Seattle one doesn't


def test_region_detection():
    from app.services.regions import region_of
    cases = {"Berlin, Germany": "EU", "London, UK": "EU", "Lives in Amsterdam": "EU", "Paris, TX": "US",
             "London, Ontario": "OTHER", "Austin, TX": "US", "New England": "US", "Bangalore, India": "OTHER",
             "Warsaw": "EU", "based in the Netherlands": "EU", None: None}
    for text, want in cases.items():
        assert region_of(text) == want, text


def test_csv_formula_injection_guard():
    assert _safe("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert _safe("Jane") == "Jane"


def test_grounding_reddit_fields():
    src = "[For Hire] Full-stack dev, 6 years experience. React, Node.js, C#, Postgres. Based in Austin, TX. Available for contract work."
    g = ground_extraction(ep(years_experience=6, programming_languages=["C#", "Rust"], skills=["React", "Node.js"],
                             freelance_available=True, city="Austin", state="TX", country="US",
                             location_evidence="Based in Austin, TX"), src)
    assert g.years_experience == 6
    assert g.programming_languages == ["C#"]
    assert g.skills == ["React", "Node.js"]
    assert g.freelance_available is True and g.country == "US"


def test_link_classification_and_extraction():
    from app.services.pipeline import classify_link
    from app.services.reddit import extract_links
    text = "Portfolio: [site](https://janedev.io/). GitHub https://github.com/janedev, resume https://docs.google.com/x"
    links = extract_links(text)
    assert "https://janedev.io/" in links and "https://github.com/janedev" in links
    assert classify_link("https://github.com/janedev") == "github"
    assert classify_link("https://github.com/janedev/repo") is None
    assert classify_link("https://www.linkedin.com/in/jane") == "linkedin"
    assert classify_link("https://docs.google.com/x") is None
    assert classify_link("https://janedev.io/") == "website"


def test_medium_url_and_feed_parsing():
    from app.services.medium import group_by_author, parse_feed, parse_medium_url
    from app.services.search_engine import SearchHit
    assert parse_medium_url("https://medium.com/@jane.doe") == ("jane.doe", True)
    assert parse_medium_url("https://medium.com/@jane.doe/my-post-123?source=x") == ("jane.doe", False)
    assert parse_medium_url("https://janedoe.medium.com/about") == ("janedoe", True)
    assert parse_medium_url("https://help.medium.com/hc/en-us") is None
    assert parse_medium_url("https://medium.com/some-pub/post") is None
    authors = group_by_author([SearchHit("Jane", "https://medium.com/@jane", "bio"),
                               SearchHit("Post", "https://jane.medium.com/post-1", "article")])
    assert len(authors) == 1 and authors["jane"].profile_snippets and authors["jane"].article_snippets
    name, titles, tags = parse_feed("<rss><channel><title>Stories by Jane Doe on Medium</title>"
                                    "<item><title>Hello</title><category>python</category></item></channel></rss>")
    assert (name, titles, tags) == ("Jane Doe", ["Hello"], ["python"])
    assert parse_feed("not xml") == (None, [], [])


def test_medium_is_never_crawled():
    from app.services.fetcher import FEED_ALLOWLIST, is_blocked
    assert is_blocked("https://medium.com/@jane") and is_blocked("https://jane.medium.com/")
    assert any(p.match("https://medium.com/feed/@jane") for p in FEED_ALLOWLIST)
    assert not any(p.match("https://medium.com/@jane") for p in FEED_ALLOWLIST)


def test_clean_reddit_title():
    from app.services.pipeline import REDDIT_POST_RE, clean_reddit_title
    assert clean_reddit_title("[For Hire] React dev : r/forhire") == "[For Hire] React dev"
    assert clean_reddit_title("[For Hire] React dev : r/forhire - Reddit") == "[For Hire] React dev"
    m = REDDIT_POST_RE.match("https://old.reddit.com/r/forhire/comments/Abc12/x/")
    assert m and m.group(1) == "forhire" and m.group(2) == "Abc12"
    assert REDDIT_POST_RE.match("https://www.reddit.com/r/forhire/") is None


def test_site_operator_split():
    from app.services.search_engine import split_site_operators
    q, inc, exc = split_site_operators('site:quora.com/profile "Jane Doe" -site:x.com -site:linkedin.com dev')
    assert q == '"Jane Doe" dev' and inc == ["quora.com"] and exc == ["x.com", "linkedin.com"]


def test_free_search_providers_parse_responses():
    import httpx
    from app.config import Settings
    from app.services.search_engine import SearchEngine

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json
        seen[request.url.host] = (dict(request.headers), json.loads(request.content))
        if request.url.host == "api.tavily.com":
            return httpx.Response(200, json={"results": [{"title": "T", "url": "https://www.quora.com/profile/A", "content": "c"}]})
        return httpx.Response(200, json={"organic": [{"title": "S", "link": "https://medium.com/@a", "snippet": "s"}]})

    for provider, host in (("tavily", "api.tavily.com"), ("serper", "google.serper.dev")):
        eng = SearchEngine(Settings(search_provider=provider, tavily_api_key="tvly-k", serper_api_key="sk"))
        eng.client = httpx.Client(transport=httpx.MockTransport(handler))
        hits = eng.search('site:quora.com/profile "Jane" -site:x.com', 5)
        assert len(hits) == 1 and hits[0].url.startswith("https://")
    headers, body = seen["api.tavily.com"]
    assert headers["authorization"] == "Bearer tvly-k"
    assert body["include_domains"] == ["quora.com"] and body["exclude_domains"] == ["x.com"] and body["query"] == '"Jane"'
    headers, body = seen["google.serper.dev"]
    assert headers["x-api-key"] == "sk" and body["q"].startswith("site:quora.com/profile")


def test_provider_falls_back_to_any_configured_key():
    from app.config import Settings
    from app.services.search_engine import SearchEngine
    assert SearchEngine(Settings(search_provider="brave", serper_api_key="k")).provider() == "serper"
    assert SearchEngine(Settings(search_provider="tavily", tavily_api_key="k", serper_api_key="k")).provider() == "tavily"
    assert SearchEngine(Settings(search_provider="tavily")).provider() == "tavily"  # nothing set → clear error later


def test_serper_asks_for_at_most_10_and_retries_dropped_connections(monkeypatch):
    import json
    import httpx
    from app.config import Settings
    from app.services import search_engine
    from app.services.search_engine import SearchEngine, SearchEngineError

    monkeypatch.setattr(search_engine.time, "sleep", lambda s: None)
    calls = []

    def flaky(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        return httpx.Response(200, json={"organic": [{"title": "A", "link": "https://www.quora.com/profile/A", "snippet": "s"}]})

    eng = SearchEngine(Settings(search_provider="serper", serper_api_key="k"))
    eng.client = httpx.Client(transport=httpx.MockTransport(flaky))
    assert len(eng.search("site:quora.com/profile dev", 20)) == 1
    assert len(calls) == 2 and calls[-1]["num"] == 10

    def down(request):
        raise httpx.ConnectTimeout("timed out")

    eng.client = httpx.Client(transport=httpx.MockTransport(down))
    try:
        eng.search("x", 10)
        raise AssertionError("expected SearchEngineError")
    except SearchEngineError as e:
        assert "Couldn't reach the serper search service" in str(e)
