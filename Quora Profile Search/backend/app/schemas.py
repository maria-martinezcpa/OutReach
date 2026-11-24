from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

QueryType = Literal["name", "profession", "skills", "company", "url", "keywords"]
Source = Literal["quora", "medium", "reddit"]
Region = Literal["US", "EU"]


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    query_type: QueryType = "profession"
    sources: list[Source] = ["quora", "medium", "reddit"]
    company: str | None = None
    profession: str | None = None
    skills: list[str] = []
    regions: list[Region] = Field(default=["US", "EU"], description="US = United States, EU = Europe")
    require_contact: bool = Field(default=True, description="Only keep people with a self-linked GitHub or a published email")
    state: str | None = Field(default=None, description="Optional state, country or city to narrow results")
    subreddits: list[str] = Field(default=[], description="Reddit communities to search; defaults are hiring/for-hire subs")
    max_candidates: int | None = Field(default=None, ge=1, le=50)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProfileOut(ORM):
    id: int
    platform: str
    url: str
    title: str | None
    snippet: str | None
    match_status: str
    match_score: float
    match_reasons: list
    source_url: str | None
    discovered_at: datetime


class ContactOut(ORM):
    id: int
    kind: str
    value: str
    is_business: bool
    source_url: str
    evidence: str | None
    verification_status: str
    provenance: str
    discovered_at: datetime


class PersonBase(ORM):
    id: int
    display_name: str
    source_platform: str
    full_name: str | None
    reddit_username: str | None
    job_title: str | None
    company: str | None
    industry: str | None
    years_experience: int | None
    skills: list
    programming_languages: list
    freelance_available: bool | None
    location: str | None
    city: str | None
    state: str | None
    country: str | None
    confidence: float
    category: str | None
    tags: list
    updated_at: datetime


class PersonSummary(PersonBase):
    profile_count: int = 0
    verified_count: int = 0
    contact_count: int = 0


class PersonDetail(PersonBase):
    experience: str | None
    interests: list
    location_evidence: str | None
    missing_fields: list
    conflicts: list
    notes: str | None
    edited_fields: list
    ai_summary: str | None
    created_at: datetime
    profiles: list[ProfileOut]
    contacts: list[ContactOut]


class PersonUpdate(BaseModel):
    """User edits. Edited fields are recorded so they're never shown as 'discovered'."""

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = None
    job_title: str | None = None
    company: str | None = None
    industry: str | None = None
    experience: str | None = None
    years_experience: int | None = Field(default=None, ge=0, le=70)
    skills: list[str] | None = None
    programming_languages: list[str] | None = None
    interests: list[str] | None = None
    freelance_available: bool | None = None
    city: str | None = None
    state: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    notes: str | None = None


class SearchOut(ORM):
    id: int
    query: str
    query_type: str
    sources: list
    filters: dict
    status: str
    message: str | None
    candidates_found: int
    excluded_non_us: int
    excluded_no_contact: int | None = 0
    result_count: int
    created_at: datetime
    finished_at: datetime | None


class SearchWithResults(SearchOut):
    people: list[PersonSummary] = []


class DuplicateGroup(BaseModel):
    reason: str
    people: list[PersonSummary]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AssistantRequest(BaseModel):
    person_id: int | None = None
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class AssistantReply(BaseModel):
    reply: str
