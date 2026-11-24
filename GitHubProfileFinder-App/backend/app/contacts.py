"""Extract contact details, roles and country from what a user published on their GitHub profile.

Only these self-published sources are used:
  - the public email / website / twitter fields of the profile
  - the social accounts the user linked on GitHub
  - the profile bio
  - the profile README (the special <login>/<login> repository)
Telegram is found from t.me / telegram.me links in any of these, and from "Telegram: @handle" text.
Commit metadata and external websites are deliberately NOT used: people who hide their
email on GitHub have chosen not to publish it.
"""

import re
from typing import Optional
from urllib.parse import urlparse

import pycountry

from .models import ContactItem, Contacts, LinkItem, Role

SRC_EMAIL = "GitHub public email"
SRC_WEBSITE = "GitHub website field"
SRC_SOCIAL = "GitHub linked social accounts"
SRC_TWITTER = "GitHub twitter field"
SRC_BIO = "GitHub bio"
SRC_README = "Profile README"
SRC_COMPANY = "GitHub company field"

EMAIL_RE = re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")
MAILTO_RE = re.compile(r"mailto:([^\s)\]>\"'?]+)", re.I)
URL_RE = re.compile(r"https?://[^\s)\]>\"'<`]+", re.I)
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/(?:in|pub)/[A-Za-z0-9_\-%.]+/?", re.I)
# t.me / telegram.me links, with or without "https://", e.g. "t.me/jdoe".
TELEGRAM_URL_RE = re.compile(r"(?<![\w.@/])(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)/([A-Za-z0-9_]{5,32})/?(?![\w/])", re.I)
# A handle written next to the word Telegram, e.g. "Telegram: @jdoe" or "tg - @jdoe".
TELEGRAM_HANDLE_RE = re.compile(r"\b(?:telegram|tg)\b\s*(?:id|username|handle)?\s*[:\-–—=]?\s*@([A-Za-z][A-Za-z0-9_]{4,31})\b", re.I)
PHONE_LABELLED_RE = re.compile(
    r"(?:phone|tel|telephone|mobile|mob|cell|whats\s?app|call(?:\s+me)?)\s*(?:no\.?|number)?\s*[:.\-]?\s*(\+?\(?\d[\d\s().\-]{6,}\d)",
    re.I,
)
PHONE_TEL_RE = re.compile(r"tel:(\+?[\d().\-\s]{7,}\d)", re.I)
PHONE_WA_RE = re.compile(r"wa\.me/(\d{8,15})", re.I)
PHONE_INTL_RE = re.compile(r"(?<![\w/+=.])(\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,5}){2,4})(?![\w/])")

BAD_EMAIL_DOMAINS = ("users.noreply.github.com", "example.com", "example.org", "email.com", "domain.com")
BAD_EMAIL_TLDS = ("png", "jpg", "jpeg", "gif", "svg", "webp", "js", "ts", "css", "md")

KNOWN_PROFILE_SITES = {
    "linkedin.com": "LinkedIn",
    "twitter.com": "Twitter/X",
    "x.com": "Twitter/X",
    "bsky.app": "Bluesky",
    "medium.com": "Medium",
    "dev.to": "DEV",
    "hashnode.dev": "Hashnode",
    "stackoverflow.com": "Stack Overflow",
    "kaggle.com": "Kaggle",
    "orcid.org": "ORCID",
    "scholar.google.com": "Google Scholar",
    "researchgate.net": "ResearchGate",
    "gitlab.com": "GitLab",
    "huggingface.co": "Hugging Face",
    "leetcode.com": "LeetCode",
    "youtube.com": "YouTube",
    "behance.net": "Behance",
    "dribbble.com": "Dribbble",
    "instagram.com": "Instagram",
    "facebook.com": "Facebook",
    "t.me": "Telegram",
    "telegram.me": "Telegram",
    "telegram.dog": "Telegram",
    "npmjs.com": "npm",
    "pypi.org": "PyPI",
    "codepen.io": "CodePen",
    "sketchfab.com": "Sketchfab",
    "calendly.com": "Calendly",
}

SOCIAL_PROVIDER_LABELS = {
    "linkedin": "LinkedIn",
    "twitter": "Twitter/X",
    "mastodon": "Mastodon",
    "bluesky": "Bluesky",
    "youtube": "YouTube",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "npm": "npm",
    "reddit": "Reddit",
    "twitch": "Twitch",
    "hometown": "Hometown",
}


def telegram_url(url: str) -> Optional[str]:
    """Canonical https://t.me/<username> for a link to a Telegram user or channel, else None."""
    m = TELEGRAM_URL_RE.fullmatch(url.strip().rstrip(".,;:!"))
    return f"https://t.me/{m.group(1)}" if m and m.group(1).lower() not in ("joinchat", "share", "addstickers") else None


def extract_telegram(text: str) -> list[str]:
    """Telegram links in free text: t.me links (with or without https://) and "Telegram: @handle"."""
    out: list[str] = []
    for user in TELEGRAM_URL_RE.findall(text) + TELEGRAM_HANDLE_RE.findall(text):
        url = telegram_url(f"t.me/{user}")
        if url and url.lower() not in {u.lower() for u in out}:
            out.append(url)
    return out


def _norm_url(url: str) -> str:
    url = url.strip().rstrip(".,;:!")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    return url


def _url_key(url: str) -> str:
    p = urlparse(_norm_url(url).lower())
    host = p.netloc.removeprefix("www.").removeprefix("mobile.")
    return host + p.path.rstrip("/")


def _site_label(url: str) -> Optional[str]:
    host = urlparse(_norm_url(url)).netloc.lower().removeprefix("www.")
    for domain, label in KNOWN_PROFILE_SITES.items():
        if host == domain or host.endswith("." + domain):
            return label
    return None


def extract_emails(text: str) -> list[str]:
    found = MAILTO_RE.findall(text) + EMAIL_RE.findall(text)
    out = []
    for e in found:
        e = e.strip().strip(".").lower()
        domain = e.rsplit("@", 1)[-1]
        if domain.endswith(BAD_EMAIL_DOMAINS) or domain.rsplit(".", 1)[-1] in BAD_EMAIL_TLDS:
            continue
        if e not in out:
            out.append(e)
    return out


def extract_phones(text: str) -> list[str]:
    candidates = (
        PHONE_LABELLED_RE.findall(text)
        + PHONE_TEL_RE.findall(text)
        + ["+" + p for p in PHONE_WA_RE.findall(text)]
        + PHONE_INTL_RE.findall(text)
    )
    out, seen = [], set()
    for c in candidates:
        c = re.sub(r"\s+", " ", c).strip(" .-")
        digits = re.sub(r"\D", "", c)
        if not 8 <= len(digits) <= 15:
            continue
        # Reject things that look like dates or years ranges (e.g. 2019-2023).
        if re.fullmatch(r"(19|20)\d{2}\D+(19|20)\d{2}", c):
            continue
        if digits not in seen:
            seen.add(digits)
            out.append(c)
    return out


def extract_contacts(user: dict, social_accounts: list[dict], readme: Optional[str]) -> Contacts:
    emails: list[ContactItem] = []
    phones: list[ContactItem] = []
    links: list[LinkItem] = []
    linkedin: Optional[ContactItem] = None
    telegram: Optional[ContactItem] = None
    seen_links: set[str] = set()

    def add_email(value: str, source: str):
        if value.lower() not in {e.value.lower() for e in emails}:
            emails.append(ContactItem(value=value, source=source))

    def add_link(label: str, url: str, source: str):
        nonlocal linkedin, telegram
        url = telegram_url(url) or _norm_url(url)
        key = _url_key(url)
        if key in seen_links:
            return
        if "linkedin.com/" in key and ("/in/" in key or "/pub/" in key):
            if linkedin is None:
                linkedin = ContactItem(value=url, source=source)
                seen_links.add(key)
                return
        if telegram is None and telegram_url(url):
            telegram = ContactItem(value=url, source=source)
            seen_links.add(key)
            return
        seen_links.add(key)
        links.append(LinkItem(label=label, url=url, source=source))

    if user.get("email"):
        add_email(user["email"], SRC_EMAIL)

    website = None
    blog = (user.get("blog") or "").strip()
    if blog:
        website = _norm_url(blog)
        add_link(_site_label(blog) or "Website", blog, SRC_WEBSITE)

    for acc in social_accounts or []:
        url = acc.get("url")
        if url:
            label = SOCIAL_PROVIDER_LABELS.get(acc.get("provider", "")) or _site_label(url) or "Link"
            add_link(label, url, SRC_SOCIAL)

    if user.get("twitter_username"):
        add_link("Twitter/X", f"https://x.com/{user['twitter_username']}", SRC_TWITTER)

    for text, source in ((user.get("bio") or "", SRC_BIO), (readme or "", SRC_README)):
        if not text:
            continue
        for e in extract_emails(text):
            add_email(e, source)
        for p in extract_phones(text):
            if p not in {x.value for x in phones}:
                phones.append(ContactItem(value=p, source=source))
        for m in LINKEDIN_RE.findall(text):
            add_link("LinkedIn", m, source)
        for url in extract_telegram(text):
            add_link("Telegram", url, source)
        for url in URL_RE.findall(text):
            label = _site_label(url)
            if label and "shields.io" not in url:
                add_link(label, url, source)

    return Contacts(emails=emails, phones=phones, linkedin=linkedin, telegram=telegram, website=website, links=links)


# --- Roles -----------------------------------------------------------------

_ROLE_TERMS = [
    "software engineer", "software developer", "software architect", "solutions architect",
    "full stack developer", "full stack engineer", "fullstack developer", "fullstack engineer",
    "frontend developer", "front end developer", "front-end developer", "frontend engineer",
    "backend developer", "back end developer", "back-end developer", "backend engineer",
    "web developer", "mobile developer", "ios developer", "android developer", "game developer",
    "data scientist", "data engineer", "data analyst", "machine learning engineer", "ml engineer",
    "ai engineer", "ai researcher", "devops engineer", "site reliability engineer", "cloud engineer",
    "security engineer", "security researcher", "embedded engineer", "qa engineer", "test engineer",
    "gis developer", "gis analyst", "gis specialist", "gis engineer", "gis consultant",
    "geospatial developer", "geospatial engineer", "geospatial analyst", "remote sensing",
    "bim manager", "bim coordinator", "bim specialist", "bim developer", "bim engineer",
    "computational designer", "architect", "civil engineer", "structural engineer",
    "research scientist", "researcher", "phd student", "phd candidate", "postdoc", "professor",
    "lecturer", "student", "founder", "co-founder", "cto", "ceo", "engineering manager",
    "tech lead", "team lead", "consultant", "freelancer", "ui/ux designer", "ux designer",
    "product designer", "designer", "product manager", "programmer", "developer", "engineer",
]
_GENERIC_ROLES = {"developer", "engineer", "programmer"}
_SENIORITY = r"(?:(?:senior|sr\.?|junior|jr\.?|lead|principal|staff|chief|head of)\s+)?"
_ROLE_RE = re.compile(
    r"\b(" + _SENIORITY + r"(?:" + "|".join(re.escape(t) for t in sorted(_ROLE_TERMS, key=len, reverse=True)) + r"))s?\b",
    re.I,
)
_ACRONYMS = {"cto": "CTO", "ceo": "CEO", "gis": "GIS", "bim": "BIM", "ml": "ML", "ai": "AI", "qa": "QA",
             "ios": "iOS", "ui/ux": "UI/UX", "ux": "UX", "phd": "PhD", "devops": "DevOps", "sr.": "Sr.", "jr.": "Jr."}


def _title(role: str) -> str:
    return " ".join(_ACRONYMS.get(w.lower(), w.capitalize()) for w in role.split())


def extract_roles(bio: Optional[str], readme: Optional[str]) -> list[Role]:
    roles: list[Role] = []
    for text, source in ((bio or "", SRC_BIO), ((readme or "")[:1500], SRC_README)):
        for m in _ROLE_RE.finditer(text):
            title = _title(re.sub(r"\s+", " ", m.group(1)))
            if title.lower() not in {r.title.lower() for r in roles}:
                roles.append(Role(title=title, source=source))
    if any(r.title.lower() not in _GENERIC_ROLES for r in roles):
        roles = [r for r in roles if r.title.lower() not in _GENERIC_ROLES]
    return roles[:5]


# --- Country -----------------------------------------------------------------

_COUNTRY_ALIASES = {
    "usa": "United States", "us": "United States", "u.s.": "United States", "u.s.a.": "United States",
    "united states of america": "United States", "america": "United States",
    "uk": "United Kingdom", "u.k.": "United Kingdom", "england": "United Kingdom", "scotland": "United Kingdom",
    "wales": "United Kingdom", "northern ireland": "United Kingdom", "great britain": "United Kingdom",
    "britain": "United Kingdom", "uae": "United Arab Emirates", "russia": "Russia", "south korea": "South Korea",
    "korea": "South Korea", "north korea": "North Korea", "vietnam": "Vietnam", "iran": "Iran", "syria": "Syria",
    "taiwan": "Taiwan", "czechia": "Czechia", "czech republic": "Czechia", "turkey": "Turkey", "türkiye": "Turkey",
    "holland": "Netherlands", "the netherlands": "Netherlands", "bolivia": "Bolivia", "venezuela": "Venezuela",
    "tanzania": "Tanzania", "moldova": "Moldova", "laos": "Laos", "palestine": "Palestine", "kosovo": "Kosovo",
    "brasil": "Brazil", "deutschland": "Germany", "españa": "Spain", "méxico": "Mexico", "italia": "Italy",
    "россия": "Russia", "中国": "China", "日本": "Japan", "대한민국": "South Korea", "prc": "China",
}
_DISPLAY_OVERRIDES = {
    "Russian Federation": "Russia", "Korea, Republic of": "South Korea", "Viet Nam": "Vietnam",
    "Iran, Islamic Republic of": "Iran", "Taiwan, Province of China": "Taiwan", "Türkiye": "Turkey",
    "Syrian Arab Republic": "Syria", "Bolivia, Plurinational State of": "Bolivia",
    "Venezuela, Bolivarian Republic of": "Venezuela", "Tanzania, United Republic of": "Tanzania",
    "Moldova, Republic of": "Moldova", "Lao People's Democratic Republic": "Laos",
    "Palestine, State of": "Palestine", "Netherlands, Kingdom of the": "Netherlands",
}
_US_STATES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california", "CO": "colorado",
    "CT": "connecticut", "DE": "delaware", "FL": "florida", "GA": "georgia", "HI": "hawaii", "ID": "idaho",
    "IL": "illinois", "IN": "indiana", "IA": "iowa", "KS": "kansas", "KY": "kentucky", "LA": "louisiana",
    "ME": "maine", "MD": "maryland", "MA": "massachusetts", "MI": "michigan", "MN": "minnesota",
    "MS": "mississippi", "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada",
    "NH": "new hampshire", "NJ": "new jersey", "NM": "new mexico", "NY": "new york", "NC": "north carolina",
    "ND": "north dakota", "OH": "ohio", "OK": "oklahoma", "OR": "oregon", "PA": "pennsylvania",
    "RI": "rhode island", "SC": "south carolina", "SD": "south dakota", "TN": "tennessee", "TX": "texas",
    "UT": "utah", "VT": "vermont", "VA": "virginia", "WA": "washington", "WV": "west virginia",
    "WI": "wisconsin", "WY": "wyoming", "DC": "district of columbia",
}
_CA_PROVINCES = {"ontario", "quebec", "québec", "british columbia", "alberta", "manitoba", "saskatchewan",
                 "nova scotia", "new brunswick", "newfoundland", "prince edward island"}
_CITIES = {
    "United States": ["san francisco", "new york city", "nyc", "seattle", "boston", "chicago", "austin",
                      "los angeles", "silicon valley", "bay area", "san jose", "denver", "portland", "atlanta",
                      "miami", "san diego", "philadelphia", "pittsburgh", "washington dc", "brooklyn"],
    "United Kingdom": ["london", "manchester", "edinburgh", "cambridge", "oxford", "bristol", "glasgow", "leeds"],
    "Germany": ["berlin", "munich", "münchen", "hamburg", "frankfurt", "cologne", "köln", "stuttgart", "dresden"],
    "France": ["paris", "lyon", "toulouse", "marseille", "grenoble", "nantes"],
    "India": ["bangalore", "bengaluru", "mumbai", "delhi", "new delhi", "hyderabad", "chennai", "pune",
              "kolkata", "noida", "gurgaon", "gurugram", "ahmedabad", "jaipur", "kochi"],
    "China": ["beijing", "shanghai", "shenzhen", "hangzhou", "guangzhou", "chengdu", "wuhan", "nanjing"],
    "Japan": ["tokyo", "osaka", "kyoto", "yokohama", "fukuoka"],
    "South Korea": ["seoul", "busan"],
    "Canada": ["toronto", "vancouver", "montreal", "montréal", "ottawa", "calgary", "waterloo"],
    "Australia": ["sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra"],
    "Netherlands": ["amsterdam", "rotterdam", "utrecht", "delft", "eindhoven", "the hague"],
    "Sweden": ["stockholm", "gothenburg", "malmö"], "Norway": ["oslo"], "Denmark": ["copenhagen"],
    "Finland": ["helsinki"], "Spain": ["madrid", "barcelona", "valencia", "seville"], "Portugal": ["lisbon", "porto"],
    "Italy": ["rome", "milan", "turin", "bologna"], "Switzerland": ["zurich", "zürich", "geneva", "lausanne", "bern"],
    "Austria": ["vienna", "wien"], "Poland": ["warsaw", "krakow", "kraków", "wroclaw", "wrocław"],
    "Czechia": ["prague", "brno"], "Hungary": ["budapest"], "Romania": ["bucharest", "cluj-napoca"],
    "Ukraine": ["kyiv", "kiev", "kharkiv", "lviv", "odesa"], "Russia": ["moscow", "saint petersburg", "st. petersburg"],
    "Belarus": ["minsk"], "Turkey": ["istanbul", "ankara", "izmir"], "Greece": ["athens"], "Ireland": ["dublin"],
    "Belgium": ["brussels", "antwerp", "ghent"], "Israel": ["tel aviv", "jerusalem", "haifa"],
    "United Arab Emirates": ["dubai", "abu dhabi"], "Saudi Arabia": ["riyadh", "jeddah"], "Egypt": ["cairo"],
    "Nigeria": ["lagos", "abuja"], "Kenya": ["nairobi"], "South Africa": ["cape town", "johannesburg"],
    "Singapore": ["singapore"], "Hong Kong": ["hong kong"], "Taiwan": ["taipei"], "Indonesia": ["jakarta", "bandung"],
    "Philippines": ["manila"], "Thailand": ["bangkok"], "Vietnam": ["hanoi", "ho chi minh city", "saigon"],
    "Malaysia": ["kuala lumpur"], "Pakistan": ["karachi", "lahore", "islamabad"], "Bangladesh": ["dhaka"],
    "Nepal": ["kathmandu"], "Sri Lanka": ["colombo"], "Iran": ["tehran"], "Georgia": ["tbilisi"],
    "Armenia": ["yerevan"], "Kazakhstan": ["almaty", "astana"], "Brazil": ["são paulo", "sao paulo", "rio de janeiro",
    "belo horizonte", "porto alegre", "curitiba"], "Argentina": ["buenos aires"], "Mexico": ["mexico city", "guadalajara"],
    "Colombia": ["bogota", "bogotá", "medellin", "medellín"], "Peru": ["lima"], "Chile": ["santiago"],
    "New Zealand": ["auckland", "wellington"],
}


def _build_country_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for c in pycountry.countries:
        display = getattr(c, "common_name", None) or c.name
        display = _DISPLAY_OVERRIDES.get(display, display)
        for n in (c.name, getattr(c, "official_name", None), getattr(c, "common_name", None)):
            if n:
                lookup[n.lower()] = display
    lookup.update(_COUNTRY_ALIASES)
    for state in _US_STATES.values():
        lookup.setdefault(state, "United States")
    for prov in _CA_PROVINCES:
        lookup.setdefault(prov, "Canada")
    for country, cities in _CITIES.items():
        for city in cities:
            lookup.setdefault(city, country)
    # "Georgia" alone is ambiguous; prefer the country, US state is caught via ", GA".
    lookup["georgia"] = "Georgia"
    return lookup


_LOOKUP = _build_country_lookup()


def extract_country(location: Optional[str]) -> Optional[str]:
    if not location:
        return None
    parts = [p.strip() for p in re.split(r"[,/|;·•()\-–]| - ", location) if p.strip()]
    for part in reversed(parts):
        if part in _US_STATES:  # uppercase two-letter state code, e.g. "Austin, TX"
            return "United States"
        key = part.lower().strip(". ")
        if key in _LOOKUP:
            return _LOOKUP[key]
    whole = location.lower()
    for key in sorted(_LOOKUP, key=len, reverse=True):
        if len(key) > 3 and re.search(r"(?<!\w)" + re.escape(key) + r"(?!\w)", whole):
            return _LOOKUP[key]
    return None
