# GitHub Profile Finder — desktop app

**Run it:** double-click `app\GitHubProfileFinder\GitHubProfileFinder.exe`. It opens in its own window (no browser
needed). Everything it stores — tokens, saved profiles, background searches — is in `app\GitHubProfileFinder\data`;
settings can go in `app\GitHubProfileFinder\.env`; logs are in `app\GitHubProfileFinder\logs\app.log`.
Closing the window stops the app; running background searches are saved and continue next time it opens.

**Rebuild after changing the code:** run `powershell -ExecutionPolicy Bypass -File build.ps1` (needs Python 3.12 and
Node.js). The data folder and `.env` next to the program are kept. Requires Microsoft Edge WebView2 (built into
Windows 10/11).

The desktop entry point is `backend/desktop.py`: it runs the FastAPI backend inside the program on a random local
port and shows the React interface in a native window. The web version below still works for development.

---

# GitHub Profile Finder

Search GitHub for people by skill, location and **when they committed code**, collect the contact details they
published on their GitHub profile, and see an explainable analysis of their public activity.

- **Backend:** Python, FastAPI, Pydantic, httpx
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Storage:** JSON and CSV files in `backend/data/` (no database)

## Quick start (Windows)

Requires Python 3.11+ and Node.js 20+.

```powershell
# 1. Backend
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env        # then put your GitHub token in GITHUB_TOKEN
venv\Scripts\python -m uvicorn app.main:app --port 8000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. API docs are at http://localhost:8000/docs.

### GitHub token

Create a token at https://github.com/settings/tokens. It needs **no scopes**: all data is public.
Without a token GitHub allows 60 requests/hour, which is not enough for one search. With a token the limit is
5,000/hour. One search checks up to 2× "results per page" candidates, and each costs about 5–10 requests.

## How searching works

**Multiple keywords:** type a keyword and press Enter or comma to add it as a chip; add as many as you like.
A person is included when they match **any** of them. GitHub accepts at most 6 OR-ed terms per query, so larger
lists are split into several queries per page and merged without duplicates. Each result shows the keywords it
matched. API: `keywords=gis,bim,revit` (or repeated `keywords=` parameters).

| Mode | What it searches | Good for |
|---|---|---|
| **Repositories** (default) | Repositories whose name, description or topics match your keywords (supports GitHub syntax: `"exact phrase"`, `topic:webgl`, `react OR vue`); their owners become candidates | People who work on a technology |
| **Commits** | GitHub commit search: commit messages matching your keywords, filtered by **commit author date** | "Who worked on X in the last month" |
| **Profiles** | GitHub user search: username/name/email, location, language, followers, repos, account age | People in a city or with a certain profile |

**Commit date filter:** only people who authored commits between the two dates are shown.
- *Commits* mode asks GitHub directly for commits with `author-date:FROM..TO`.
- *Repositories* and *Profiles* modes check each candidate's most recently pushed repositories (up to 6) and count
  commits authored by that user whose **author date** is inside the range. Repositories are pre-selected with
  `pushed:>=FROM` (a repository pushed after the range can still hold commits from it).
- Each result shows the commit count and the date of the latest commit in the range.

Other filters: country (derived from the location text), min followers/repos/account age, and "must have public
email / phone / LinkedIn / website".

**Suggestions:** the Keywords, Language, Location and Country inputs suggest values GitHub search understands:
GitHub topics (GitHub's live topic search plus ~500 featured/curated topics collected in the background when the
backend starts, which takes under a minute and is cached for a week in `data/suggest_topics.json`), GitHub language
names, cities/countries, and locations written on profiles the app has already seen. Press **＋ Keep** to store a
keyword as a one-click shortcut (kept in your browser).

**Live results:** a search streams its results (server-sent events): each person appears the moment they are found,
with a progress bar and a **Stop** button. Background searches also add people to their list one by one.

**API quota:** the header shows how many GitHub API requests are left this hour (5,000 per token). Each person
checked costs about 5–10. When the quota runs out, results so far are kept, and background searches wait and resume.

### Background searches

**Search** fetches one page. **Run in background** starts a search that keeps going page after page and adds every
matching person to a list, until it reaches "Stop after N people" or GitHub runs out of results (GitHub exposes at
most 1,000 results per query).

- Several background searches run at the same time; the **Background searches** tab shows each one's progress.
- Results appear in the list as they are found. Filter, sort, save individual people, **Add all to Saved list**, or
  export the list as CSV/JSON.
- **Pause** / **Continue search** at any time. When the target is reached, **Continue: find 100 more** picks up where
  it stopped.
- When GitHub's rate limit is hit, the search waits for the reset and continues automatically.
- Each search and its list are stored in `backend/data/jobs/<id>.json`. Searches that were running when the
  backend stopped resume automatically on the next start.

## What is collected, and from where

| Field | Source |
|---|---|
| Name, location, company, GitHub link | GitHub profile |
| Country | Derived from the location text (city/state/country lookup) |
| Roles | Job titles found in the bio or profile README ("Senior GIS Developer") |
| Email | Public email field; emails written in the bio or profile README |
| Phone | Numbers written in the bio or profile README (labelled `Phone:`, `tel:`, `wa.me/` or international `+` format) |
| LinkedIn and other links | Website field, social accounts linked on GitHub, twitter field, links in the profile README |

Every contact value shows the source it came from. The app deliberately does **not** read commit-author emails,
scrape external websites, or try to find hidden information: someone who hides their email on GitHub has chosen not
to publish it.

**Responsible use:** GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies#7-information-usage-restrictions)
forbid using information from GitHub for spam, unsolicited bulk email, or selling personal information to recruiters.
Contact people individually and relevantly, and delete data you no longer need (Delete stored data / Remove).

## Analysis

All analysis is rule-based and shows its evidence.

- **Skills**: from repository languages, names, descriptions and topics, plus the bio. Each skill has a confidence
  level and the repositories behind it. It is marked "detected from public activity", not verified expertise.
- **Activity status**: `ACTIVE` (pushed within 90 days), `MODERATE` (within a year), `INACTIVE`, `UNKNOWN`.
- **Human-account confidence**: `HIGH` / `MEDIUM` / `LOW` / `INSUFFICIENT_DATA`, based on account age, original
  repositories, consistency over time, language diversity, profile completeness, professional links, follow
  patterns (mass-following counts against) and bulk repository creation. Every signal is listed with its effect.
  It does not verify identity.

## Storage (`backend/data/`)

| File | Contents |
|---|---|
| `saved_profiles.json` | Saved profiles (full snapshot, note, saved time) |
| `saved_profiles.csv` | The same saved profiles as a spreadsheet, rewritten on every save/remove |
| `profiles_cache.json` | GitHub data cached for 24 hours (`CACHE_TTL_HOURS`) to save API calls |
| `search_history.json` | The last 100 searches |

CSV columns: `username, name, roles, email, phone, linkedin, github_url, website, other_links, location, country,
company, followers, public_repos, account_created, languages, skills, human_confidence, activity_status, last_push,
period_commits, contact_sources, saved_at, note`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/search/stream` | Same parameters as `/api/search`; server-sent events `progress`, `item` (one per person, as found), `done`, `failed` |
| GET | `/api/suggest?field=keyword\|language\|location\|country&q=` | Autocomplete values GitHub search understands |
| GET | `/api/search` | Search. Query params: `mode` (`repositories`, `commits`, `users`), `q`, `language`, `location`, `country`, `since`, `until` (YYYY-MM-DD), `min_followers`, `min_repos`, `min_account_age_years`, `require_email`, `require_phone`, `require_linkedin`, `require_website`, `page`, `per_page` |
| GET | `/api/profiles/{login}` | Full profile + analysis (`?refresh=true` bypasses the cache) |
| DELETE | `/api/profiles/{login}` | Delete all stored data for a user (cache and saved) |
| GET | `/api/saved` | List saved profiles |
| POST | `/api/saved/{login}` | Save a profile (body: `{"note": "..."}`) |
| DELETE | `/api/saved/{login}` | Remove a saved profile |
| DELETE | `/api/saved` | Remove all saved profiles |
| GET | `/api/export/csv`, `/api/export/json` | Export saved profiles, or `?logins=a,b,c` for specific users |
| GET | `/api/history` / DELETE | Search history |
| POST | `/api/jobs` | Start a background search (search params as JSON + `target`, `name`) |
| GET | `/api/jobs`, `/api/jobs/{id}` | Background searches and their progress |
| GET | `/api/jobs/{id}/results?offset=N` | Profiles found so far (from `offset`) |
| POST | `/api/jobs/{id}/pause`, `/api/jobs/{id}/resume?extra=N` | Pause / continue (optionally raise the target) |
| POST | `/api/jobs/{id}/save-all` | Add every result to the saved list |
| GET | `/api/jobs/{id}/export/{csv|json}` | Export the result list |
| DELETE | `/api/jobs/{id}` | Delete a background search and its list |
| GET | `/api/rate-limit` | Remaining GitHub API quota |
| GET | `/api/health` | Status and whether a token is configured |

Interactive documentation: http://localhost:8000/docs

Errors: `429` when GitHub's rate limit is reached (with the reset time), `400` for invalid queries, `404` for unknown
users. The client retries network errors, 5xx responses and secondary rate limits with exponential backoff.

## Tests

```powershell
cd backend;  venv\Scripts\python -m pytest     # contact extraction, analysis, API (GitHub mocked)
cd frontend; npm test                          # search flow, period filter, save, errors
```

## Deployment

1. Build the frontend: `cd frontend && npm run build` produces static files in `frontend/dist/`.
2. Run the backend with a process manager, e.g. `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1`
   (use one worker: storage is file-based).
3. Serve `frontend/dist/` with nginx/Caddy and proxy `/api/` to `http://127.0.0.1:8000`.
4. Set `GITHUB_TOKEN` and `CORS_ORIGINS` in `backend/.env`. Keep `backend/data/` on persistent disk and back it up.
5. The app has no user login. If you expose it beyond your own machine, put it behind authentication
   (e.g. your reverse proxy's basic auth or an identity-aware proxy), since it stores personal data.
