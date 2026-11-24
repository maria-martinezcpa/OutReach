"""Free, rule-based alternative to the AI layer (no API key needed).

Every value it returns is a substring of the source text (or a canonical name of a term that
appears in it), and results still pass through `ground_extraction`, so nothing is invented.
It finds less than the AI does: titles must follow "<role> at <Company>", locations must follow
phrases like "Lives in" / "based in" or look like "City, ST".
"""

import os
import re
from typing import Literal

from .ai import ExtractedPerson, ground_extraction
from .quora import name_from_slug, profile_slug
from .regions import EUROPE_COUNTRIES, REGION_LABEL, region_of
from .us_location import US_STATES, is_us_location

ROLE_WORDS = (r"engineer|developer|dev|designer|manager|scientist|founder|co-?founder|consultant|analyst|architect|"
              r"programmer|freelancer|director|cto|ceo|coo|vp|lead|researcher|specialist|administrator|devops|"
              r"product owner|tech lead|data engineer|sre")
ROLE_PREFIX = (r"(?:(?:senior|sr\.?|staff|lead|principal|junior|jr\.?|head of|chief|full[- ]?stack|front[- ]?end|"
               r"back[- ]?end|software|data|ml|ai|machine learning|devops|cloud|mobile|web|product|engineering|ios|"
               r"android|react|python|javascript|java|node(?:\.js)?|ux|ui|ui/ux|security|qa|game|embedded|"
               r"blockchain|wordpress|shopify|independent|freelance)\s+){0,4}")
ROLE_RE = re.compile(rf"\b({ROLE_PREFIX}(?:{ROLE_WORDS}))\b", re.I)
COMPANY_RE = re.compile(r"^\s+(?:at|@)\s+([A-Z][\w&.'\-]*(?:\s+(?:[A-Z][\w&.'\-]*|&|of))*)")

LANGUAGES = {
    "Python": r"\bpython\b", "JavaScript": r"\bjavascript\b|\bJS\b", "TypeScript": r"\btypescript\b",
    "Java": r"\bjava\b(?!\s*script)", "Go": r"\bgolang\b|\bGo\b(?=\s*(?:,|/|\)|and\b|developer|engineer|services|backend))",
    "Rust": r"\brust\b", "C++": r"\bc\+\+", "C#": r"\bc#", "Ruby": r"\bruby\b", "PHP": r"\bphp\b",
    "Swift": r"\bswift\b", "Kotlin": r"\bkotlin\b", "Scala": r"\bscala\b", "SQL": r"\bsql\b", "Dart": r"\bdart\b",
    "Elixir": r"\belixir\b", "Haskell": r"\bhaskell\b", "Solidity": r"\bsolidity\b", "Objective-C": r"\bobjective-c\b",
    "R": r"\bR\b(?=\s*(?:,|/|and\b|programming|language))", "HTML": r"\bhtml5?\b", "CSS": r"\bcss3?\b",
    "Bash": r"\bbash\b|\bshell scripting\b", "Lua": r"\blua\b", "Perl": r"\bperl\b",
}
SKILLS = {
    "React": r"\breact(?:\.js|js)?\b(?!\s*native)", "React Native": r"\breact native\b", "Next.js": r"\bnext\.?js\b",
    "Node.js": r"\bnode(?:\.js|js)?\b", "Vue": r"\bvue(?:\.js|js)?\b", "Angular": r"\bangular\b", "Svelte": r"\bsvelte\b",
    "Django": r"\bdjango\b", "Flask": r"\bflask\b", "FastAPI": r"\bfastapi\b", "Ruby on Rails": r"\brails\b",
    "Laravel": r"\blaravel\b", "Spring": r"\bspring boot\b|\bspring\b(?=\s*(?:,|/|framework))", ".NET": r"\.net\b",
    "Express": r"\bexpress(?:\.js|js)?\b", "GraphQL": r"\bgraphql\b", "REST APIs": r"\brest(?:ful)? apis?\b",
    "AWS": r"\baws\b", "Azure": r"\bazure\b", "GCP": r"\bgcp\b|\bgoogle cloud\b", "Docker": r"\bdocker\b",
    "Kubernetes": r"\bkubernetes\b|\bk8s\b", "Terraform": r"\bterraform\b", "PostgreSQL": r"\bpostgres(?:ql)?\b",
    "MySQL": r"\bmysql\b", "MongoDB": r"\bmongo(?:db)?\b", "Redis": r"\bredis\b", "TensorFlow": r"\btensorflow\b",
    "PyTorch": r"\bpytorch\b", "Machine learning": r"\bmachine[- ]learning\b|\bML\b", "Deep learning": r"\bdeep[- ]learning\b",
    "NLP": r"\bnlp\b", "LLMs": r"\bllms?\b", "Generative AI": r"\bgenerative ai\b|\bgen ?ai\b",
    "Data science": r"\bdata science\b", "Data engineering": r"\bdata engineering\b", "DevOps": r"\bdevops\b",
    "CI/CD": r"\bci/cd\b", "Figma": r"\bfigma\b", "Tailwind CSS": r"\btailwind\b", "WordPress": r"\bwordpress\b",
    "Shopify": r"\bshopify\b", "Flutter": r"\bflutter\b", "iOS": r"\bios\b", "Android": r"\bandroid\b",
    "Blockchain": r"\bblockchain\b|\bweb3\b", "UI/UX": r"\bui/ux\b|\bux design\b", "Distributed systems": r"\bdistributed[- ]systems\b",
    "Microservices": r"\bmicroservices\b", "Linux": r"\blinux\b", "Git": r"\bgit\b(?!hub|lab)",
}
_LANG = {k: re.compile(v, re.I if k not in ("Go", "R", "JavaScript") else 0) for k, v in LANGUAGES.items()}
_LANG["JavaScript"] = re.compile(r"\bjavascript\b|\bJS\b", re.I)
_SKILL = {k: re.compile(v, re.I if k != "Machine learning" else 0) for k, v in SKILLS.items()}
_SKILL["Machine learning"] = re.compile(r"\b[Mm]achine[- ][Ll]earning\b|\bML\b")

STATE_ABBR = "|".join(US_STATES)
LOC_PHRASE = re.compile(r"\b(?i:lives in|living in|based in|based out of|located in|i live in|residing in)\s+"
                        r"(?:the\s+)?([A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*){0,3}"
                        r"(?:,\s*[A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*){0,2})?)")
CITY_STATE = re.compile(rf"\b([A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*){{0,2}}),\s*({STATE_ABBR})\b")
US_BASED = re.compile(r"\b(?:US|USA|U\.S\.)[- ]based\b|\bbased in the (?:US|USA|U\.S\.|United States)\b")
EU_BASED = re.compile(r"\b(?:EU|UK|Europe)[- ]based\b|\bbased in (?:the )?(?:EU|UK|Europe)\b")
_EU_COUNTRY_ALT = "|".join(sorted((re.escape(c) for c in EUROPE_COUNTRIES), key=len, reverse=True))
CITY_COUNTRY = re.compile(rf"\b([A-Z][\w'\-]+(?:\s+[A-Z][\w'\-]+)?),\s*({_EU_COUNTRY_ALT})\b")
YEARS_RE = re.compile(r"\b(\d{1,2})\+?\s*(?:years?|yrs?)\b(?:\s+(?:of\s+)?(?:professional\s+|industry\s+|work\s+|hands-on\s+)?"
                      r"(?:experience|exp\b|in\b)|(?=[^.]{0,40}\bexperience\b))", re.I)
FREELANCE_YES = re.compile(r"\bfor hire\b|\bavailable for (?:freelance|contract|new|remote|part[- ]time|work|projects)|"
                           r"\bopen to (?:work|freelance|contract|new projects)|\bhire me\b|\btaking (?:on )?(?:new )?clients\b|"
                           r"\bfreelanc(?:er|ing)\b", re.I)
FREELANCE_NO = re.compile(r"\bnot (?:available|open) (?:for|to) (?:freelance|contract|work)", re.I)
HIRING_POST = re.compile(r"\[\s*hiring\s*\]|\bwe(?:'re| are) hiring\b|\blooking to hire\b", re.I)
FOR_HIRE_POST = re.compile(r"\[\s*for hire\s*\]|\bfor hire\b|\bhire me\b|\bi(?:'m| am) an? \w+|\bmy (?:name|portfolio|work)\b", re.I)
NAME_WORD = r"[A-Z][a-z]*(?:[-'][A-Z]?[a-z]+)*(?<=[a-z])"
PERSON_NAME = re.compile(rf"^{NAME_WORD}(?:\s+[A-Z]\.)?(?:\s+{NAME_WORD}){{1,2}}$")
NOT_NAMES = {"the", "my", "our", "code", "dev", "tech", "data", "team", "blog", "studio", "labs", "media", "news",
             "daily", "weekly", "guy", "girl", "medium", "quora", "reddit", "writer", "coding", "python", "javascript"}
MY_NAME = re.compile(rf"\bmy name is ({NAME_WORD}(?:\s+{NAME_WORD}){{1,2}})\b")


def looks_like_person_name(s: str | None) -> bool:
    s = (s or "").strip()
    return bool(PERSON_NAME.match(s)) and not any(w.lower() in NOT_NAMES for w in s.split())


def _first(pattern: re.Pattern, text: str) -> re.Match | None:
    return pattern.search(text)


def find_role(text: str) -> tuple[str | None, str | None]:
    """'Senior Engineer at Acme Corp' → ('Senior Engineer', 'Acme Corp')."""
    best = None
    for m in ROLE_RE.finditer(text):
        title = m.group(1).strip()
        comp = COMPANY_RE.match(text[m.end():])
        # stop at a sentence end: "Bolt. Writing about…" → "Bolt" (but keep "Stripe Inc.")
        company = re.split(r"\.\s", comp.group(1))[0].strip(" .,'") if comp else None
        if company and company.lower() in ("a", "an", "the", "home", "night"):
            company = None
        cand = (title, company)
        if company:
            return cand
        if best is None or len(title) > len(best[0]):
            best = cand
    return best or (None, None)


def find_location(text: str) -> tuple[str | None, str | None, str | None, str | None]:
    """→ (location, city, state, verbatim evidence)."""
    for m in LOC_PHRASE.finditer(text):
        loc = re.split(r"\.\s", m.group(1))[0].strip(" .,")  # stop at a sentence end
        if loc:
            city, state = _split_city_state(loc)
            return loc, city, state, m.group(0).strip(" .,")
    m = CITY_STATE.search(text)
    if m:
        return m.group(0), m.group(1), m.group(2), m.group(0)
    m = CITY_COUNTRY.search(text)
    if m:
        return m.group(0), m.group(1), None, m.group(0)
    m = US_BASED.search(text)
    if m:
        return "United States", None, None, m.group(0)
    m = EU_BASED.search(text)
    if m:
        return "Europe", None, None, m.group(0)
    return None, None, None, None


def _split_city_state(loc: str) -> tuple[str | None, str | None]:
    parts = [p.strip() for p in loc.split(",")]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if loc.upper() in US_STATES or loc.title() in US_STATES.values():
        return None, loc
    if region_of(loc) == "EU" and loc not in EUROPE_COUNTRIES:
        return loc, None  # a European city
    return (loc, None) if is_us_location(loc) else (None, None)


def terms(text: str, table: dict[str, re.Pattern]) -> list[str]:
    return [name for name, rx in table.items() if rx.search(text)]


def extract_one(item: dict, source: Literal["quora", "medium", "reddit"]) -> ExtractedPerson:
    text = item["text"]
    url = item.get("url", "")
    name = None
    individual = True
    if source == "quora":
        title_name = text.split("\n")[0].split(" - ")[0].strip()
        if looks_like_person_name(title_name):
            name = title_name
        elif (slug := profile_slug(url)) and looks_like_person_name(name_from_slug(slug)):
            name = name_from_slug(slug)
        individual = "/profile/" in url
    elif source == "medium":
        m = re.search(r"Display name \(from the author's Medium RSS feed\): (.+)", text)
        cand = m.group(1).strip() if m else None
        if not cand:
            m = re.search(r"Author profile page \(search result\):\n(.+?)\s+[–-]\s+Medium", text)
            cand = m.group(1).strip() if m else None
        name = cand if looks_like_person_name(cand) else None
        individual = name is not None
    else:  # reddit: never derive a name from a username; only an explicit "my name is …"
        m = MY_NAME.search(text)
        name = m.group(1) if m else None
        head = text[:300]
        individual = not HIRING_POST.search(head) and bool(FOR_HIRE_POST.search(text))

    title, company = find_role(text)
    location, city, state, evidence = find_location(text)
    region = region_of(location) if evidence else None
    country = region if region in ("US", "EU", "OTHER") else "UNKNOWN"
    if location == "United States":
        country = "US"
    elif location == "Europe":
        country = "EU"
    years = YEARS_RE.search(text)
    freelance = True if FREELANCE_YES.search(text) else (False if FREELANCE_NO.search(text) else None)
    langs = terms(text, _LANG)
    skills = [s for s in terms(text, _SKILL) if s not in langs]

    p = ExtractedPerson(
        index=item["index"], is_individual_person=individual, full_name=name, job_title=title, company=company,
        industry=None, experience=years.group(0) if years else None,
        years_experience=int(years.group(1)) if years else None, skills=skills, programming_languages=langs,
        interests=[], freelance_available=freelance, location=location, city=city, state=state, country=country,
        location_evidence=evidence,
    )
    return ground_extraction(p, f"{text}\n{url}")  # the URL counts too (e.g. a Quora profile slug)


def _list(items: list, fmt) -> str:
    return "\n".join(f"- {fmt(x)}" for x in items) or "- none"


class RuleBasedAI:
    """Same interface as ClaudeService, no API key or cost. Summaries are templates over the stored record."""

    mode = "rules"

    def __init__(self, settings=None):
        self.s = settings

    def extract_people(self, items: list[dict], source: Literal["quora", "medium", "reddit"] = "quora"):
        return [extract_one(i, source) for i in items]

    def summarize(self, record: dict) -> str:
        r = record
        role = " at ".join(x for x in (r.get("job_title"), r.get("company")) if x) or "Role not stated"
        where = ", ".join(x for x in (r.get("city"), r.get("state")) if x) or r.get("location") or REGION_LABEL.get(r.get("country") or "", "location not stated")
        tech = ", ".join((r.get("programming_languages") or []) + (r.get("skills") or [])) or "not stated"
        lines = [f"{r.get('display_name')}: {role}, based in {where}."]
        if r.get("years_experience") is not None:
            lines.append(f"Experience: {r['years_experience']} years (as stated in the source).")
        lines.append(f"Technologies mentioned: {tech}.")
        if r.get("freelance_available"):
            lines.append("Says they are available for freelance or contract work.")
        profiles = [p for p in r.get("profiles", []) if p["match_status"] != "anchor"]
        lines.append("\nProfile matches:")
        lines.append(_list(profiles, lambda p: f"{p['platform']} ({p['match_status'].replace('_', '-')}): {p['url']}. "
                                               + "; ".join(p.get("match_reasons") or [])))
        if r.get("missing_fields") or r.get("conflicts"):
            lines.append("\nMissing or conflicting:")
            lines.append(_list((r.get("conflicts") or []) + (r.get("missing_fields") or []), str))
        lines.append("\n(Free mode: this summary is built from the stored record by rules, not by AI.)")
        return "\n".join(lines)

    def chat(self, messages: list[dict], record: dict | None) -> str:
        if not record:
            return ("Free mode has no AI assistant. Add an Anthropic API key in Settings to ask open questions. "
                    "On a person's page you can still get a rule-based summary.")
        q = (messages[-1]["content"] if messages else "").lower()
        if any(w in q for w in ("missing", "conflict", "gap")):
            items = (record.get("conflicts") or []) + (record.get("missing_fields") or [])
            return "Missing or conflicting information:\n" + _list(items, str)
        if any(w in q for w in ("source", "where", "investigate", "confirm")):
            return ("Public sources this person controls that could confirm details (free mode suggestions):\n"
                    "- Their own website or portfolio (look for an About or Contact page)\n"
                    "- Their GitHub profile (bio, company and website fields)\n"
                    "- A company team page that lists them\n"
                    "Check that each one links back to a profile already listed here before treating it as verified.")
        if any(w in q for w in ("same person", "match", "why", "weak")):
            profiles = [p for p in record.get("profiles", []) if p["match_status"] != "anchor"]
            return "How each linked profile was matched:\n" + _list(
                profiles, lambda p: f"{p['platform']} — {p['match_status'].replace('_', '-')} "
                                    f"({round(p['match_score'] * 100)}%): " + "; ".join(p.get("match_reasons") or []))
        return self.summarize(record)


def use_claude(settings) -> bool:
    """Claude when an Anthropic key is available and free mode isn't forced; otherwise the rule-based mode."""
    if (getattr(settings, "ai_mode", "auto") or "auto").lower() == "off":
        return False
    return bool(getattr(settings, "anthropic_api_key", None) or os.environ.get("ANTHROPIC_API_KEY"))
