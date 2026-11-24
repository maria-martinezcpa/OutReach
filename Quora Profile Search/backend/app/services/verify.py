"""Decide whether a discovered profile belongs to the same person as the Quora anchor.

Status levels:
- "verified": an explicit, checkable cross-link ties the profile to the cluster
  (e.g. the person's website links to their GitHub, or GitHub's "blog" field is the website).
- "possible": similar identity signals (name, company, title, US location) but no cross-link.
- None: too weak — discarded, never stored.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import urlparse

from .regions import REGION_LABEL, region_of

POSSIBLE_THRESHOLD = 0.5


@dataclass
class Identity:
    full_name: str
    company: str | None = None
    job_title: str | None = None
    location: str | None = None
    region: str | None = None  # "US" / "EU"


@dataclass
class Candidate:
    platform: str
    url: str
    text: str  # title + snippet / bio / page text available for this profile
    name: str | None = None
    company: str | None = None
    location: str | None = None
    outbound_links: list[str] = field(default_factory=list)


@dataclass
class MatchResult:
    status: str | None
    score: float
    reasons: list[str]


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower()).strip()


def url_key(url: str) -> str:
    p = urlparse(url if "://" in url else "https://" + url)
    host = (p.hostname or "").lower().removeprefix("www.")
    path = p.path.rstrip("/").lower()
    return host + path


def links_to(candidate_links: list[str], target_url: str) -> bool:
    t = url_key(target_url)
    t_host = t.split("/")[0]
    for link in candidate_links:
        k = url_key(link)
        # exact profile match, or a homepage link for personal sites (host-only target)
        if k == t or (("/" not in t) and k.split("/")[0] == t_host):
            return True
    return False


def name_score(identity: Identity, cand: Candidate) -> tuple[float, str | None]:
    target = norm(identity.full_name)
    tokens = target.split()
    if not tokens:
        return 0.0, None
    hay = norm(cand.name) if cand.name else norm(cand.text)
    if cand.name and norm(cand.name) == target:
        return 0.45, f"Exact name match on profile ('{cand.name}')"
    if re.search(rf"\b{re.escape(target)}\b", hay):
        return 0.4, f"Full name '{identity.full_name}' appears on profile"
    if len(tokens) >= 2 and all(re.search(rf"\b{re.escape(t)}\b", hay) for t in (tokens[0], tokens[-1])):
        return 0.3, "First and last name appear on profile"
    return 0.0, None


def score_candidate(identity: Identity, cand: Candidate, cluster_urls: list[str],
                    cluster_outbound: list[str] | None = None) -> MatchResult:
    """cluster_urls: URLs already known to be this person (Quora anchor + verified profiles).
    cluster_outbound: links published *on* those profiles (e.g. a website named in the Quora credential)."""
    reasons: list[str] = []
    ns, why = name_score(identity, cand)
    if ns == 0:
        return MatchResult(None, 0.0, ["Name does not match"])
    score = ns
    reasons.append(why)  # type: ignore[arg-type]

    hay = norm(" ".join(filter(None, [cand.text, cand.company])))
    if identity.company and len(norm(identity.company)) > 2 and norm(identity.company) in hay:
        score += 0.25
        reasons.append(f"Same company: {identity.company}")
    if identity.job_title:
        words = {w for w in norm(identity.job_title).split() if len(w) > 3}
        overlap = words & set(hay.split())
        if overlap:
            score += min(0.15, 0.05 * len(overlap))
            reasons.append(f"Similar role keywords: {', '.join(sorted(overlap))}")

    region = region_of(cand.location)
    same_region = region is not None and (identity.region is None or region == identity.region)
    if region is not None and same_region:
        score += 0.1
        reasons.append(f"Location on profile matches the region: {cand.location}")
    elif region is not None:
        score -= 0.4
        where = REGION_LABEL.get(identity.region or "", "the person's region")
        reasons.append(f"Profile location is outside {where}: {cand.location}")

    verified = False
    for target in cluster_urls:
        if links_to(cand.outbound_links, target):
            verified = True
            reasons.append(f"Profile links directly to {target}")
            break
    if not verified and cluster_outbound and links_to(cluster_outbound, cand.url):
        verified = True
        reasons.append("A confirmed profile of this person links to this URL")

    score = round(max(0.0, min(1.0, score + (0.3 if verified else 0))), 2)
    if verified and ns >= 0.3 and (region is None or same_region):
        return MatchResult("verified", score, reasons)
    if score >= POSSIBLE_THRESHOLD:
        return MatchResult("possible", score, reasons)
    return MatchResult(None, score, reasons)
