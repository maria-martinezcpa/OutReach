import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, REGION_LABEL, type PersonDetail, type PersonUpdate, type Profile } from "../api/client";
import { Confidence, SourceBadge, StatusBadge, initials, splitList, timeAgo } from "../components/common";
import Assistant from "../components/Assistant";

const PLATFORM_LABEL: Record<string, string> = {
  quora: "Quora", medium: "Medium", reddit: "Reddit", linkedin: "LinkedIn", github: "GitHub", website: "Website",
  portfolio: "Portfolio", social: "Social",
};

const GROUPS: [Profile["match_status"], string][] = [
  ["anchor", "Original source"],
  ["verified", "Verified: explicitly cross-linked"],
  ["self_reported", "Self-reported: posted by the person, not cross-checked"],
  ["possible", "Possible matches: similar details only, not confirmed"],
];

function Missing({ v }: { v: string | number | null | undefined }) {
  return v === null || v === undefined || v === "" ? <span className="muted">Not stated</span> : <>{v}</>;
}

export default function PersonPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [p, setP] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = () => api.person(id).then(setP).catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, [id]);

  async function act(fn: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function summarize() {
    setSummarizing(true);
    setError(null);
    try {
      setP(await api.summarize(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSummarizing(false);
    }
  }

  if (error && !p) return <div className="alert">{error}</div>;
  if (!p) return <div className="progress muted"><span className="spinner" />Loading…</div>;

  const edited = (f: string) => p.edited_fields.includes(f) && <span className="badge" title="Changed by a user, not discovered">edited</span>;

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="avatar lg">{initials(p.display_name)}</div>
          <div>
            <div className="row"><h1>{p.display_name}</h1><SourceBadge source={p.source_platform} /></div>
            <div className="sub">
              {[p.job_title, p.company].filter(Boolean).join(" · ") || "Role not stated publicly"}
              {p.full_name && p.reddit_username ? ` · u/${p.reddit_username}` : ""}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel edit" : "Edit record"}</button>
          <a className="btn sm" href={api.exportUrl("csv", { ids: String(p.id) })}>CSV</a>
          <a className="btn sm" href={api.exportUrl("xlsx", { ids: String(p.id) })}>Excel</a>
          <button className="btn sm danger" onClick={() => act(async () => { await api.deletePerson(id); navigate("/people"); },
            "Delete this person and all stored information about them?")}>Delete</button>
        </div>
      </div>

      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="detail">
        <div className="stack">
          {editing ? (
            <EditForm p={p} onSaved={(np) => { setP(np); setEditing(false); }} onError={setError} />
          ) : (
            <div className="card">
              <div className="row" style={{ marginBottom: 12 }}>
                <h2 className="grow">Professional details</h2>
                <Confidence value={p.confidence} />
              </div>
              <dl className="kv">
                <dt>Full name</dt><dd><Missing v={p.full_name} /> {edited("full_name")}</dd>
                {p.reddit_username && <><dt>Reddit</dt><dd>u/{p.reddit_username}</dd></>}
                <dt>Title</dt><dd><Missing v={p.job_title} /> {edited("job_title")}</dd>
                <dt>Company</dt><dd><Missing v={p.company} /> {edited("company")}</dd>
                <dt>Industry</dt><dd><Missing v={p.industry} /></dd>
                <dt>Experience</dt>
                <dd>
                  {p.years_experience != null ? `${p.years_experience} years` : <span className="muted">Years not stated</span>}
                  {p.experience && <div className="small muted">{p.experience}</div>}
                </dd>
                <dt>Languages</dt>
                <dd>{p.programming_languages.length ? <div className="chips">{p.programming_languages.map((s) => <span key={s} className="chip">{s}</span>)}</div> : <span className="muted">Not stated</span>}</dd>
                <dt>Skills</dt>
                <dd>{p.skills.length ? <div className="chips">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div> : <span className="muted">Not stated</span>}</dd>
                {p.interests.length > 0 && <><dt>Interests</dt><dd className="chips">{p.interests.map((s) => <span key={s} className="chip">{s}</span>)}</dd></>}
                <dt>Freelance</dt>
                <dd>{p.freelance_available === true ? "Available for freelance/contract work" : p.freelance_available === false ? "Not available" : <span className="muted">Not stated</span>}</dd>
                <dt>Location</dt>
                <dd>
                  {[p.city, p.state].filter(Boolean).join(", ") || p.location || REGION_LABEL[p.country ?? ""] || "Not stated"}
                  {p.country && <span className="muted"> · {REGION_LABEL[p.country] ?? p.country}</span>}
                  {p.location_evidence && <div className="muted small">Source text: “{p.location_evidence}”</div>}
                </dd>
                <dt>Organize</dt>
                <dd>
                  <div className="chips">
                    {p.category && <span className="chip"><strong>{p.category}</strong></span>}
                    {p.tags.map((t) => <span key={t} className="chip tag">#{t}</span>)}
                    {!p.category && p.tags.length === 0 && <span className="muted">No category or tags</span>}
                  </div>
                </dd>
                {p.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{p.notes}</dd></>}
                <dt>Discovered</dt><dd className="muted">{new Date(p.created_at).toLocaleDateString()} · updated {timeAgo(p.updated_at)}</dd>
              </dl>
            </div>
          )}

          {(p.missing_fields.length > 0 || p.conflicts.length > 0) && (
            <div className="card">
              <h2 style={{ marginBottom: 8 }}>Data quality</h2>
              {p.conflicts.length > 0 && (
                <>
                  <div className="section-label" style={{ color: "var(--danger)" }}>Conflicting information</div>
                  <ul className="reasons" style={{ color: "var(--text)" }}>{p.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
                </>
              )}
              {p.missing_fields.length > 0 && (
                <>
                  <div className="section-label">Missing information</div>
                  <div className="chips">{p.missing_fields.map((m) => <span key={m} className="chip">{m}</span>)}</div>
                </>
              )}
            </div>
          )}

          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 className="grow">AI summary</h2>
              <button className="btn sm" onClick={summarize} disabled={summarizing}>
                {summarizing ? "Generating…" : p.ai_summary ? "Regenerate" : "Generate summary"}
              </button>
            </div>
            {p.ai_summary ? <div className="summary">{p.ai_summary}</div> :
              <div className="muted">Summarize this person's public professional background and explain each match. This is AI interpretation, not verified fact.</div>}
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 6 }}>Contact information</h2>
            <div className="muted small" style={{ marginBottom: 10 }}>
              Only addresses the person published themselves, in their own post, their GitHub profile or their own website. Each one links to where it was found.
            </div>
            {p.country === "EU" && p.contacts.length > 0 && (
              <div className="notice small" style={{ marginBottom: 10 }}>
                <strong>Europe (GDPR):</strong> before contacting this person, make sure you have a lawful basis such as
                legitimate interest for a relevant professional offer. Tell them where you found their details and honor any
                request to stop or delete. Many EU countries don't allow unsolicited marketing to personal email addresses without consent.
              </div>
            )}
            {p.contacts.length === 0 ? (
              <div className="muted">No published email found.</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {p.contacts.map((c) => (
                  <div key={c.id} className="profile-item">
                    <div className="row">
                      <a href={`mailto:${c.value}`} className="grow"><strong>{c.value}</strong></a>
                      <span className="badge">{c.is_business ? "Business" : "Personal"}</span>
                      <StatusBadge status={c.provenance} />
                      <button className="btn sm" onClick={() => act(() => api.deleteContact(id, c.id), `Remove ${c.value}?`)}>Remove</button>
                    </div>
                    <div className="small muted">Source: <a href={c.source_url} target="_blank" rel="noreferrer">{c.source_url}</a> · {new Date(c.discovered_at).toLocaleDateString()}</div>
                    {c.evidence && <div className="small muted">“{c.evidence}”</div>}
                    {/github\.com/i.test(c.source_url) && (
                      <div className="small" style={{ color: "var(--possible)" }}>
                        Taken from GitHub: GitHub's terms don't allow using it for unsolicited emails. Use the person's other
                        published contact, or reach out through a channel they invite contact on.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 6 }}>Profiles &amp; links</h2>
            {GROUPS.map(([status, label]) => {
              const items = p.profiles.filter((x) => x.match_status === status);
              if (!items.length) return null;
              return (
                <div key={status} className="stack" style={{ gap: 8, marginTop: 10 }}>
                  <div className="section-label">{label}</div>
                  {items.map((x) => (
                    <div key={x.id} className="profile-item">
                      <div className="row">
                        <span className="badge">{PLATFORM_LABEL[x.platform] ?? x.platform}</span>
                        <a className="grow truncate" href={x.url} target="_blank" rel="noreferrer">{x.url}</a>
                        <StatusBadge status={x.match_status} />
                        {x.match_status !== "anchor" && <span className="small muted" title="Match score">{Math.round(x.match_score * 100)}%</span>}
                      </div>
                      {x.snippet && <div className="small muted" style={{ maxHeight: 60, overflow: "hidden" }}>{x.snippet}</div>}
                      {x.match_reasons.length > 0 && <ul className="reasons">{x.match_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                      <div className="row small muted">
                        {x.source_url && x.source_url !== x.url && <span>Found via <a href={x.source_url} target="_blank" rel="noreferrer">source</a></span>}
                        <span>{new Date(x.discovered_at).toLocaleDateString()}</span>
                        <span className="grow" />
                        {x.match_status !== "anchor" && (
                          <button className="btn sm" onClick={() => act(() => api.rejectProfile(id, x.id), `Remove ${x.url} from this person?`)}>Not this person</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <Assistant personId={p.id} personName={p.display_name} />
      </div>
    </>
  );
}

function EditForm({ p, onSaved, onError }: { p: PersonDetail; onSaved: (p: PersonDetail) => void; onError: (e: string) => void }) {
  const [v, setV] = useState({
    full_name: p.full_name ?? "", job_title: p.job_title ?? "", company: p.company ?? "", industry: p.industry ?? "",
    years_experience: p.years_experience?.toString() ?? "", programming_languages: p.programming_languages.join(", "),
    skills: p.skills.join(", "), city: p.city ?? "", state: p.state ?? "",
    freelance: p.freelance_available === null ? "" : String(p.freelance_available),
    category: p.category ?? "", tags: p.tags.join(", "), notes: p.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }));
  const nul = (s: string) => (s.trim() === "" ? null : s.trim());

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    // Send only fields that changed, so untouched fields aren't marked as user-edited
    const next: PersonUpdate = {
      full_name: nul(v.full_name), job_title: nul(v.job_title), company: nul(v.company), industry: nul(v.industry),
      years_experience: v.years_experience === "" ? null : Number(v.years_experience),
      programming_languages: splitList(v.programming_languages), skills: splitList(v.skills),
      city: nul(v.city), state: nul(v.state), freelance_available: v.freelance === "" ? null : v.freelance === "true",
      category: nul(v.category), tags: splitList(v.tags), notes: nul(v.notes),
    };
    const body: PersonUpdate = {};
    (Object.keys(next) as (keyof PersonUpdate)[]).forEach((k) => {
      if (JSON.stringify(next[k]) !== JSON.stringify((p as unknown as Record<string, unknown>)[k] ?? null)) {
        (body as Record<string, unknown>)[k] = next[k];
      }
    });
    try {
      onSaved(await api.updatePerson(p.id, body));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = (k: keyof typeof v, label: string, full = false) => (
    <label className="field" style={full ? { gridColumn: "1 / -1" } : undefined}>{label}<input value={v[k]} onChange={set(k)} /></label>
  );

  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ marginBottom: 4 }}>Edit record</h2>
      <div className="muted small" style={{ marginBottom: 12 }}>Edited fields are marked as user-provided and aren't overwritten by later searches.</div>
      <div className="edit-grid">
        {field("full_name", "Full name")}
        {field("job_title", "Title")}
        {field("company", "Company")}
        {field("industry", "Industry")}
        <label className="field">Years of experience<input type="number" min={0} max={70} value={v.years_experience} onChange={set("years_experience")} /></label>
        <label className="field">Freelance
          <select value={v.freelance} onChange={set("freelance")}>
            <option value="">Not stated</option><option value="true">Available</option><option value="false">Not available</option>
          </select>
        </label>
        {field("city", "City")}
        {field("state", "State")}
        {field("programming_languages", "Programming languages (comma-separated)", true)}
        {field("skills", "Skills (comma-separated)", true)}
        {field("category", "Category")}
        {field("tags", "Tags (comma-separated)")}
        <label className="field" style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={3} value={v.notes} onChange={set("notes")} /></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
