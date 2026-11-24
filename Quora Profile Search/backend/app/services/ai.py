"""Claude-powered extraction, summaries and research-assistant chat.

Every extracted field is checked against the source text afterwards
(`ground_extraction`). A value the model produced that isn't supported by the
public text is dropped rather than stored, so AI output is never saved as fact.
"""

import json
import re
from typing import Literal

import anthropic
from pydantic import BaseModel, ConfigDict

from ..config import Settings
from .verify import norm

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ExtractedPerson(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int
    is_individual_person: bool
    full_name: str | None
    job_title: str | None
    company: str | None
    industry: str | None
    experience: str | None
    years_experience: int | None
    skills: list[str]
    programming_languages: list[str]
    interests: list[str]
    freelance_available: bool | None
    location: str | None
    city: str | None
    state: str | None
    country: Literal["US", "EU", "OTHER", "UNKNOWN"]
    location_evidence: str | None


class ExtractionBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    people: list[ExtractedPerson]


COMMON_RULES = """Rules:
- Use ONLY the text provided for each item. Never infer, guess or fill in from general knowledge. If a field is not stated, return null (or an empty list).
- job_title / company: only if stated. Do not guess an employer.
- industry: only if stated or an unambiguous restatement of the stated job/company; otherwise null.
- experience: a short factual phrase from the text (e.g. "10+ years in backend development"); otherwise null.
- years_experience: an integer only if the text states a number of years of professional experience; otherwise null.
- skills: tools, frameworks or specialties explicitly named. programming_languages: programming languages explicitly named (e.g. Python, TypeScript, Go). interests: professional interests explicitly named.
- freelance_available: true only if the person says they are for hire / available for freelance or contract work; false only if they say they are not; otherwise null.
- location, city, state: only as stated. country is a region: "US" when the text places the person in the United States (a US city/state, "USA", "US-based"); "EU" when it places them in Europe (an EU/EEA country, the UK, Switzerland, or another European country except Russia and Turkey, or a European city); "OTHER" when it places them anywhere else; otherwise "UNKNOWN". Working remotely for a company in a region, or having studied there, does NOT establish where someone lives.
- location_evidence: copy the exact words from the text that establish the location, verbatim; null if none.
Return one entry per input item, using its index."""

QUORA_SYSTEM = """You extract professional information about people from public search-engine results for Quora profile pages.
- full_name: the person's name as written in the result.
- Quora credentials often say "Lives in <place>".
- is_individual_person: false for company pages, spaces, topics, or results that aren't a single person's profile.
""" + COMMON_RULES

MEDIUM_SYSTEM = """You extract professional information about Medium authors. Each item combines search-engine results for the author's public Medium profile and articles, plus the display name, recent article titles and tags from the author's public Medium RSS feed.
- full_name: the author's display name, only if it is a person's name (e.g. "Jane Doe"). Return null for publications, companies, brands, or handles/pseudonyms (e.g. "The Code Guy", "devwriter99").
- Professional details come mainly from the profile bio and from what the author says about themselves in article snippets (e.g. "As a senior engineer at Acme..."). Article topics and tags may support skills only when the author clearly writes about using that technology; don't list every tag as a skill.
- is_individual_person: false for publications, company blogs, or results that aren't a single author.
""" + COMMON_RULES

REDDIT_SYSTEM = """You extract professional information from public Reddit posts in which the author describes their own professional background (e.g. [For Hire] posts).
- Extract facts about the AUTHOR only — not about clients, employers they're hiring for, or other people mentioned.
- full_name: only if the author explicitly states their own full name in the text. Never derive a name from a username, email address or URL.
- is_individual_person: false if the post is by a company/agency, is a job offer ([Hiring]), or doesn't describe the author's own professional profile.
""" + COMMON_RULES

_EVIDENCE_FREELANCE = re.compile(r"for hire|freelanc|contract|available for|open to (work|projects)|hire me|taking (on )?(new )?clients", re.I)


def _grounded(value: str | None, source: str) -> bool:
    if not value:
        return False
    words = [w for w in norm(value).split() if len(w) > 1]
    if not words:
        return norm(value) in source
    hits = sum(1 for w in words if re.search(rf"\b{re.escape(w)}\b", source))
    return hits / len(words) >= 0.6


def _grounded_term(term: str, raw_source: str, src: str) -> bool:
    # Handles terms like C++, C#, .NET, Node.js that normalization would mangle
    return term.lower() in raw_source.lower() or _grounded(term, src)


def ground_extraction(p: ExtractedPerson, source_text: str) -> ExtractedPerson:
    """Null out any field whose content is not supported by the source text."""
    src = norm(source_text)
    data = p.model_dump()
    for f in ("full_name", "job_title", "company", "experience", "location", "city", "state"):
        if data[f] and not _grounded(data[f], src):
            data[f] = None
    if data["industry"] and not (_grounded(data["industry"], src) or data["job_title"] or data["company"]):
        data["industry"] = None
    for f in ("skills", "programming_languages", "interests"):
        data[f] = [s for s in data[f] if _grounded_term(s, source_text, src)]
    y = data["years_experience"]
    if y is not None and not re.search(rf"\b{y}\s*\+?\s*(years?|yrs?)\b", source_text, re.I):
        data["years_experience"] = None
    if data["freelance_available"] is True and not _EVIDENCE_FREELANCE.search(source_text):
        data["freelance_available"] = None
    ev = data["location_evidence"]
    if not ev or norm(ev) not in src:
        data["location_evidence"] = None
        data["country"] = "UNKNOWN"  # no verbatim evidence → cannot claim a country
    return ExtractedPerson(**data)


ASSISTANT_SYSTEM = """You are a research assistant inside a professional contact-discovery tool.
You help the user understand publicly available professional information about people located in the United States or Europe.

Rules:
- Base every statement on the record provided (profiles, snippets, match reasons, sources, provenance). If something isn't in the record, say it's not known. Never invent employers, titles, emails or links, and label anything you infer as your interpretation, not fact.
- Keep "verified", "self_reported" and "possible" clearly separate. Explain matches using the listed match reasons and cross-links, and point out weak or conflicting evidence. Two accounts sharing a name is never enough to say they're the same person.
- For Reddit users: treat the account as pseudonymous. Don't try to work out who is behind a Reddit account, and don't suggest searching for a Reddit username elsewhere. Only the links and details the author posted themselves count.
- When asked for missing information or further sources, suggest *types* of public, professional sources the person controls (their own website, GitHub, a portfolio, a company team page they appear on) and what each would confirm. Never suggest people-search or data-broker sites, home addresses, personal phone numbers, or getting around privacy settings or logins.
- For people in Europe, remind the user when relevant that GDPR applies: they need a lawful basis to use the data, must tell the person where their data came from, and must honor objections and deletion requests.
- Don't speculate about sensitive personal attributes (health, religion, politics, sexuality, ethnicity, finances, family).
- Cite the source URL when you state a fact."""


class ClaudeService:
    def __init__(self, settings: Settings):
        self.s = settings
        try:
            self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key \
                else anthropic.Anthropic()
        except anthropic.AnthropicError as e:
            raise RuntimeError("ANTHROPIC_API_KEY is not set. Add it to the .env file and restart.") from e

    def _parse(self, *, system: str, user: str, schema, effort: str = "medium"):
        resp = self.client.beta.messages.parse(
            model=self.s.claude_model,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            output_config={"effort": effort},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError("The model declined this request.")
        return resp.parsed_output

    def _text(self, *, system: str, messages: list[dict], effort: str = "medium") -> str:
        resp = self.client.beta.messages.create(
            model=self.s.claude_model,
            max_tokens=16000,
            system=system,
            messages=messages,
            output_config={"effort": effort},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            return "I can't help with that request."
        return "".join(b.text for b in resp.content if b.type == "text").strip()

    # --- extraction ----------------------------------------------------------
    def extract_people(self, items: list[dict],
                       source: Literal["quora", "medium", "reddit"] = "quora") -> list[ExtractedPerson]:
        """items: [{index, url, text, ...}] → grounded extractions (one per item the model returns)."""
        if not items:
            return []
        out: list[ExtractedPerson] = []
        by_index = {r["index"]: r for r in items}
        for i in range(0, len(items), 10):  # keep batches small so long posts fit comfortably
            chunk = items[i:i + 10]
            batch: ExtractionBatch = self._parse(
                system={"quora": QUORA_SYSTEM, "medium": MEDIUM_SYSTEM, "reddit": REDDIT_SYSTEM}[source],
                user="Items (JSON):\n" + json.dumps(chunk, ensure_ascii=False, indent=1),
                schema=ExtractionBatch,
                effort="low",
            )
            for p in batch.people:
                src = by_index.get(p.index)
                if src:
                    out.append(ground_extraction(p, src["text"]))
        return out

    # --- summaries & assistant ----------------------------------------------
    def summarize(self, record: dict) -> str:
        return self._text(
            system=ASSISTANT_SYSTEM,
            messages=[{"role": "user", "content":
                       "Write a concise professional summary (3-5 sentences) of this person from the record. Then add "
                       "a short 'Profile matches' section explaining for each linked profile why it is verified, "
                       "self-reported or only a possible match, and a 'Missing or conflicting' section.\n\nRecord:\n"
                       + json.dumps(record, ensure_ascii=False, default=str)}],
        )

    def chat(self, messages: list[dict], record: dict | None) -> str:
        system = ASSISTANT_SYSTEM
        if record:
            system += "\n\nCurrent person record:\n" + json.dumps(record, ensure_ascii=False, default=str)
        return self._text(system=system, messages=messages)
