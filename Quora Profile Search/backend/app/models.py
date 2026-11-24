from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SearchQuery(Base):
    __tablename__ = "search_queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    query_type: Mapped[str] = mapped_column(String(32))  # name | profession | skills | company | url | keywords
    sources: Mapped[list] = mapped_column(JSON, default=list)  # ["quora", "reddit"]
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending|running|done|failed
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    candidates_found: Mapped[int] = mapped_column(Integer, default=0)
    excluded_non_us: Mapped[int] = mapped_column(Integer, default=0)  # outside the selected regions
    excluded_no_contact: Mapped[int | None] = mapped_column(Integer, default=0, nullable=True)
    result_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    results: Mapped[list["SearchResult"]] = relationship(back_populates="search", cascade="all, delete-orphan")


class Person(Base):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_platform: Mapped[str] = mapped_column(String(16), default="quora")  # quora | medium | reddit
    full_name: Mapped[str | None] = mapped_column(String(200), index=True, nullable=True)  # only if self-disclosed
    reddit_username: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    alias: Mapped[str | None] = mapped_column(String(200), nullable=True)  # label when no name/username is known
    job_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    company: Mapped[str | None] = mapped_column(String(300), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(200), nullable=True)
    experience: Mapped[str | None] = mapped_column(Text, nullable=True)
    years_experience: Mapped[int | None] = mapped_column(Integer, nullable=True)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    programming_languages: Mapped[list] = mapped_column(JSON, default=list)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    freelance_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)  # region: "US" or "EU"
    location_evidence: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Quality & verification (computed by services.quality)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    missing_fields: Mapped[list] = mapped_column(JSON, default=list)
    conflicts: Mapped[list] = mapped_column(JSON, default=list)

    # Organization (user-managed)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    edited_fields: Mapped[list] = mapped_column(JSON, default=list)  # fields changed by a user, not discovered

    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    profiles: Mapped[list["Profile"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    contacts: Mapped[list["Contact"]] = relationship(back_populates="person", cascade="all, delete-orphan")

    @property
    def display_name(self) -> str:
        if self.full_name:
            return self.full_name
        if self.reddit_username:
            return f"u/{self.reddit_username}"
        return self.alias or "Unknown"


class Profile(Base):
    """A public profile URL tied to the person.

    match_status:
      anchor        – the Quora profile / Reddit post where the person was discovered
      verified      – an explicit, checkable cross-link confirms it (e.g. a reciprocal link)
      self_reported – the person posted this link themselves, but it doesn't link back
      possible      – similar details only (name/company/role); NOT confirmed. Never used for Reddit.
    """

    __tablename__ = "profiles"
    __table_args__ = (UniqueConstraint("person_id", "url", name="uq_profile_person_url"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(32))  # quora|reddit|linkedin|github|website|portfolio|social
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_status: Mapped[str] = mapped_column(String(16), default="possible")
    match_score: Mapped[float] = mapped_column(Float, default=0.0)
    match_reasons: Mapped[list] = mapped_column(JSON, default=list)
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # e.g. Reddit post fullname t3_xxx
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    person: Mapped[Person] = relationship(back_populates="profiles")


class Contact(Base):
    """Contact details the person intentionally published. Always carries its public source."""

    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("person_id", "value", name="uq_contact_person_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="email")
    value: Mapped[str] = mapped_column(String(320))
    is_business: Mapped[bool] = mapped_column(default=True)
    source_url: Mapped[str] = mapped_column(String(1000))
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_status: Mapped[str] = mapped_column(String(16), default="possible")  # verified|possible
    provenance: Mapped[str] = mapped_column(String(24), default="self_reported")  # self_reported|independently_verified
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    person: Mapped[Person] = relationship(back_populates="contacts")


class SearchResult(Base):
    __tablename__ = "search_results"
    __table_args__ = (UniqueConstraint("search_id", "person_id", name="uq_search_person"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    search_id: Mapped[int] = mapped_column(ForeignKey("search_queries.id", ondelete="CASCADE"), index=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), index=True)
    relevance: Mapped[float] = mapped_column(Float, default=0.0)

    search: Mapped[SearchQuery] = relationship(back_populates="results")
    person: Mapped[Person] = relationship()
