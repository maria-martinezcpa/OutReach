import { Link } from "react-router-dom";
import { REGION_LABEL, type PersonSummary } from "../api/client";

export function initials(name: string): string {
  return name
    .replace(/^u\//, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const STATUS_LABEL: Record<string, string> = {
  anchor: "Original source",
  verified: "Verified",
  self_reported: "Self-reported",
  possible: "Possible match",
  independently_verified: "Independently verified",
  done: "Done",
  running: "Running",
  pending: "Queued",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function SourceBadge({ source }: { source: string }) {
  return <span className={`badge src-${source}`}>{({ quora: "Quora", medium: "Medium", reddit: "Reddit" } as Record<string, string>)[source] ?? source}</span>;
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const level = pct >= 70 ? "high" : pct >= 45 ? "mid" : "low";
  return (
    <span className="confidence" title="How well this record is supported by traceable public sources">
      <span className="meter"><span className={`fill ${level}`} style={{ width: `${pct}%` }} /></span>
      <span className="small muted">{pct}%</span>
    </span>
  );
}

export function PersonCard({ p }: { p: PersonSummary }) {
  const tech = [...p.programming_languages, ...p.skills.filter((s) => !p.programming_languages.includes(s))];
  return (
    <Link to={`/people/${p.id}`} className="card person-card">
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="avatar">{initials(p.display_name)}</div>
        <div className="grow">
          <h3 className="truncate">{p.display_name}</h3>
          <div className="muted small truncate">
            {[p.job_title, p.company].filter(Boolean).join(" · ") || "Role not stated"}
          </div>
        </div>
        <SourceBadge source={p.source_platform} />
      </div>
      <div className="muted small">
        {p.location ?? REGION_LABEL[p.country ?? ""] ?? "Location not stated"}
        {p.country && <span className={`badge region-${p.country}`} style={{ marginLeft: 6 }}>{p.country === "EU" ? "Europe" : "US"}</span>}
        {p.years_experience != null ? ` · ${p.years_experience} yrs` : ""}
        {p.freelance_available ? " · Open to freelance" : ""}
      </div>
      {tech.length > 0 && (
        <div className="chips">
          {tech.slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}
        </div>
      )}
      {p.tags.length > 0 && (
        <div className="chips">{p.tags.map((t) => <span key={t} className="chip tag">#{t}</span>)}</div>
      )}
      <div className="row small">
        <span className="badge verified">{p.verified_count} verified</span>
        <span className="badge self_reported">{p.profile_count - p.verified_count} unconfirmed</span>
        <span className="badge">{p.contact_count} contact{p.contact_count === 1 ? "" : "s"}</span>
        <span className="grow" />
        <Confidence value={p.confidence} />
      </div>
    </Link>
  );
}

export function ExportButtons({ href }: { href: (f: "csv" | "xlsx") => string }) {
  return (
    <div className="row">
      <a className="btn sm" href={href("csv")}>Export CSV</a>
      <a className="btn sm" href={href("xlsx")}>Export Excel</a>
    </div>
  );
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
