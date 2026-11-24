import { useEffect, useState } from "react";
import { api, type Analytics, type Count } from "../api/client";

const LABELS: Record<string, string> = {
  quora: "Quora", medium: "Medium", reddit: "Reddit", verified: "Verified", self_reported: "Self-reported", possible: "Possible match",
  independently_verified: "Independently verified",
};

/** Ranked horizontal bars: one series, one hue, values in text ink, hover tooltip per bar. */
function Bars({ title, data, note }: { title: string; data: Count[]; note?: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="card">
      <h2>{title}</h2>
      {note && <div className="small muted">{note}</div>}
      {data.length === 0 ? (
        <div className="muted small" style={{ marginTop: 12 }}>No data yet.</div>
      ) : (
        <div className="bars" role="table" aria-label={title}>
          {data.map((d) => (
            <div key={d.name} className="bar-row" role="row" title={`${LABELS[d.name] ?? d.name}: ${d.count}`}>
              <span className="bar-label truncate" role="cell">{LABELS[d.name] ?? d.name}</span>
              <span className="bar-track" role="presentation">
                <span className="bar-fill" style={{ width: `${(d.count / max) * 100}%` }} />
              </span>
              <span className="bar-value" role="cell">{d.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [a, setA] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.analytics().then(setA).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!a) return <div className="progress muted"><span className="spinner" />Loading…</div>;

  const pct = (n: number) => (a.total_people ? `${Math.round((n / a.total_people) * 100)}%` : "–");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">What's in the contact database and how well it's verified.</div>
        </div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="card stat"><div className="label">People</div><div className="value">{a.total_people}</div></div>
        <div className="card stat"><div className="label">With email</div><div className="value">{a.with_contact}</div><div className="small muted">{pct(a.with_contact)} of people</div></div>
        <div className="card stat"><div className="label">Open to freelance</div><div className="value">{a.freelance.available}</div><div className="small muted">{a.freelance.not_stated} didn't say</div></div>
        <div className="card stat"><div className="label">Searches (30 days)</div><div className="value">{a.searches_per_day.reduce((s, d) => s + d.count, 0)}</div></div>
      </div>
      <div className="analytics-grid">
        <Bars title="People by source" data={a.by_platform} />
        <Bars title="Linked profiles by status" data={a.profile_status} note="Verified = explicit cross-link. Others are unconfirmed." />
        <Bars title="Contacts by provenance" data={a.contact_provenance} />
        <Bars title="Confidence score" data={a.confidence_histogram} note="Share of each record supported by traceable sources." />
        <Bars title="Top states" data={a.by_state} />
        <Bars title="Top programming languages" data={a.top_languages} />
        <Bars title="Top skills" data={a.top_skills} />
        <Bars title="Searches per day" data={a.searches_per_day} />
      </div>
    </>
  );
}
