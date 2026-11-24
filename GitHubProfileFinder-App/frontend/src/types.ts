export type HumanConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA'
export type ActivityStatus = 'ACTIVE' | 'MODERATE' | 'INACTIVE' | 'UNKNOWN'
export type Level = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ContactItem {
  value: string
  source: string
}

export interface LinkItem {
  label: string
  url: string
  source: string
}

export interface Contacts {
  emails: ContactItem[]
  phones: ContactItem[]
  linkedin: ContactItem | null
  telegram?: ContactItem | null
  website: string | null
  links: LinkItem[]
}

export interface Repo {
  id: number
  name: string
  url: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  topics: string[]
  fork: boolean
  created_at: string | null
  pushed_at: string | null
}

export interface Skill {
  name: string
  confidence: number
  level: Level
  evidence_repos: string[]
  sources: string[]
  basis: string
}

export interface Signal {
  signal: string
  observation: string
  effect: 'supports' | 'against' | 'neutral'
}

export interface Analysis {
  human_confidence: HumanConfidence
  activity_status: ActivityStatus
  last_push: string | null
  skills: Skill[]
  evidence: Signal[]
  limitations: string[]
  method: string
}

export interface PeriodActivity {
  since: string | null
  until: string | null
  commits: number
  commits_capped: boolean
  repos: { name: string; commits: number }[]
  checked_repos: number
  last_commit_at: string | null
  source: string
}

export interface Profile {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
  github_url: string
  bio: string | null
  company: string | null
  location: string | null
  country: string | null
  region: string | null
  continent: string | null
  hireable: boolean | null
  type: string
  roles: { title: string; source: string }[]
  contacts: Contacts
  followers: number
  following: number
  public_repos: number
  created_at: string | null
  languages: string[]
  repositories: Repo[]
  analysis: Analysis
  fetched_at: string
  period_activity: PeriodActivity | null
  matched_keywords?: string[]
  found_in?: string[] // All accounts page: names of the searches that found this person
  saved: boolean
}

export interface SearchResponse {
  items: Profile[]
  page: number
  per_page: number
  total_candidates: number
  checked: number
  filtered_out: number
  failed: string[]
  query: string
  has_more: boolean
  warning: string | null
}

export type OutreachStatus = '' | 'to_contact' | 'drafted' | 'contacted' | 'replied' | 'not_interested'

export interface SavedEntry {
  login: string
  saved_at: string
  note: string
  status: OutreachStatus
  follow_up: string | null // YYYY-MM-DD
  updated_at: string | null
  profile: Profile
}

export interface HistoryEntry {
  at: string
  params: Partial<SearchForm>
  query: string
  results: number
}

export interface SearchForm {
  mode: 'repositories' | 'users' | 'commits' | 'followers'
  followers_of: string // followers mode: the account whose followers are scanned
  q: string // keyword being typed; it is added to `keywords` when searching
  keywords: string[]
  language: string
  location: string
  country: string
  region: string
  since: string
  until: string
  min_followers: string
  min_repos: string
  min_account_age_years: string
  require_email: boolean
  require_phone: boolean
  require_linkedin: boolean
  require_telegram: boolean
  require_website: boolean
  per_page: string
}

export const emptyForm: SearchForm = {
  mode: 'repositories',
  followers_of: '',
  q: '',
  keywords: [],
  language: '',
  location: '',
  country: '',
  region: '',
  since: '',
  until: '',
  min_followers: '',
  min_repos: '',
  min_account_age_years: '',
  require_email: false,
  require_phone: false,
  require_linkedin: false,
  require_telegram: false,
  require_website: false,
  per_page: '10',
}

export type JobStatus = 'running' | 'waiting' | 'paused' | 'completed' | 'failed'

export interface Job {
  id: string
  name: string
  query: string
  params: Partial<SearchForm>
  target: number
  status: JobStatus
  created_at: string
  updated_at: string
  next_page: number
  pages_done: number
  checked: number
  filtered_out: number
  failed: number
  total_candidates: number
  found: number
  wait_until: string | null
  message: string | null
}

export interface SearchProgress {
  candidates: number
  checked: number
  filtered_out: number
  found: number
  total_candidates: number
  query: string
}
