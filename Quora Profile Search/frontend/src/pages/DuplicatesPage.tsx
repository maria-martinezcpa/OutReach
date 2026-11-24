import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PersonSummary } from "../api/client";
import { Confidence, SourceBadge } from "../components/common";

type Group = { reason: string; people: PersonSummary[] };

export default function DuplicatesPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.duplicates().then(setGroups).catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  async function merge(keep: PersonSummary, other: PersonSummary) {
    if (!confirm(`Merge "${other.display_name}" into "${keep.display_name}"? Empty fields are filled in and all sources are kept.`)) return;
    try {
      await api.mergePeople(keep.id, other.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Possible duplicates</h1>
          <div className="sub">Records that share a profile URL, an email, or the same name and company. Review them before merging.</div>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {groups === null ? (
        <div className="progress muted"><span className="spinner" />Checking…</div>
      ) : groups.length === 0 ? (
        <div className="card empty">No likely duplicates found.</div>
      ) : (
        <div className="stack">
          {groups.map((g, i) => (
            <div key={i} className="card">
              <div className="section-label" style={{ marginTop: 0 }}>{g.reason}</div>
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {g.people.map((p, j) => (
                  <div key={p.id} className="profile-item">
                    <div className="row">
                      <Link to={`/people/${p.id}`} className="grow"><strong>{p.display_name}</strong></Link>
                      <SourceBadge source={p.source_platform} />
                      <Confidence value={p.confidence} />
                    </div>
                    <div className="small muted">{[p.job_title, p.company, p.location].filter(Boolean).join(" · ") || "No details"}</div>
                    {j > 0 && (
                      <div><button className="btn sm" onClick={() => merge(g.people[0]!, p)}>Merge into {g.people[0]!.display_name}</button></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
