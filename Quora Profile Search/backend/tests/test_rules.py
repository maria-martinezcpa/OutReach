"""Free (no-AI) rule-based extraction."""

import os

os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from app.services.rules import RuleBasedAI, extract_one, find_location, find_role, looks_like_person_name, use_claude  # noqa: E402


def test_quora_snippet():
    p = extract_one({"index": 0, "url": "https://www.quora.com/profile/Jane-Doe-3",
                     "text": "Jane Doe - Senior Data Scientist at Acme Corp - Quora\n"
                             "Senior Data Scientist at Acme Corp. Lives in Seattle, WA. 10 years of experience "
                             "with Python, SQL and machine learning."}, "quora")
    assert p.full_name == "Jane Doe" and p.is_individual_person
    assert p.job_title == "Senior Data Scientist" and p.company == "Acme Corp"
    assert (p.city, p.state, p.country) == ("Seattle", "WA", "US")
    assert p.location_evidence == "Lives in Seattle, WA"
    assert p.years_experience == 10
    assert {"Python", "SQL"} <= set(p.programming_languages) and "Machine learning" in p.skills


def test_quora_name_from_slug_and_non_us():
    p = extract_one({"index": 0, "url": "https://www.quora.com/profile/Raj-Kumar-12",
                     "text": "Profile page - Quora\nEngineer at Infosys. Lives in Bangalore, India"}, "quora")
    assert p.full_name == "Raj Kumar" and p.country == "OTHER"


def test_medium_feed_name_and_pseudonym():
    real = extract_one({"index": 0, "url": "https://medium.com/@janesmith",
                        "text": "Display name (from the author's Medium RSS feed): Jane Smith\n\n"
                                "Author profile page (search result):\nJane Smith – Medium — Staff engineer at Bolt. "
                                "Writing about Go and distributed systems. Based in Brooklyn, NY."}, "medium")
    assert real.full_name == "Jane Smith" and real.company == "Bolt" and real.country == "US"
    assert "Go" in real.programming_languages and "Distributed systems" in real.skills
    fake = extract_one({"index": 1, "url": "https://medium.com/@thecodeguy",
                        "text": "Display name (from the author's Medium RSS feed): The Code Guy\n\nTips. Based in Ohio."},
                       "medium")
    assert fake.full_name is None and not fake.is_individual_person


def test_reddit_posts():
    hire = extract_one({"index": 0, "url": "https://www.reddit.com/r/forhire/comments/a/",
                        "text": "[For Hire] Full-stack developer, 7 years experience\n\nReact, TypeScript, Node.js. "
                                "Based in Denver, CO. Available for contract work."}, "reddit")
    assert hire.is_individual_person and hire.full_name is None  # never derived from a username
    assert hire.freelance_available is True and hire.years_experience == 7
    assert hire.country == "US" and hire.city == "Denver"
    assert "TypeScript" in hire.programming_languages and {"React", "Node.js"} <= set(hire.skills)
    hiring = extract_one({"index": 1, "url": "u", "text": "[Hiring] Need a React dev\n\nWe are hiring."}, "reddit")
    assert not hiring.is_individual_person
    named = extract_one({"index": 2, "url": "u", "text": "[For Hire] Hi, my name is Sam Lee, a designer in Austin, TX"},
                        "reddit")
    assert named.full_name == "Sam Lee"


def test_unknown_location_is_not_us():
    p = extract_one({"index": 0, "url": "u", "text": "[For Hire] Remote React developer for US companies"}, "reddit")
    assert p.country == "UNKNOWN"  # working for US companies doesn't establish where someone lives


def test_helpers():
    assert looks_like_person_name("Jane Doe") and looks_like_person_name("Mary-Jane O'Neil")
    assert not looks_like_person_name("The Code Guy") and not looks_like_person_name("devwriter99")
    assert find_role("I'm a backend engineer at Stripe Inc.") == ("backend engineer", "Stripe Inc")
    assert find_location("US-based freelancer") == ("United States", None, None, "US-based")
    assert find_location("Originally from Texas, now in London")[0] is None


def test_selector_and_summary():
    class S:
        anthropic_api_key, ai_mode = None, "auto"
    s = S()
    old = os.environ.pop("ANTHROPIC_API_KEY", None)
    try:
        assert use_claude(s) is False
        s.anthropic_api_key = "k"
        assert use_claude(s) is True
        s.ai_mode = "off"
        assert use_claude(s) is False
    finally:
        if old is not None:
            os.environ["ANTHROPIC_API_KEY"] = old
    rec = {"display_name": "Jane Doe", "job_title": "Engineer", "company": "Acme", "city": "Austin", "state": "TX",
           "programming_languages": ["Python"], "skills": [], "years_experience": 5, "freelance_available": True,
           "profiles": [{"platform": "github", "match_status": "verified", "url": "https://github.com/j",
                         "match_score": 0.9, "match_reasons": ["Website links to it"]}],
           "missing_fields": ["Company"], "conflicts": []}
    text = RuleBasedAI().summarize(rec)
    assert "Engineer at Acme" in text and "github (verified)" in text and "Free mode" in text
    assert "Missing" in RuleBasedAI().chat([{"role": "user", "content": "What's missing?"}], rec)
