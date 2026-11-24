import csv
import io

from openpyxl import Workbook
from openpyxl.styles import Font

from ..models import Person

COLUMNS = ["Name", "Reddit username", "Discovered on", "Original source", "Job title", "Company", "Industry",
           "Years of experience", "Programming languages", "Skills", "Freelance available", "City", "State",
           "Region", "Location evidence", "Verified profiles", "Self-reported profiles", "Possible profiles",
           "Emails", "Email sources", "Confidence", "Missing information", "Conflicts", "Category", "Tags",
           "User-edited fields", "First discovered", "Last updated"]


def _fmt_profiles(p: Person, status: str) -> str:
    return "\n".join(f"{x.platform}: {x.url}" for x in p.profiles if x.match_status == status)


def person_row(p: Person) -> list:
    anchor = next((x.url for x in p.profiles if x.match_status == "anchor"), "")
    emails = [f"{c.value} ({'business' if c.is_business else 'personal'}, {c.verification_status}, "
              f"{c.provenance.replace('_', ' ')})" for c in p.contacts]
    return [
        p.full_name or "", p.reddit_username or "", p.source_platform, anchor, p.job_title or "", p.company or "",
        p.industry or "", p.years_experience if p.years_experience is not None else "",
        ", ".join(p.programming_languages or []), ", ".join(p.skills or []),
        {True: "Yes", False: "No", None: ""}[p.freelance_available], p.city or "", p.state or "", {"US": "United States", "EU": "Europe"}.get(p.country or "", p.country or ""),
        p.location_evidence or "", _fmt_profiles(p, "verified"), _fmt_profiles(p, "self_reported"),
        _fmt_profiles(p, "possible"), "\n".join(emails), "\n".join(sorted({c.source_url for c in p.contacts})),
        f"{round(p.confidence * 100)}%", "; ".join(p.missing_fields or []), "; ".join(p.conflicts or []),
        p.category or "", ", ".join(p.tags or []), ", ".join(p.edited_fields or []),
        p.created_at.strftime("%Y-%m-%d") if p.created_at else "",
        p.updated_at.strftime("%Y-%m-%d %H:%M") if p.updated_at else "",
    ]


def _safe(v):
    # Neutralize spreadsheet formula injection from scraped text
    return "'" + v if isinstance(v, str) and v and v[0] in "=+-@\t\r" else v


def to_csv(people: list[Person]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)
    for p in people:
        w.writerow([_safe(v) for v in person_row(p)])
    return buf.getvalue().encode("utf-8-sig")


def to_xlsx(people: list[Person]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "People"
    ws.append(COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for p in people:
        ws.append([_safe(v) for v in person_row(p)])
    for i, col in enumerate(ws.columns):
        ws.column_dimensions[col[0].column_letter].width = 40 if i in (3, 15, 16, 17, 18, 19, 21, 22) else 20
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
