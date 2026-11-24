"""Confidence score, missing-information and conflict bookkeeping for a person record."""

from ..models import Person
from .verify import norm

CONTACT_PLATFORMS = {"linkedin", "github", "website", "portfolio", "social"}


def compute_missing(p: Person) -> list[str]:
    missing = []
    if not p.full_name:
        missing.append("Full name (not publicly disclosed)" if p.source_platform == "reddit" else "Full name")
    for field, label in (("job_title", "Professional title"), ("company", "Company / employer"),
                         ("years_experience", "Years of experience"), ("city", "City")):
        if getattr(p, field) in (None, ""):
            missing.append(label)
    if not (p.skills or p.programming_languages):
        missing.append("Technical skills / programming languages")
    if not p.contacts:
        missing.append("Publicly published email")
    if not any(x.match_status == "verified" for x in p.profiles):
        missing.append("Independently verified profile link")
    return missing


def compute_confidence(p: Person) -> float:
    """0..1 — how well-supported this record is by traceable public sources."""
    score = 0.2  # we have the original public source (Quora profile / Reddit post)
    if p.location_evidence:
        score += 0.15
    if p.job_title or p.company:
        score += 0.15
    verified = sum(1 for x in p.profiles if x.match_status == "verified")
    self_rep = sum(1 for x in p.profiles if x.match_status == "self_reported")
    score += min(0.3, 0.15 * verified) + min(0.1, 0.05 * self_rep)
    if any(c.verification_status == "verified" for c in p.contacts):
        score += 0.1
    score -= 0.1 * len(p.conflicts or [])
    return round(max(0.0, min(1.0, score)), 2)


def company_conflict(person_company: str | None, other_company: str | None, where: str) -> str | None:
    a, b = norm(person_company), norm((other_company or "").lstrip("@"))
    if a and b and a not in b and b not in a:
        return f"Company differs: record says '{person_company}', {where} says '{other_company}'"
    return None


def refresh_quality(p: Person) -> None:
    p.missing_fields = compute_missing(p)
    p.confidence = compute_confidence(p)
