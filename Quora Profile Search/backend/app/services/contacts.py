"""Find business emails a person intentionally published on their own professional website."""

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .fetcher import PoliteFetcher, registered_domain

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b")
FREE_MAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "aol.com",
    "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "yandex.com", "mail.com",
    "msn.com", "zoho.com",
}
IGNORE_LOCALPARTS = {"noreply", "no-reply", "donotreply", "example", "user", "name", "email", "your"}
ASSET_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".js")
CONTACT_HINTS = ("contact", "about", "hire", "work-with-me", "connect")


@dataclass
class FoundEmail:
    value: str
    source_url: str
    evidence: str
    is_business: bool
    via_mailto: bool


@dataclass
class PageInfo:
    url: str
    text: str
    links: list[str]


def is_business_email(email: str) -> bool:
    return email.split("@", 1)[1].lower() not in FREE_MAIL


def _clean_candidates(text: str) -> set[str]:
    out = set()
    for m in EMAIL_RE.findall(text):
        e = m.strip(".").lower()
        local, _, domain = e.partition("@")
        if local in IGNORE_LOCALPARTS or domain.endswith(ASSET_SUFFIXES) or "example." in domain:
            continue
        out.add(e)
    return out


def parse_page(url: str, html: str) -> tuple[PageInfo, list[FoundEmail]]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = " ".join(soup.get_text(" ").split())
    links: list[str] = []
    emails: dict[str, FoundEmail] = {}

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?")[0].strip().lower()
            for e in _clean_candidates(addr):
                emails[e] = FoundEmail(e, url, f"mailto link: {a.get_text(' ', strip=True)[:120] or addr}",
                                       is_business_email(e), True)
        else:
            links.append(urljoin(url, href))

    for e in _clean_candidates(text):
        if e not in emails:
            i = text.lower().find(e)
            ctx = text[max(0, i - 80): i + len(e) + 80] if i >= 0 else e
            emails[e] = FoundEmail(e, url, ctx, is_business_email(e), False)

    return PageInfo(url=url, text=text[:20000], links=links), list(emails.values())


def crawl_site(fetcher: PoliteFetcher, site_url: str, max_pages: int) -> tuple[list[PageInfo], list[FoundEmail]]:
    """Fetch the homepage plus a few same-site contact/about pages (robots.txt permitting)."""
    pages: list[PageInfo] = []
    found: dict[str, FoundEmail] = {}
    got = fetcher.get_html(site_url)
    if not got:
        return pages, []
    final_url, html = got
    page, emails = parse_page(final_url, html)
    pages.append(page)
    for e in emails:
        found.setdefault(e.value, e)

    domain = registered_domain(final_url)
    follow = []
    for link in page.links:
        if registered_domain(link) == domain and any(h in urlparse(link).path.lower() for h in CONTACT_HINTS):
            clean = link.split("#")[0]
            if clean not in follow and clean != final_url:
                follow.append(clean)
    for link in follow[:max_pages]:
        got = fetcher.get_html(link)
        if not got:
            continue
        p, emails = parse_page(*got)
        pages.append(p)
        for e in emails:
            found.setdefault(e.value, e)
    return pages, list(found.values())


def email_belongs_to_site(email: str, site_url: str) -> bool:
    d = email.split("@", 1)[1].lower()
    site = registered_domain(site_url)
    return d == site or d.endswith("." + site) or site.endswith("." + d)
