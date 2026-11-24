import { useEffect, useState } from "react";
import { api, type Count, type PeopleFilters, type PersonSummary } from "../api/client";
import { ExportButtons, PersonCard } from "../components/common";

const EMPTY: PeopleFilters = {
  q: "", platform: "", country: "", location: "", title: "", company: "", skill: "", language: "",
  min_years: "", max_years: "", freelance: "", has_contact: false, verified_only: false, tag: "", category: "",
};

export default function PeoplePage() {
  const [f, setF] = useState<PeopleFilters>(EMPTY);
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [tags, setTags] = useState<{ tags: Count[]; categories: Count[] }>({ tags: [], categories: [] });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PeopleFilters>(k: K, v: PeopleFilters[K]) => setF((cur) => ({ ...cur, [k]: v }));

  useEffect(() => {
    api.tags().then(setTags).catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      api.people(f).then(setPeople).catch((e) => setError((e as Error).message));
    }, 250);
    return () => window.clearTimeout(t);
  }, [f]);

  const text = (k: keyof PeopleFilters, label: string, placeholder = "") => (
    <label className="field">{label}
      <input value={(f[k] as string) ?? ""} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <div className="sub">Everyone discovered across all searches{people ? ` · ${people.length} shown` : ""}</div>
        </div>
        <ExportButtons href={(fmt) => api.exportUrl(fmt, f)} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters-grid" style={{ marginTop: 0 }}>
          {text("q", "Search", "Name, u/username, title, company")}
          {text("location", "City or state", "e.g. Austin")}
          {text("title", "Professional title", "e.g. AI engineer")}
          {text("company", "Company")}
          {text("skill", "Technical skill", "e.g. React")}
          {text("language", "Programming language", "e.g. Python")}
          <label className="field">Years of experience
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input type="number" min={0} placeholder="min" style={{ width: "50%" }} value={f.min_years ?? ""}
                     onChange={(e) => set("min_years", e.target.value === "" ? "" : Number(e.target.value))} />
              <input type="number" min={0} placeholder="max" style={{ width: "50%" }} value={f.max_years ?? ""}
                     onChange={(e) => set("max_years", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </label>
          <label className="field">Region
            <select value={f.country} onChange={(e) => set("country", e.target.value as PeopleFilters["country"])}>
              <option value="">US and Europe</option><option value="US">United States</option><option value="EU">Europe</option>
            </select>
          </label>
          <label className="field">Source
            <select value={f.platform} onChange={(e) => set("platform", e.target.value as PeopleFilters["platform"])}>
              <option value="">All</option><option value="quora">Quora</option><option value="medium">Medium</option><option value="reddit">Reddit</option>
            </select>
          </label>
          <label className="field">Freelance
            <select value={f.freelance} onChange={(e) => set("freelance", e.target.value as PeopleFilters["freelance"])}>
              <option value="">Any</option><option value="true">Available</option><option value="false">Not available</option>
            </select>
          </label>
          <label className="field">Tag
            <select value={f.tag} onChange={(e) => set("tag", e.target.value)}>
              <option value="">Any</option>
              {tags.tags.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
            </select>
          </label>
          <label className="field">Category
            <select value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Any</option>
              {tags.categories.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
            </select>
          </label>
          <div className="field" style={{ justifyContent: "flex-end", gap: 6 }}>
            <label className="check"><input type="checkbox" checked={!!f.has_contact} onChange={(e) => set("has_contact", e.target.checked)} />Has email</label>
            <label className="check"><input type="checkbox" checked={!!f.verified_only} onChange={(e) => set("verified_only", e.target.checked)} />Has verified profile</label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={() => setF(EMPTY)}>Clear filters</button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {people === null ? (
        <div className="progress muted"><span className="spinner" />Loading…</div>
      ) : people.length === 0 ? (
        <div className="card empty">No saved people match these filters.</div>
      ) : (
        <div className="people-grid">{people.map((p) => <PersonCard key={p.id} p={p} />)}</div>
      )}
    </>
  );
}
