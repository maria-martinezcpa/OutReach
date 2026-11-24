export type QueryType = "name" | "profession" | "skills" | "company" | "url" | "keywords";
export type Source = "quora" | "medium" | "reddit";
export type Region = "US" | "EU";
export const REGION_LABEL: Record<string, string> = { US: "United States", EU: "Europe" };
export type MatchStatus = "anchor" | "verified" | "self_reported" | "possible";

export interface SearchRequest {
  query: string;
  query_type: QueryType;
  sources: Source[];
  company?: string | null;
  profession?: string | null;
  skills?: string[];
  state?: string | null;
  regions?: Region[];
  require_contact?: boolean;
  subreddits?: string[];
  max_candidates?: number | null;
}

export interface Search {
  id: number;
  query: string;
  query_type: QueryType;
  sources: Source[];
  filters: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  message: string | null;
  candidates_found: number;
  excluded_non_us: number;
  excluded_no_contact: number | null;
  result_count: number;
  created_at: string;
  finished_at: string | null;
}

interface PersonBase {
  id: number;
  display_name: string;
  source_platform: Source;
  full_name: string | null;
  reddit_username: string | null;
  job_title: string | null;
  company: string | null;
  industry: string | null;
  years_experience: number | null;
  skills: string[];
  programming_languages: string[];
  freelance_available: boolean | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  confidence: number;
  category: string | null;
  tags: string[];
  updated_at: string;
}

export interface PersonSummary extends PersonBase {
  profile_count: number;
  verified_count: number;
  contact_count: number;
}

export interface Profile {
  id: number;
  platform: string;
  url: string;
  title: string | null;
  snippet: string | null;
  match_status: MatchStatus;
  match_score: number;
  match_reasons: string[];
  source_url: string | null;
  discovered_at: string;
}

export interface Contact {
  id: number;
  kind: string;
  value: string;
  is_business: boolean;
  source_url: string;
  evidence: string | null;
  verification_status: "verified" | "possible";
  provenance: "self_reported" | "independently_verified";
  discovered_at: string;
}

export interface PersonDetail extends PersonBase {
  experience: string | null;
  interests: string[];
  location_evidence: string | null;
  missing_fields: string[];
  conflicts: string[];
  notes: string | null;
  edited_fields: string[];
  ai_summary: string | null;
  created_at: string;
  profiles: Profile[];
  contacts: Contact[];
}

export type PersonUpdate = Partial<{
  full_name: string | null;
  job_title: string | null;
  company: string | null;
  industry: string | null;
  experience: string | null;
  years_experience: number | null;
  skills: string[];
  programming_languages: string[];
  interests: string[];
  freelance_available: boolean | null;
  city: string | null;
  state: string | null;
  category: string | null;
  tags: string[];
  notes: string | null;
}>;

export interface Stats {
  people: number;
  verified_profiles: number;
  possible_profiles: number;
  emails: number;
  searches: number;
}

export interface Count {
  name: string;
  count: number;
}

export interface Analytics {
  by_platform: Count[];
  by_state: Count[];
  top_skills: Count[];
  top_languages: Count[];
  profile_status: Count[];
  contact_provenance: Count[];
  freelance: { available: number; not_stated: number };
  with_contact: number;
  confidence_histogram: Count[];
  searches_per_day: Count[];
  total_people: number;
}

export interface Health {
  reddit_configured: boolean;
  reddit_mode: "api" | "search";
  ai_mode: "claude" | "rules";
  search_provider: string;
  background: string;
  default_subreddits: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PeopleFilters {
  q?: string;
  platform?: Source | "";
  country?: Region | "";
  location?: string;
  title?: string;
  company?: string;
  industry?: string;
  skill?: string;
  language?: string;
  min_years?: number | "";
  max_years?: number | "";
  freelance?: "true" | "false" | "";
  has_contact?: boolean;
  verified_only?: boolean;
  tag?: string;
  category?: string;
  search_id?: number;
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const body = await r.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export function qs(params: object): string {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export interface AppSettings {
  editable: boolean;
  values: Record<string, string>;
  configured: Record<string, boolean>;
  search_ready: boolean;
  active_provider: string;
  ai_active: "claude" | "rules";
}

export const api = {
  settings: () => req<AppSettings>("/api/settings"),
  saveSettings: (values: Record<string, string>) => req<AppSettings>("/api/settings", json("PUT", values)),
  health: () => req<Health>("/api/health"),
  stats: () => req<Stats>("/api/stats"),
  analytics: () => req<Analytics>("/api/analytics"),
  tags: () => req<{ tags: Count[]; categories: Count[] }>("/api/tags"),
  createSearch: (body: SearchRequest) => req<Search>("/api/searches", json("POST", body)),
  searches: () => req<Search[]>("/api/searches"),
  search: (id: number) => req<Search & { people: PersonSummary[] }>(`/api/searches/${id}`),
  deleteSearch: (id: number) => req<void>(`/api/searches/${id}`, { method: "DELETE" }),
  people: (f: PeopleFilters = {}) => req<PersonSummary[]>(`/api/people${qs(f)}`),
  duplicates: () => req<{ reason: string; people: PersonSummary[] }[]>("/api/people/duplicates"),
  person: (id: number) => req<PersonDetail>(`/api/people/${id}`),
  updatePerson: (id: number, body: PersonUpdate) => req<PersonDetail>(`/api/people/${id}`, json("PATCH", body)),
  mergePeople: (keepId: number, otherId: number) =>
    req<PersonDetail>(`/api/people/${keepId}/merge`, json("POST", { other_id: otherId })),
  deletePerson: (id: number) => req<void>(`/api/people/${id}`, { method: "DELETE" }),
  rejectProfile: (pid: number, profileId: number) =>
    req<void>(`/api/people/${pid}/profiles/${profileId}`, { method: "DELETE" }),
  deleteContact: (pid: number, contactId: number) =>
    req<void>(`/api/people/${pid}/contacts/${contactId}`, { method: "DELETE" }),
  summarize: (id: number) => req<PersonDetail>(`/api/people/${id}/summary`, { method: "POST" }),
  assistant: (person_id: number | null, messages: ChatMessage[]) =>
    req<{ reply: string }>("/api/assistant", json("POST", { person_id, messages })),
  redditSync: () => req<{ removed: number }>("/api/maintenance/reddit-sync", { method: "POST" }),
  exportUrl: (format: "csv" | "xlsx", f: PeopleFilters & { ids?: string } = {}) =>
    `${BASE}/api/export${qs({ format, ...f })}`,
};
