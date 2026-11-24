from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .regions import extract_region

HumanConfidence = Literal["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"]
ActivityStatus = Literal["ACTIVE", "MODERATE", "INACTIVE", "UNKNOWN"]


class ContactItem(BaseModel):
    value: str
    source: str


class LinkItem(BaseModel):
    label: str
    url: str
    source: str


class Role(BaseModel):
    title: str
    source: str


class Contacts(BaseModel):
    emails: list[ContactItem] = []
    phones: list[ContactItem] = []
    linkedin: Optional[ContactItem] = None
    telegram: Optional[ContactItem] = None
    website: Optional[str] = None
    links: list[LinkItem] = []

    @model_validator(mode="after")
    def _telegram_from_links(self):
        """Profiles stored before Telegram had its own field keep it among the links; move it out."""
        if self.telegram is None:
            from .contacts import telegram_url
            for i, link in enumerate(self.links):
                url = telegram_url(link.url)
                if url:
                    self.telegram = ContactItem(value=url, source=link.source)
                    del self.links[i]
                    break
        return self


class RepoSummary(BaseModel):
    id: int
    name: str
    url: str
    description: Optional[str] = None
    language: Optional[str] = None
    stars: int = 0
    forks: int = 0
    topics: list[str] = []
    fork: bool = False
    created_at: Optional[str] = None
    pushed_at: Optional[str] = None


class Skill(BaseModel):
    name: str
    confidence: float = Field(ge=0, le=1)
    level: Literal["HIGH", "MEDIUM", "LOW"]
    evidence_repos: list[str] = []
    sources: list[str] = []
    basis: str = "Detected from public activity (not verified expertise)"


class Signal(BaseModel):
    signal: str
    observation: str
    effect: Literal["supports", "against", "neutral"]


class Analysis(BaseModel):
    human_confidence: HumanConfidence
    activity_status: ActivityStatus
    last_push: Optional[str] = None
    skills: list[Skill] = []
    evidence: list[Signal] = []
    limitations: list[str] = []
    method: str


class PeriodRepo(BaseModel):
    name: str
    commits: int


class PeriodActivity(BaseModel):
    since: Optional[date] = None
    until: Optional[date] = None
    commits: int = 0
    commits_capped: bool = False
    repos: list[PeriodRepo] = []
    checked_repos: int = 0
    last_commit_at: Optional[str] = None
    source: str = "Commits in the user's own repositories"


class Profile(BaseModel):
    id: int
    login: str
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    github_url: str
    bio: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None  # e.g. "Western Europe"; from the location text or calculated from the country
    continent: Optional[str] = None
    hireable: Optional[bool] = None
    type: str = "User"
    roles: list[Role] = []
    contacts: Contacts
    followers: int = 0
    following: int = 0
    public_repos: int = 0
    created_at: Optional[str] = None
    languages: list[str] = []
    repositories: list[RepoSummary] = []
    analysis: Analysis
    fetched_at: str
    period_activity: Optional[PeriodActivity] = None
    matched_keywords: list[str] = []  # which of the searched keywords this person matched
    saved: bool = False

    @model_validator(mode="after")
    def fill_region(self):
        # Also fills profiles cached or saved before regions existed.
        if not self.region and not self.continent:
            self.region, self.continent = extract_region(self.location, self.country)
        return self


class Account(Profile):
    """A person found by one or more background searches."""
    found_in: list[str] = []  # names of the searches that found them, newest first


class SearchResponse(BaseModel):
    items: list[Profile]
    page: int
    per_page: int
    total_candidates: int
    checked: int
    filtered_out: int
    failed: list[str] = []
    query: str
    has_more: bool
    warning: Optional[str] = None
    page_complete: bool = True


OutreachStatus = Literal["", "to_contact", "drafted", "contacted", "replied", "not_interested"]


class SavedEntry(BaseModel):
    login: str
    saved_at: str
    note: str = ""
    # One-to-one outreach tracking; nothing is sent automatically.
    status: OutreachStatus = ""
    follow_up: Optional[date] = None
    updated_at: Optional[str] = None
    profile: Profile


class SaveRequest(BaseModel):
    note: str = ""


class SavedUpdate(BaseModel):
    """Only the fields that are sent are changed; send follow_up=null to clear it."""
    note: Optional[str] = Field(None, max_length=5000)
    status: Optional[OutreachStatus] = None
    follow_up: Optional[date] = None
