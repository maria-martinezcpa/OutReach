# Contact Discovery: Quora + Medium + Reddit

An AI-assisted research tool that finds **US-based professionals** on **Quora**, **Medium** and **Reddit**, extracts their public professional details, and collects the professional links and business contacts they chose to publish. It verifies cross-platform matches and organizes everything in a searchable contact database.

Read **[ETHICS.md](ETHICS.md)** before using it. The same policy is shown in the app at `/policy`.

## How it works

```
                     ┌──────────────── Quora ─────────────────┐
 search request ──►  │ search-engine API  site:quora.com/profile│──► Claude extraction ──► US filter
 (FastAPI → Celery)  └─────────────────────────────────────────┘    (grounded against     │
                     ┌──────────────── Medium ────────────────┐
                     │ search-engine API  site:medium.com/@    │──►  (+ author's public RSS feed)
                     └─────────────────────────────────────────┘
                     ┌──────────────── Reddit ────────────────┐      source text)          ▼
                     │ official Data API: posts in chosen      │──►                  discovery
                     │ communities + public profile bio        │                          │
                     └─────────────────────────────────────────┘                          ▼
  Quora & Medium: name-based search for GitHub (API) / LinkedIn (snippets) / websites (robots.txt-respecting fetch)
  Reddit: ONLY links & emails the author posted. No name or username searches elsewhere.
                                          │
                                          ▼
  verification ─► verified (explicit cross-link) · self_reported (posted by the person) · possible (similar details)
                                          │
                                          ▼
  PostgreSQL: people, profiles, contacts (+ source URL, provenance, date), confidence, missing/conflicting info
                                          │
                                          ▼
  React dashboard: search · contacts · detail/edit · duplicates · analytics · history · CSV/Excel · AI assistant
```

### Data rules
| Rule | Where enforced |
|---|---|
| Nothing invented: every AI-extracted field must be supported by the source text, or it's dropped | `services/ai.py → ground_extraction` |
| US only: needs verbatim location evidence; otherwise excluded | `ai.py`, `pipeline._keep` |
| Verified only by an explicit cross-link, never by a shared name | `services/verify.py`, `pipeline._discover_reddit` |
| Reddit is pseudonymous: no re-identification, self-posted links only | `pipeline._discover_reddit` |
| Business email only, published by the person, with its source URL | `services/contacts.py`, `models.Contact` |
| No crawling of Quora, Medium, LinkedIn or social networks (Medium: official RSS feed only); robots.txt honored elsewhere | `services/fetcher.py` |
| Deleted Reddit posts get their records purged daily (API mode); records from search snippets expire after 30 days | `pipeline.purge_deleted_reddit`, `purge_stale_reddit_snippets` |
| User edits are never overwritten by later discovery | `pipeline._set_if`, `Person.edited_fields` |

## Minimum viable product

**In the MVP (built):**
1. Search Quora and Medium (via a search API, plus Medium RSS feeds) and Reddit (official API) by profession, skills, keywords, company, name/URL (Quora & Medium), US state/city, and Reddit communities.
2. Claude extraction of title, company, experience and years, languages, skills, interests, freelance availability, and location, each grounded in the source text.
3. US-only filtering with stored location evidence.
4. Discovery of GitHub, LinkedIn, websites, portfolios and business emails, with verified, self-reported and possible kept separate.
5. Confidence score, missing fields, and conflicts per person, plus source URL and discovery date on every item.
6. Contact database: view, edit (tracked), delete, tags and categories, notes, duplicate detection and merge, filters.
7. CSV and Excel export, search history, analytics, and an AI research assistant per person.
8. Docker Compose deployment (Postgres, Redis, Celery worker and beat, API, frontend).

**Out of the MVP (next steps):**
- User accounts and roles, audit log, per-user API quotas (needed before any multi-user deployment).
- Alembic migrations (the MVP creates tables on startup).
- More sources (see *Adding a platform*), and streaming assistant responses.
- Scheduled re-verification of stale profiles.

## Running it

### Desktop app (Windows)
```bash
cd backend
.venv\Scripts\python build_desktop.py     # builds the dashboard + packages the app
```
This creates `backend/dist/ContactDiscovery/ContactDiscovery.exe` and a **Contact Discovery** shortcut on the Desktop. The app runs fully on your computer: the API and dashboard start locally and open in a native window (Microsoft Edge WebView2, built into Windows 11).
- Enter API keys on the app's **Settings** page. They're saved to `%APPDATA%\ContactDiscovery\settings.env`.
- The database is `%APPDATA%\ContactDiscovery\contacts.db`, and the log is `app.log` in the same folder.
- To share the app, zip the whole `dist/ContactDiscovery` folder. The recipient doesn't need Python or Node.
- `python desktop.py` runs the desktop app from source without packaging it.


### With Docker (recommended)
```bash
cp .env.example .env    # add ANTHROPIC_API_KEY, a search API key, Reddit API credentials
docker compose up --build
# dashboard: http://localhost:8080     API docs: http://localhost:8000/docs
```

### Locally without Docker
```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
set DATABASE_URL=sqlite:///./dev.db                 # or point at Postgres
uvicorn app.main:app --reload                       # searches run in-process if CELERY_BROKER_URL is empty

cd ../frontend
npm install
npm run dev                                         # http://localhost:5173 (proxies /api to :8000)
```

### Tests
```bash
cd backend && .venv/Scripts/python -m pytest -q
```
All external services (search engine, Claude, GitHub, Reddit, web) are stubbed, so the tests run offline.

### API keys you need
| Service | Purpose | Get it |
|---|---|---|
| Anthropic | Extraction, summaries, assistant (`claude-opus-5-5`) | console.anthropic.com |
| One search API: **Tavily** (free monthly credits), **Serper** (free sign-up credits), Brave, or Google | Finding Quora profiles, Medium authors, Reddit snippets, LinkedIn snippets, websites | app.tavily.com / serper.dev / api.search.brave.com / programmablesearchengine.google.com |
| Reddit Data API (optional) | Full Reddit posts and link verification. Without it, Reddit is searched through the search engine (snippets only). | reddit.com/prefs/apps; accept the Developer Terms. Commercial use needs Reddit's approval. |
| GitHub token (optional) | Higher API rate limit | github.com/settings/tokens (no scopes needed) |

**Free mode (no AI):** with no Anthropic key, or with *Settings → AI → Mode* set to "Always use free mode", the app uses rule-based extraction (`services/rules.py`). It recognizes patterns like "Senior Engineer at Acme" and "Lives in Austin, TX", plus fixed lists of languages and skills. It costs nothing but finds fewer details. Summaries and the assistant become rule-based reports built from the stored record. Combined with Tavily or Serper's free plans, the whole app runs at no cost.

Claude calls run with server-side refusal fallback enabled (`fallbacks: "default"`). If a request is declined, it's retried on a fallback model automatically.

## Deploying to AWS

A straightforward production layout:
- **ECS Fargate**: three services from the two images: `backend` (uvicorn, behind an ALB), `worker` (Celery worker), and `beat` (`celery -A app.tasks beat`; run exactly one).
- **RDS for PostgreSQL** for `DATABASE_URL`, and **ElastiCache for Redis** for `CELERY_BROKER_URL`.
- **S3 + CloudFront** for the built frontend (`npm run build` → `dist/`), with CloudFront routing `/api/*` to the ALB. Alternatively, run the frontend image on ECS.
- **Secrets Manager** for API keys, injected as task environment variables.
- Put authentication in front before exposing it (for example ALB + Cognito, or an auth proxy). The MVP has no user accounts.

## Adding a platform

Each source is a module in `backend/app/services/` plus a `_run_<source>` method in `pipeline.SearchJob`:
1. A client that uses the platform's **official API**, or a permitted search API (see `reddit.py`, `github.py`).
2. Build items `{index, url, text}` and call `ClaudeService.extract_people(items, source)`, adding a system prompt for the source in `ai.py`.
3. Upsert a `Person`, add the original page as an `anchor` profile, and run discovery appropriate to the platform. If accounts are pseudonymous, follow the Reddit rules.
4. Call `refresh_quality(person)` and `_link_result(search, person)`.
5. Add the source to `schemas.Source` and to the search form.

## Project layout
```
backend/app/
  main.py, api.py          FastAPI app + REST endpoints
  models.py, schemas.py    SQLAlchemy models, Pydantic API schemas
  tasks.py                 Celery worker + daily Reddit deletion sync
  services/
    pipeline.py            search orchestration (Quora + Medium + Reddit)
    ai.py                  Claude extraction (grounded), summaries, assistant
    reddit.py              Reddit Data API client
    search_engine.py       Brave / Google search APIs
    quora.py               Quora query building + URL parsing
    medium.py              Medium query building, URL + RSS feed parsing
    github.py              GitHub REST API
    fetcher.py             robots.txt-respecting fetcher + no-crawl list
    contacts.py            business-email extraction from personal sites
    verify.py              match scoring & verification
    quality.py             confidence, missing fields, conflicts
    us_location.py         US location detection
    export.py              CSV / Excel
frontend/src/              React + TypeScript dashboard
```
