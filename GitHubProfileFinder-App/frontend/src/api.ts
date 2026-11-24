import type { HistoryEntry, Job, Profile, SavedEntry, SearchForm, SearchResponse } from './types'
import type { DraftSettings } from './draft'

export type SuggestField = 'keyword' | 'language' | 'location' | 'country' | 'region'

export interface Suggestion {
  value: string
  label?: string
  hint?: string
}

/** Quota as GitHub reported it on a real API response (x-ratelimit-* headers). */
export interface Quota {
  limit: number
  remaining: number
  reset: number
  used?: number
  observed_at?: number // unix seconds when GitHub reported it
}

/** How much of a GitHub rate-limit window has been used, and the bar colour for it. */
export function quotaUsage(q: Quota) {
  const used = q.used ?? Math.max(0, q.limit - q.remaining)
  const pct = Math.round((used / Math.max(q.limit, 1)) * 100)
  const bar = pct >= 90 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  return { used, pct, bar }
}

export interface TokenInfo {
  id: string
  label: string
  masked: string
  login: string | null
  source: 'app' | 'env' | 'github_app'
  active: boolean
  added_at: string | null
  valid: boolean | null
  error: string | null
  core: Quota | null
  search: Quota | null
}

export interface GitHubAppStatus {
  configured: boolean
  app_id?: string
  installation_id?: string | null
  app_name?: string | null
  account?: string | null
  token_expires_at?: string | null
  active?: boolean
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError('Cannot reach the backend. Is the API server running on port 8000?', 0)
  }
  if (!res.ok) {
    let detail: unknown
    try {
      detail = (await res.json()).detail
    } catch {
      /* non-JSON error body */
    }
    let message = `Request failed (${res.status})`
    if (typeof detail === 'string') message = detail
    else if (Array.isArray(detail) && detail[0]?.msg) message = `Invalid search: ${String(detail[0].msg).replace(/^Value error, /, '')}`
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

/** Keywords as sent to the backend: the chips plus whatever is still typed in the box. */
export function allKeywords(form: SearchForm): string[] {
  const out: string[] = []
  for (const k of [...(form.keywords ?? []), ...form.q.split(',')]) {
    const t = k.trim()
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out
}

function withKeywords(form: SearchForm): Omit<SearchForm, 'keywords'> & { keywords: string } {
  const followers_of = form.mode === 'followers' ? form.followers_of : ''
  return { ...form, q: '', keywords: allKeywords(form).join(','), followers_of }
}

export function toQuery(form: SearchForm, page: number): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(withKeywords(form))) {
    if (typeof value === 'boolean') {
      if (value) params.set(key, 'true')
    } else if (String(value).trim() !== '') {
      params.set(key, String(value).trim())
    }
  }
  params.set('page', String(page))
  return params.toString()
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  rateLimit: () => request<{ core: Quota | null; search: Quota | null }>('/rate-limit'),
  tokens: () => request<TokenInfo[]>('/tokens'),
  addToken: (token: string, label: string) => request<TokenInfo>('/tokens', json({ token, label })),
  activateToken: (id: string) => request(`/tokens/${id}/activate`, { method: 'POST' }),
  deleteToken: (id: string) => request(`/tokens/${id}`, { method: 'DELETE' }),
  githubApp: () => request<GitHubAppStatus>('/github-app'),
  setupGithubApp: (body: { app_id: string; installation_id: string; private_key: string }) =>
    request<GitHubAppStatus>('/github-app', { ...json(body), method: 'PUT' }),
  removeGithubApp: () => request('/github-app', { method: 'DELETE' }),
  health: () => request<{ status: string; github_token_configured: boolean }>('/health'),
  search: (form: SearchForm, page: number) => request<SearchResponse>(`/search?${toQuery(form, page)}`),
  profile: (login: string, refresh = false) =>
    request<Profile>(`/profiles/${encodeURIComponent(login)}${refresh ? '?refresh=true' : ''}`),
  deleteData: (login: string) => request(`/profiles/${encodeURIComponent(login)}`, { method: 'DELETE' }),
  saved: () => request<SavedEntry[]>('/saved'),
  accounts: () => request<Profile[]>('/accounts'),
  seen: () => request<Record<string, string>>('/seen'),
  setSeen: (logins: string[], seen: boolean) => request<{ changed: number }>('/seen', json({ logins, seen })),
  removeAccounts: (logins: string[]) =>
    request<{ accounts: number; search_results_removed: number; cache_removed: number; saved_removed: number }>(
      '/accounts/remove', json({ logins })),
  save: (login: string, note = '') => request<SavedEntry>(`/saved/${encodeURIComponent(login)}`, json({ note })),
  unsave: (login: string) => request(`/saved/${encodeURIComponent(login)}`, { method: 'DELETE' }),
  clearSaved: () => request<{ removed: number }>('/saved', { method: 'DELETE' }),
  savedSummary: () => request<{ total: number; follow_ups_due: number }>('/saved/summary'),
  draftSettings: () => request<DraftSettings>('/draft-settings'),
  saveDraftSettings: (s: DraftSettings) => request<DraftSettings>('/draft-settings', { ...json(s), method: 'PUT' }),
  openUrl: (url: string) => request<{ opened: boolean }>('/open-url', json({ url })),
  updateSaved: (login: string, changes: Partial<Pick<SavedEntry, 'note' | 'status' | 'follow_up'>>) =>
    request<SavedEntry>(`/saved/${encodeURIComponent(login)}`, { ...json(changes), method: 'PATCH' }),
  history: () => request<HistoryEntry[]>('/history'),
  clearHistory: () => request('/history', { method: 'DELETE' }),
  exportUrl: (fmt: 'csv' | 'json', logins?: string[]) =>
    `/api/export/${fmt}${logins?.length ? `?logins=${encodeURIComponent(logins.join(','))}` : ''}`,

  suggest: (field: SuggestField, q: string) =>
    request<Suggestion[]>(`/suggest?field=${field}&q=${encodeURIComponent(q)}`),
  searchStreamUrl: (form: SearchForm, page: number) => `/api/search/stream?${toQuery(form, page)}`,

  // Background searches
  createJob: (form: SearchForm, target: number) => request<Job>('/jobs', json({ ...formBody(form), target })),
  jobs: () => request<Job[]>('/jobs'),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  jobResults: (id: string, offset = 0) => request<Profile[]>(`/jobs/${id}/results?offset=${offset}`),
  pauseJob: (id: string) => request<Job>(`/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id: string, extra = 0) => request<Job>(`/jobs/${id}/resume?extra=${extra}`, { method: 'POST' }),
  wakeJob: (id: string) => request<Job>(`/jobs/${id}/wake`, { method: 'POST' }),
  deleteJob: (id: string) => request(`/jobs/${id}`, { method: 'DELETE' }),
  saveAllJob: (id: string) => request<{ saved: number }>(`/jobs/${id}/save-all`, { method: 'POST' }),
  jobExportUrl: (id: string, fmt: 'csv' | 'json') => `/api/jobs/${id}/export/${fmt}`,
}

/** Search form as a JSON body: empty fields dropped, numbers converted. */
export function formBody(form: SearchForm): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(withKeywords(form))) {
    if (typeof value === 'boolean') body[key] = value
    else if (String(value).trim() !== '') body[key] = String(value).trim()
  }
  return body
}
