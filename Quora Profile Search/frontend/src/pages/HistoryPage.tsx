import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Search } from "../api/client";
import { StatusBadge, timeAgo } from "../components/common";

export default function HistoryPage() {
  const [items, setItems] = useState<Search[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.searches().then(setItems).catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  async function remove(id: number) {
    if (!confirm("Delete this search from history? Saved people are kept.")) return;
    await api.deleteSearch(id);
    load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Search history</h1>
          <div className="sub">Re-open earlier searches and their results.</div>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {items === null ? (
        <div className="progress muted"><span className="spinner" />Loading…</div>
      ) : items.length === 0 ? (
        <div className="card empty">No searches yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Query</th>
                <th>Type</th>
                <th>Status</th>
                <th className="hide-sm">Candidates</th>
                <th>US results</th>
                <th className="hide-sm">When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/searches/${s.id}`}>{s.query}</Link></td>
                  <td><span className="badge">{s.query_type}</span></td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="hide-sm">{s.candidates_found}{s.excluded_non_us ? <span className="muted small"> ({s.excluded_non_us} outside region{s.excluded_no_contact ? `, ${s.excluded_no_contact} no contact` : ""})</span> : null}</td>
                  <td>{s.result_count}</td>
                  <td className="hide-sm muted">{timeAgo(s.created_at)}</td>
                  <td><button className="btn sm danger" onClick={() => remove(s.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
