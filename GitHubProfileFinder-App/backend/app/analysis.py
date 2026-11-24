"""Rule-based, explainable analysis of public GitHub activity.

Nothing here verifies identity or expertise: skills are *detected from public activity*,
and the human-account confidence is a heuristic with the evidence shown alongside it.
"""

import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Optional

from .models import Analysis, Contacts, Signal, Skill

METHOD = "Rule-based heuristic over public GitHub data (automated assessment, not identity verification)"

LIMITATIONS = [
    "Public GitHub data cannot establish a person's real-world identity.",
    "The confidence level is not proof that the account belongs to a particular person.",
    "Skills are detected from public repositories and profile text; they are not verified professional expertise.",
    "Private repositories and contributions to other organisations' private code are not visible.",
]

SKILL_KEYWORDS: dict[str, list[str]] = {
    "GIS": [r"\bgis\b", r"geospatial", r"\bgdal\b", r"shapefile", r"geojson", r"\bgeopandas\b", r"cartograph"],
    "PostGIS": [r"postgis"],
    "QGIS": [r"\bqgis\b"],
    "ArcGIS": [r"arcgis", r"arcpy"],
    "Remote Sensing": [r"remote[- ]sensing", r"sentinel[- ]?2", r"landsat", r"satellite imagery"],
    "CesiumJS": [r"cesium"],
    "Leaflet": [r"leaflet"],
    "Mapbox": [r"mapbox"],
    "OpenLayers": [r"openlayers"],
    "BIM": [r"\bbim\b", r"\bifc\b", r"ifcopenshell", r"building information model"],
    "Revit": [r"revit"],
    "Dynamo": [r"\bdynamo\b"],
    "CAD": [r"\bcad\b", r"autocad", r"freecad", r"\bdwg\b", r"\bdxf\b"],
    "Digital Twin": [r"digital[- ]twin"],
    "Three.js": [r"three\.?js"],
    "React": [r"\breact\b", r"\bnext\.?js\b", r"\bnextjs\b"],
    "Vue": [r"\bvue\b", r"\bnuxt"],
    "Angular": [r"\bangular\b"],
    "Svelte": [r"svelte"],
    "Node.js": [r"\bnode\.?js\b", r"\bexpress\b", r"\bnestjs\b"],
    "Django": [r"django"],
    "FastAPI": [r"fastapi"],
    "Flask": [r"\bflask\b"],
    "Spring": [r"spring[- ]?boot"],
    ".NET": [r"\.net\b", r"asp\.net", r"dotnet"],
    "Docker": [r"docker"],
    "Kubernetes": [r"kubernetes", r"\bk8s\b", r"\bhelm\b"],
    "Terraform": [r"terraform"],
    "AWS": [r"\baws\b", r"amazon web services"],
    "Azure": [r"\bazure\b"],
    "GCP": [r"\bgcp\b", r"google cloud"],
    "Machine Learning": [r"machine[- ]learning", r"scikit", r"sklearn", r"xgboost"],
    "Deep Learning": [r"deep[- ]learning", r"pytorch", r"tensorflow", r"keras", r"neural[- ]net"],
    "LLM / GenAI": [r"\bllms?\b", r"langchain", r"\bgpt\b", r"\brag\b", r"openai", r"anthropic", r"\bclaude\b"],
    "Computer Vision": [r"computer[- ]vision", r"opencv", r"\byolo"],
    "Data Engineering": [r"\betl\b", r"airflow", r"\bspark\b", r"\bdbt\b", r"kafka"],
    "PostgreSQL": [r"postgres"],
    "MongoDB": [r"mongo"],
    "Blockchain": [r"blockchain", r"solidity", r"web3", r"ethereum"],
    "Unity": [r"\bunity3?d?\b"],
    "Full Stack": [r"full[- ]?stack"],
}
_COMPILED = {k: [re.compile(p, re.I) for p in v] for k, v in SKILL_KEYWORDS.items()}


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _repo_text(repo: dict) -> str:
    name = re.sub(r"[-_.]", " ", repo.get("name") or "")
    return " ".join([name, repo.get("description") or "", " ".join(repo.get("topics") or [])])


def _level(conf: float) -> str:
    return "HIGH" if conf >= 0.75 else "MEDIUM" if conf >= 0.5 else "LOW"


def detect_skills(repos: list[dict], bio: Optional[str], now: datetime) -> list[Skill]:
    support: dict[str, list[dict]] = defaultdict(list)
    sources: dict[str, set[str]] = defaultdict(set)

    for repo in repos:
        lang = repo.get("language")
        if lang:
            support[lang].append(repo)
            sources[lang].add("Repository primary language")
        text = _repo_text(repo)
        for skill, patterns in _COMPILED.items():
            if any(p.search(text) for p in patterns) and repo not in support[skill]:
                support[skill].append(repo)
                sources[skill].add("Repository name/description/topics")

    bio_mentions = {s for s, pats in _COMPILED.items() if bio and any(p.search(bio) for p in pats)}
    for s in bio_mentions:
        sources[s].add("GitHub bio")

    skills = []
    for name in set(support) | bio_mentions:
        rs = support.get(name, [])
        weight = sum(0.5 if r.get("fork") else 1.0 for r in rs)
        conf = 0.25 + 0.15 * min(weight, 4)
        if any((p := _parse(r.get("pushed_at"))) and (now - p).days <= 365 for r in rs if not r.get("fork")):
            conf += 0.1
        if name in bio_mentions:
            conf += 0.1
        conf = round(min(conf, 0.95), 2)
        evidence = [r["name"] for r in sorted(rs, key=lambda r: r.get("stargazers_count", 0), reverse=True)][:5]
        skills.append(Skill(name=name, confidence=conf, level=_level(conf), evidence_repos=evidence,
                            sources=sorted(sources[name])))
    skills.sort(key=lambda s: (s.confidence, len(s.evidence_repos)), reverse=True)
    return skills[:15]


def activity_status(repos: list[dict], now: datetime) -> tuple[str, Optional[str]]:
    pushes = [p for r in repos if (p := _parse(r.get("pushed_at")))]
    if not pushes:
        return "UNKNOWN", None
    last = max(pushes)
    days = (now - last).days
    status = "ACTIVE" if days <= 90 else "MODERATE" if days <= 365 else "INACTIVE"
    return status, last.isoformat()


def human_confidence(user: dict, repos: list[dict], contacts: Contacts, now: datetime) -> tuple[str, list[Signal]]:
    signals: list[Signal] = []
    points = 0
    login = user.get("login", "")

    if user.get("type") == "Bot" or login.lower().endswith("[bot]") or re.search(r"(^|[-_])bot$", login, re.I):
        signals.append(Signal(signal="Account type", observation="Account is marked or named as a bot", effect="against"))
        return "LOW", signals

    created = _parse(user.get("created_at"))
    if created:
        years = (now - created).days / 365.25
        obs = f"Account created {created.date().isoformat()} ({years:.1f} years ago)"
        if years >= 3:
            points += 2
            signals.append(Signal(signal="Account age", observation=obs, effect="supports"))
        elif years >= 1:
            points += 1
            signals.append(Signal(signal="Account age", observation=obs, effect="supports"))
        elif years < 0.25:
            points -= 1
            signals.append(Signal(signal="Account age", observation=obs, effect="against"))
        else:
            signals.append(Signal(signal="Account age", observation=obs, effect="neutral"))

    own = [r for r in repos if not r.get("fork")]
    if len(own) >= 5:
        points += 2
        signals.append(Signal(signal="Repositories", observation=f"{len(own)} original public repositories", effect="supports"))
    elif own:
        points += 1
        signals.append(Signal(signal="Repositories", observation=f"{len(own)} original public repositories", effect="supports"))
    else:
        signals.append(Signal(signal="Repositories", observation="No original public repositories", effect="neutral"))

    months = {d.strftime("%Y-%m") for r in own for k in ("created_at", "pushed_at") if (d := _parse(r.get(k)))}
    if len(months) >= 6:
        points += 2
        signals.append(Signal(signal="Development consistency",
                              observation=f"Repository activity spread over {len(months)} distinct months", effect="supports"))
    elif len(months) >= 3:
        points += 1
        signals.append(Signal(signal="Development consistency",
                              observation=f"Repository activity spread over {len(months)} distinct months", effect="supports"))

    langs = {r["language"] for r in own if r.get("language")}
    if len(langs) >= 3:
        points += 1
        signals.append(Signal(signal="Repository diversity",
                              observation=f"{len(langs)} programming languages across projects", effect="supports"))

    fields = [f for f in ("name", "bio", "location", "company", "blog", "email") if user.get(f)]
    if len(fields) >= 4:
        points += 2
        signals.append(Signal(signal="Profile completeness", observation=f"Profile lists {', '.join(fields)}", effect="supports"))
    elif len(fields) >= 2:
        points += 1
        signals.append(Signal(signal="Profile completeness", observation=f"Profile lists {', '.join(fields)}", effect="supports"))
    else:
        signals.append(Signal(signal="Profile completeness", observation="Profile is mostly empty", effect="neutral"))

    if contacts.linkedin or contacts.links:
        points += 1
        n = len(contacts.links) + (1 if contacts.linkedin else 0)
        signals.append(Signal(signal="Public professional links", observation=f"{n} self-published external profile link(s)",
                              effect="supports"))

    followers, following = user.get("followers", 0), user.get("following", 0)
    if following > 1000 and following > 20 * max(followers, 1):
        points -= 2
        signals.append(Signal(signal="Follow pattern",
                              observation=f"Follows {following} accounts but has {followers} followers (mass-follow pattern)",
                              effect="against"))
    elif followers >= 10:
        points += 1
        signals.append(Signal(signal="Followers", observation=f"{followers} followers", effect="supports"))

    if len(own) >= 10:
        day, count = Counter(r["created_at"][:10] for r in own if r.get("created_at")).most_common(1)[0]
        if count / len(own) > 0.5:
            points -= 1
            signals.append(Signal(signal="Automated-looking activity",
                                  observation=f"{count} of {len(own)} repositories created on {day}", effect="against"))

    if not own and len(fields) < 2:
        return "INSUFFICIENT_DATA", signals
    level = "HIGH" if points >= 7 else "MEDIUM" if points >= 4 else "LOW"
    return level, signals


def analyze(user: dict, repos: list[dict], contacts: Contacts, now: Optional[datetime] = None) -> Analysis:
    now = now or datetime.now(timezone.utc)
    status, last_push = activity_status(repos, now)
    level, signals = human_confidence(user, repos, contacts, now)
    return Analysis(
        human_confidence=level,
        activity_status=status,
        last_push=last_push,
        skills=detect_skills(repos, user.get("bio"), now),
        evidence=signals,
        limitations=LIMITATIONS,
        method=METHOD,
    )
