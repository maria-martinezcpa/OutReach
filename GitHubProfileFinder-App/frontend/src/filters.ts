import type { ActivityStatus, HumanConfidence, Profile } from './types'

/** Which part of a profile the results search box looks in. */
export type Field = 'all' | 'name' | 'login' | 'email' | 'company' | 'location' | 'bio' | 'skills' | 'languages' | 'website'

export const FIELDS: { value: Field; label: string }[] = [
  { value: 'all', label: 'All fields' },
  { value: 'name', label: 'Name' },
  { value: 'login', label: 'Username' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
  { value: 'location', label: 'Location' },
  { value: 'bio', label: 'Bio' },
  { value: 'skills', label: 'Skills & roles' },
  { value: 'languages', label: 'Languages' },
  { value: 'website', label: 'Website & links' },
]

function fieldTexts(p: Profile, f: Exclude<Field, 'all'>): (string | null | undefined)[] {
  switch (f) {
    case 'name': return [p.name]
    case 'login': return [p.login]
    case 'email': return p.contacts.emails.map((e) => e.value)
    case 'company': return [p.company]
    case 'location': return [p.location, p.country, p.region, p.continent]
    case 'bio': return [p.bio]
    case 'skills': return [...p.roles.map((r) => r.title), ...p.analysis.skills.map((s) => s.name)]
    case 'languages': return p.languages
    case 'website': return [p.contacts.website, p.contacts.linkedin?.value, p.contacts.telegram?.value, ...p.contacts.links.map((l) => l.url)]
  }
}

/** Case-insensitive "contains" in the chosen field, or in any of them. */
export function textMatches(p: Profile, field: Field, q: string): boolean {
  if (!q) return true
  const fields = field === 'all' ? FIELDS.slice(1).map((f) => f.value as Exclude<Field, 'all'>) : [field]
  return fields.some((f) => fieldTexts(p, f).some((v) => !!v && v.toLowerCase().includes(q)))
}

export interface Extra {
  country: string
  language: string
  confidence: '' | HumanConfidence
  activity: '' | ActivityStatus
  minFollowers: string
  maxFollowers: string
  minRepos: string
  maxRepos: string
  hireable: boolean
}

export const emptyExtra: Extra = {
  country: '', language: '', confidence: '', activity: '',
  minFollowers: '', maxFollowers: '', minRepos: '', maxRepos: '', hireable: false,
}

/** How many of the extra filters are set (shown on the "More filters" toggle). */
export const extraCount = (x: Extra) =>
  Object.entries(x).filter(([k, v]) => (k === 'hireable' ? v === true : v !== '')).length

const num = (v: string) => (v.trim() === '' ? null : Number(v))

export function extraMatches(p: Profile, x: Extra): boolean {
  if (x.country && (p.country ?? '') !== x.country) return false
  if (x.language && !p.languages.includes(x.language)) return false
  if (x.confidence && p.analysis.human_confidence !== x.confidence) return false
  if (x.activity && p.analysis.activity_status !== x.activity) return false
  const [fMin, fMax, rMin, rMax] = [num(x.minFollowers), num(x.maxFollowers), num(x.minRepos), num(x.maxRepos)]
  if (fMin !== null && p.followers < fMin) return false
  if (fMax !== null && p.followers > fMax) return false
  if (rMin !== null && p.public_repos < rMin) return false
  if (rMax !== null && p.public_repos > rMax) return false
  if (x.hireable && !p.hireable) return false
  return true
}

/** Values present in the list with how many people have each, most common first. */
export function counted(values: string[]): { value: string; count: number }[] {
  const m = new Map<string, number>()
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
