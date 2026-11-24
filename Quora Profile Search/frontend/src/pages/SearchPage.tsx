import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, REGION_LABEL, type AppSettings, type Health, type Region, type PersonSummary, type QueryType, type Search, type Source, type Stats } from "../api/client";
import { ExportButtons, PersonCard, StatusBadge, splitList } from "../components/common";

const PLACEHOLDER: Record<QueryType, string> = {
  profession: "e.g. full-stack developer",
  skills: "e.g. React, TypeScript",
  keywords: "e.g. AI engineer freelance",
  name: "e.g. Jane Doe (Quora & Medium)",
  company: "e.g. Stripe",
  url: "https://www.quora.com/profile/Jane-Doe or https://medium.com/@janedoe",
};

export default function SearchPage() {
  const { id } = useParams();
  const searchId = id ? Number(id) : null;
  const navigate = useNavigate();

  const [queryType, setQueryType] = useState<QueryType>("profession");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<Source[]>(["quora", "medium", "reddit"]);
  const [company, setCompany] = useState("");
  const [profession, setProfession] = useState("");
  const [skills, setSkills] = useState("");
  const [state, setState] = useState("");
  const [regions, setRegions] = useState<Region[]>(["US", "EU"]);
  const [requireContact, setRequireContact] = useState(true);
  const [subreddits, setSubreddits] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<Health | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState<(Search & { people: PersonSummary[] }) | null>(null);

  const [textFilter, setTextFilter] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [hasContact, setHasContact] = useState(false);
  const [freelanceOnly, setFreelanceOnly] = useState(false);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.settings().then(setAppSettings).catch(() => setAppSettings(null));
  }, []);
  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, [search?.status]);

  // Poll the active search until it finishes
  useEffect(() => {
    if (!searchId) {
      setSearch(null);
      return;
    }
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api.search(searchId);
        if (stop) return;
        setSearch(s);
        if (s.status === "pending" || s.status === "running") timer = window.setTimeout(tick, 1500);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [searchId]);

  // Reddit accounts are pseudonymous, so name/URL lookups never go to Reddit
  const isUrl = queryType === "url";
  const noReddit = queryType === "name" || isUrl;
  const urlSource: Source = /medium\.com/i.test(query) ? "medium" : "quora";
  const effectiveSources: Source[] = isUrl ? [urlSource] : noReddit ? sources.filter((s) => s !== "reddit") : sources;

  function toggleSource(s: Source) {
    setSources((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (regions.length === 0) {
      setError("Choose at least one region.");
      return;
    }
    if (effectiveSources.length === 0) {
      setError("Choose at least one source.");
      return;
    }
    setSubmitting(true);
    try {
      const s = await api.createSearch({
        query,
        query_type: queryType,
        sources: effectiveSources,
        company: company || null,
        profession: profession || null,
        skills: splitList(skills),
        state: state || null,
        regions,
        require_contact: requireContact,
        subreddits: splitList(subreddits).map((x) => x.replace(/^r\//, "")),
      });
      navigate(`/searches/${s.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const people = useMemo(() => {
    const t = textFilter.toLowerCase();
    return (search?.people ?? []).filter(
      (p) =>
        (!verifiedOnly || p.verified_count > 0) &&
        (!hasContact || p.contact_count > 0) &&
        (!freelanceOnly || p.freelance_available) &&
        (!t || [p.display_name, p.job_title, p.company, p.industry, p.location, ...p.skills, ...p.programming_languages]
          .some((v) => v?.toLowerCase().includes(t))),
    );
  }, [search, textFilter, verifiedOnly, hasContact, freelanceOnly]);

  const running = search && (search.status === "pending" || search.status === "running");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Find professionals in the US and Europe</h1>
          <div className="sub">Searches public Quora profiles, Medium authors and Reddit posts from the US and Europe, then collects the professional links and contacts people chose to publish.</div>
        </div>
      </div>

      {appSettings && !appSettings.search_ready && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <strong>Setup needed:</strong> add a search key before searching. Tavily and Serper are free.{" "}
          <Link to="/settings">Open Settings</Link>
        </div>
      )}
      {appSettings && appSettings.search_ready && appSettings.ai_active === "rules" && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <strong>Free mode:</strong> details are found with rules instead of AI, so expect fewer job titles, skills and
          locations. Add an Anthropic key in <Link to="/settings">Settings</Link> for better results.
        </div>
      )}

      {stats && (
        <div className="stats">
          {([
            ["People saved", stats.people],
            ["Verified profiles", stats.verified_profiles],
            ["Unconfirmed profiles", stats.possible_profiles],
            ["Emails", stats.emails],
            ["Searches", stats.searches],
          ] as const).map(([label, value]) => (
            <div key={label} className="card stat">
              <div className="label">{label}</div>
              <div className="value">{value}</div>
            </div>
          ))}
        </div>
      )}

      <form className="card" onSubmit={submit} style={{ marginBottom: 20 }}>
        <div className="search-grid">
          <select value={queryType} onChange={(e) => setQueryType(e.target.value as QueryType)} aria-label="Search by">
            <option value="profession">Profession</option>
            <option value="skills">Skills</option>
            <option value="keywords">Keywords</option>
            <option value="company">Company</option>
            <option value="name">Name</option>
            <option value="url">Quora or Medium profile URL</option>
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={PLACEHOLDER[queryType]}
                 required minLength={2} aria-label="Search query" />
          <button className="btn primary" disabled={submitting || !!running}>
            {submitting ? "Starting…" : "Search"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small muted">Regions:</span>
          {(["US", "EU"] as Region[]).map((r) => (
            <label key={r} className="check">
              <input type="checkbox" checked={regions.includes(r)}
                     onChange={() => setRegions((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))} />
              {REGION_LABEL[r]}
            </label>
          ))}
          <span className="small muted" style={{ marginLeft: 12 }}>Only keep:</span>
          <label className="check" title="Drop people with no self-linked GitHub profile and no published email">
            <input type="checkbox" checked={requireContact} onChange={(e) => setRequireContact(e.target.checked)} />
            people with a GitHub or email
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="small muted">Sources:</span>
          {(["quora", "medium", "reddit"] as Source[]).map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={effectiveSources.includes(s)}
                     disabled={isUrl || (noReddit && s === "reddit")} onChange={() => toggleSource(s)} />
              {{ quora: "Quora", medium: "Medium", reddit: "Reddit" }[s]}
            </label>
          ))}
          {noReddit && <span className="small muted">Name and URL searches skip Reddit, because Reddit accounts are pseudonymous and aren't looked up by name.</span>}
          {health && !health.reddit_configured && effectiveSources.includes("reddit") && (
            <span className="small muted">Reddit runs through the search engine (short snippets only) because no Reddit API keys are set.</span>
          )}
          <span className="grow" />
          <button type="button" className="btn sm" onClick={() => setShowFilters((v) => !v)}>
            {showFilters ? "Hide filters" : "More filters"}
          </button>
        </div>
        {showFilters && (
          <div className="filters-grid">
            <label className="field">Company<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
            <label className="field">Profession<input value={profession} onChange={(e) => setProfession(e.target.value)} /></label>
            <label className="field">Skills (comma-separated)<input value={skills} onChange={(e) => setSkills(e.target.value)} /></label>
            <label className="field">State, country or city<input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. California, Germany, London" /></label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Reddit communities (comma-separated)
              <input value={subreddits} onChange={(e) => setSubreddits(e.target.value)}
                     placeholder={health ? health.default_subreddits.join(", ") : "forhire, freelance_forhire"} />
            </label>
          </div>
        )}
      </form>

      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {search && (
        <div className="stack">
          <div className="card">
            <div className="row">
              <div className="grow">
                <div className="row">
                  <h2>“{search.query}”</h2>
                  <span className="badge">{search.query_type}</span>
                  {search.sources.map((s) => <span key={s} className={`badge src-${s}`}>{s}</span>)}
                  <StatusBadge status={search.status} />
                </div>
                <div className="progress muted small" style={{ marginTop: 6 }}>
                  {running && <span className="spinner" />}
                  <span>{search.message}</span>
                </div>
              </div>
              {search.result_count > 0 && !running && (
                <ExportButtons href={(f) => api.exportUrl(f, { search_id: search.id })} />
              )}
            </div>
          </div>

          {(search.people.length > 0 || search.status === "done") && (
            <div className="row">
              <input className="grow" placeholder="Filter by name, title, company, skill, language…"
                     value={textFilter} onChange={(e) => setTextFilter(e.target.value)} />
              <label className="check"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />Verified profile</label>
              <label className="check"><input type="checkbox" checked={hasContact} onChange={(e) => setHasContact(e.target.checked)} />Has email</label>
              <label className="check"><input type="checkbox" checked={freelanceOnly} onChange={(e) => setFreelanceOnly(e.target.checked)} />Open to freelance</label>
            </div>
          )}

          {people.length > 0 ? (
            <div className="people-grid">{people.map((p) => <PersonCard key={p.id} p={p} />)}</div>
          ) : (
            search.status === "done" && <div className="card empty">No matching people.</div>
          )}
        </div>
      )}

      {!search && (
        <div className="notice">
          Only public professional information is collected, and every detail links to its public source. Quora, Medium and LinkedIn are
          never scraped. Medium is read only through its public RSS feeds. Reddit is read through its official API, and only the links and contacts an author posted
          are used. Missing details stay blank instead of being guessed. <Link to="/policy">Read the ethical use policy</Link>.
        </div>
      )}
    </>
  );
}
