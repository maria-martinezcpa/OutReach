import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FIELDS, counted, emptyExtra, extraCount, extraMatches, textMatches, type Extra, type Field } from '../filters'
import type { Profile } from '../types'
import { latestScan, useFollowerScans } from '../useFollowerScans'
import { setSeen, useSeen } from '../useSeen'
import DraftEmailButton from './DraftEmailButton'
import ScanFollowersButton from './ScanFollowersButton'
import TelegramHandle from './TelegramHandle'
import { ConfidenceBadge, formatDate } from './ui'

type Sort = 'found' | 'commits' | 'contacts' | 'followers' | 'name'
type Contact = 'email' | 'phone' | 'linkedin' | 'telegram'
type Want = 'any' | 'has' | 'none'

const CONTACTS: { key: Contact; label: string; has: (p: Profile) => boolean }[] = [
  { key: 'email', label: 'Email', has: (p) => p.contacts.emails.length > 0 },
  { key: 'phone', label: 'Phone', has: (p) => p.contacts.phones.length > 0 },
  { key: 'linkedin', label: 'LinkedIn', has: (p) => !!p.contacts.linkedin },
  { key: 'telegram', label: 'Telegram', has: (p) => !!p.contacts.telegram },
]

const PAGE = 200 // rows rendered at a time; "Show more" adds the next page

const emailsOf = (p: Profile) => p.contacts.emails.map((e) => e.value.toLowerCase())
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1)

/** Email domains in the list, most common first, counted once per person. */
function emailDomains(profiles: Profile[]): { domain: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of profiles) for (const d of new Set(emailsOf(p).map(domainOf))) counts.set(d, (counts.get(d) ?? 0) + 1)
  return [...counts].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

const contactCount = (p: Profile) =>
  p.contacts.emails.length + p.contacts.phones.length + (p.contacts.linkedin ? 1 : 0) + (p.contacts.telegram ? 1 : 0) + (p.contacts.website ? 1 : 0)

interface Props {
  profiles: Profile[]
  onToggleSave: (p: Profile) => void
  busy?: string | null
  /** When given, rows get checkboxes and a "Remove selected" button that deletes these people's stored data. */
  onRemove?: (logins: string[]) => Promise<void>
}

export default function ResultsTable({ profiles, onToggleSave, busy, onRemove }: Props) {
  const [filter, setFilter] = useState('')
  const [field, setField] = useState<Field>('all')
  const [extra, setExtra] = useState<Extra>(emptyExtra)
  const [showMore, setShowMore] = useState(false)
  const [sort, setSort] = useState<Sort>('found')
  const [want, setWant] = useState<Record<Contact, Want>>({ email: 'any', phone: 'any', linkedin: 'any', telegram: 'any' })
  const [emailText, setEmailText] = useState('')
  const [emailDomain, setEmailDomain] = useState('') // '' any, '__none' no email, else a domain
  const [limit, setLimit] = useState(PAGE)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [seenFilter, setSeenFilter] = useState<'all' | 'new' | 'seen'>('all')
  const seen = useSeen()
  const isSeen = (p: Profile) => p.login.toLowerCase() in seen
  const scans = useFollowerScans()
  const [scanFilter, setScanFilter] = useState<'all' | 'scanned' | 'not'>('all')
  const isScanned = (p: Profile) => !!latestScan(scans, p.login)
  const [removing, setRemoving] = useState(false)
  const domains = useMemo(() => emailDomains(profiles), [profiles])
  const countries = useMemo(() => counted(profiles.map((p) => p.country ?? '')), [profiles])
  const languages = useMemo(() => counted(profiles.flatMap((p) => [...new Set(p.languages)])), [profiles])
  const setX = <K extends keyof Extra>(k: K, v: Extra[K]) => setExtra((x) => ({ ...x, [k]: v }))

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const et = emailText.trim().toLowerCase()
    const out = profiles.filter((p) => {
      if (seenFilter !== 'all' && (p.login.toLowerCase() in seen) !== (seenFilter === 'seen')) return false
      if (scanFilter !== 'all' && !!latestScan(scans, p.login) !== (scanFilter === 'scanned')) return false
      const emails = emailsOf(p)
      if (emailDomain === '__none' ? emails.length > 0 : emailDomain && !emails.some((e) => domainOf(e) === emailDomain)) return false
      if (et && !emails.some((e) => e.includes(et))) return false
      if (CONTACTS.some((c) => want[c.key] !== 'any' && c.has(p) !== (want[c.key] === 'has'))) return false
      if (!extraMatches(p, extra)) return false
      return textMatches(p, field, q)
    })
    switch (sort) {
      case 'commits':
        return out.sort((a, b) => (b.period_activity?.commits ?? 0) - (a.period_activity?.commits ?? 0))
      case 'contacts':
        return out.sort((a, b) => contactCount(b) - contactCount(a))
      case 'followers':
        return out.sort((a, b) => b.followers - a.followers)
      case 'name':
        return out.sort((a, b) => (a.name || a.login).localeCompare(b.name || b.login))
      default:
        return out
    }
  }, [profiles, filter, field, extra, sort, want, emailText, emailDomain, seenFilter, seen, scanFilter, scans])

  // Only people still in the list count as ticked (others may have been removed or filtered by the parent).
  const present = new Set(profiles.map((p) => p.login))
  const selected = [...ticked].filter((l) => present.has(l))
  const allRowsTicked = rows.length > 0 && rows.every((p) => ticked.has(p.login))
  const toggle = (login: string) =>
    setTicked((t) => {
      const next = new Set(t)
      if (next.has(login)) next.delete(login)
      else next.add(login)
      return next
    })

  async function removeSelected() {
    if (!onRemove || !selected.length) return
    const n = selected.length
    if (!confirm(`Remove ${n} ${n === 1 ? 'person' : 'people'} from your data?\n\nThis deletes them from every search's results, the profile cache and your Saved list. It can't be undone.`)) return
    setRemoving(true)
    try {
      await onRemove(selected)
      setTicked(new Set())
    } finally {
      setRemoving(false)
    }
  }

  function clearFilters() {
    setFilter('')
    setField('all')
    setExtra(emptyExtra)
    setEmailText('')
    setEmailDomain('')
    setWant({ email: 'any', phone: 'any', linkedin: 'any', telegram: 'any' })
    setSeenFilter('all')
    setScanFilter('all')
  }
  const anyFilter = !!filter.trim() || extraCount(extra) > 0 || !!emailText.trim() || !!emailDomain ||
    Object.values(want).some((w) => w !== 'any') || seenFilter !== 'all' || scanFilter !== 'all'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex min-w-72 flex-1">
          <select aria-label="Search in" value={field} onChange={(e) => setField(e.target.value as Field)}
            className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2 py-1.5">
            {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <input
            aria-label="Filter list"
            placeholder={field === 'all' ? 'Filter by name, email, company, skill, location…' : `${FIELDS.find((f) => f.value === field)!.label} contains…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-w-0 flex-1 rounded-r-lg border border-slate-300 px-3 py-1.5"
          />
        </div>
        <input
          aria-label="Filter by email"
          placeholder="Email contains… e.g. @gmail.com"
          value={emailText}
          onChange={(e) => setEmailText(e.target.value)}
          className="w-56 rounded-lg border border-slate-300 px-3 py-1.5"
        />
        <select aria-label="Email domain" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)}
          className="max-w-56 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
          <option value="">Any email domain</option>
          <option value="__none">No email</option>
          {domains.slice(0, 50).map((d) => <option key={d.domain} value={d.domain}>{d.domain} ({d.count})</option>)}
        </select>
        {CONTACTS.map((c) => {
          const n = profiles.filter(c.has).length
          return (
            <select
              key={c.key}
              aria-label={`${c.label} filter`}
              value={want[c.key]}
              onChange={(e) => setWant({ ...want, [c.key]: e.target.value as Want })}
              className={`rounded-lg border px-2 py-1.5 ${want[c.key] === 'any' ? 'border-slate-300 bg-white' : 'border-indigo-400 bg-indigo-50 text-indigo-800'}`}
            >
              <option value="any">{c.label}: any</option>
              <option value="has">Has {c.label} ({n})</option>
              <option value="none">No {c.label} ({profiles.length - n})</option>
            </select>
          )
        })}
        <select aria-label="Seen filter" value={seenFilter} onChange={(e) => setSeenFilter(e.target.value as typeof seenFilter)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
          <option value="all">New and seen</option>
          <option value="new">New only ({profiles.filter((p) => !isSeen(p)).length})</option>
          <option value="seen">Seen only ({profiles.filter(isSeen).length})</option>
        </select>
        <select aria-label="Followers scan filter" value={scanFilter} onChange={(e) => setScanFilter(e.target.value as typeof scanFilter)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
          <option value="all">Followers: any</option>
          <option value="scanned">Followers scanned ({profiles.filter(isScanned).length})</option>
          <option value="not">Followers not scanned ({profiles.filter((p) => !isScanned(p)).length})</option>
        </select>
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore(!showMore)}
          className={`rounded-lg border px-3 py-1.5 ${extraCount(extra) ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          More filters{extraCount(extra) ? ` (${extraCount(extra)})` : ''} {showMore ? '▴' : '▾'}
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" aria-label="Sort list">
          <option value="found">Order found</option>
          <option value="commits">Commits in period</option>
          <option value="contacts">Most contact info</option>
          <option value="followers">Followers</option>
          <option value="name">Name</option>
        </select>
      </div>
      {showMore && (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="More filters">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Country</span>
            <select aria-label="Country" value={extra.country} onChange={(e) => setX('country', e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5">
              <option value="">Any country</option>
              {countries.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Language</span>
            <select aria-label="Language" value={extra.language} onChange={(e) => setX('language', e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5">
              <option value="">Any language</option>
              {languages.slice(0, 80).map((l) => <option key={l.value} value={l.value}>{l.value} ({l.count})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Human confidence</span>
            <select aria-label="Human confidence" value={extra.confidence} onChange={(e) => setX('confidence', e.target.value as Extra['confidence'])}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5">
              <option value="">Any</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="INSUFFICIENT_DATA">Insufficient data</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Activity</span>
            <select aria-label="Activity" value={extra.activity} onChange={(e) => setX('activity', e.target.value as Extra['activity'])}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5">
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="MODERATE">Moderate</option>
              <option value="INACTIVE">Inactive</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          {([['Followers', 'minFollowers', 'maxFollowers'], ['Public repos', 'minRepos', 'maxRepos']] as const).map(([label, lo, hi]) => (
            <div key={label}>
              <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} aria-label={`${label} min`} placeholder="min" value={extra[lo]}
                  onChange={(e) => setX(lo, e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5" />
                <span className="text-slate-400">–</span>
                <input type="number" min={0} aria-label={`${label} max`} placeholder="max" value={extra[hi]}
                  onChange={(e) => setX(hi, e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5" />
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 self-end pb-1.5 text-slate-700">
            <input type="checkbox" className="accent-indigo-600" checked={extra.hireable} onChange={(e) => setX('hireable', e.target.checked)} />
            Open to hire only
          </label>
          <div className="flex items-end justify-end">
            <button type="button" className="text-sm text-indigo-700 hover:underline" onClick={clearFilters}>Clear all filters</button>
          </div>
        </div>
      )}
      {onRemove && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" className="accent-indigo-600" aria-label="Tick all matching" checked={allRowsTicked}
              onChange={() => setTicked(allRowsTicked ? new Set() : new Set(rows.map((p) => p.login)))} />
            Tick all {rows.length} matching
          </label>
          {selected.length > 0 && <span className="text-slate-500">{selected.length} ticked</span>}
          <button
            className="ml-auto rounded-lg border border-rose-200 bg-white px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            disabled={!selected.length || removing}
            onClick={removeSelected}
          >
            {removing ? 'Removing…' : `Remove selected (${selected.length})`}
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        {rows.length === profiles.length ? `Showing all ${profiles.length}` : `${rows.length} of ${profiles.length} match`}
        {anyFilter && (
          <>
            {' · '}
            <button className="text-indigo-700 hover:underline" onClick={clearFilters}>Clear filters</button>
          </>
        )}
        {rows.length > limit && ` · first ${limit} listed`}
        {rows.some((p) => !isSeen(p)) && (
          <>
            {' · '}
            <button className="text-indigo-700 hover:underline" onClick={() => setSeen(rows.map((p) => p.login))}>
              Mark all {rows.length} matching as seen
            </button>
          </>
        )}
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {onRemove && <th className="w-8 px-3 py-2" />}
              <th className="w-10 px-3 py-2">#</th>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Skills</th>
              <th className="px-3 py-2">Commits (last)</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, limit).map((p) => {
              const c = p.contacts
              return (
                <tr key={p.id} className={`align-top hover:bg-slate-50/60 ${ticked.has(p.login) ? 'bg-indigo-50/40' : isSeen(p) ? 'bg-rose-50/60' : ''}`}>
                  {onRemove && (
                    <td className="px-3 py-2.5">
                      <input type="checkbox" className="accent-indigo-600" aria-label={`Tick ${p.login}`}
                        checked={ticked.has(p.login)} onChange={() => toggle(p.login)} />
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-xs text-slate-400">{profiles.indexOf(p) + 1}</td>
                  <td className="px-3 py-2.5">
                    <Link to={`/profile/${p.login}`} className="flex items-center gap-2.5">
                      <img src={p.avatar_url || ''} alt="" className="size-8 rounded-full bg-slate-100" loading="lazy" />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900 hover:text-indigo-700">
                          {p.name || p.login}
                          {isSeen(p) ? (
                            <span title={`Seen ${new Date(seen[p.login.toLowerCase()]).toLocaleString()}`}
                              className="ml-1.5 rounded bg-rose-600 px-1.5 py-px text-[10px] font-semibold uppercase text-white">Seen</span>
                          ) : (
                            <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-px text-[10px] font-semibold uppercase text-emerald-800">New</span>
                          )}
                          {isScanned(p) && (
                            <span title="Their followers have been scanned"
                              className="ml-1 rounded bg-purple-600 px-1.5 py-px text-[10px] font-semibold uppercase text-white">Followers scanned</span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-500">
                          @{p.login}
                          {p.roles[0] && ` · ${p.roles[0].title}`}
                        </span>
                        {p.found_in && p.found_in.length > 0 && (
                          <span className="block text-[11px] text-slate-400" title={p.found_in.join('\n')}>
                            Found in: {p.found_in.slice(0, 2).join(', ')}{p.found_in.length > 2 && ` +${p.found_in.length - 2}`}
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="space-y-0.5 px-3 py-2.5 text-xs">
                    {c.emails.map((e) => (
                      <a key={e.value} href={`mailto:${e.value}`} className="block text-indigo-700 hover:underline">{e.value}</a>
                    ))}
                    {c.phones.map((x) => <div key={x.value}>{x.value}</div>)}
                    <div className="flex flex-wrap gap-2">
                      {c.linkedin && <a href={c.linkedin.value} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">LinkedIn</a>}
                      {c.telegram && <TelegramHandle url={c.telegram.value} />}
                      {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">Website</a>}
                      <a href={p.github_url} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">GitHub</a>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {p.location || '—'}
                    {p.country && <div className="text-slate-500">{p.country}</div>}
                    {(p.region || p.continent) && <div className="text-slate-400">{p.region ?? p.continent}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {p.matched_keywords && p.matched_keywords.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1">
                        {p.matched_keywords.map((k) => (
                          <span key={k} title="Matched search keyword" className="rounded bg-emerald-50 px-1 font-medium text-emerald-800">{k}</span>
                        ))}
                      </div>
                    )}
                    {p.analysis.skills.slice(0, 4).map((s) => s.name).join(', ')}
                  </td>
                  <td className="px-3 py-2.5 text-xs" title={p.period_activity?.source}>
                    {p.period_activity ? `${p.period_activity.commits}${p.period_activity.commits_capped ? '+' : ''}` : '—'}
                    {p.period_activity?.last_commit_at && <div className="text-slate-500">{formatDate(p.period_activity.last_commit_at)}</div>}
                  </td>
                  <td className="px-3 py-2.5"><ConfidenceBadge value={p.analysis.human_confidence} /></td>
                  <td className="space-y-1 px-3 py-2.5 text-right">
                    <button
                      onClick={() => {
                        setSeen([p.login])
                        onToggleSave(p)
                      }}
                      disabled={busy === p.login}
                      className={`whitespace-nowrap text-xs font-medium ${p.saved ? 'text-amber-600' : 'text-indigo-700'} hover:underline disabled:opacity-50`}
                    >
                      {p.saved ? '★ Saved' : '☆ Save'}
                    </button>
                    <div>
                      <button className={`whitespace-nowrap text-xs font-medium hover:underline ${isSeen(p) ? 'text-slate-500' : 'text-rose-600'}`}
                        onClick={() => setSeen([p.login], !isSeen(p))}>
                        {isSeen(p) ? 'Mark new' : 'Mark seen'}
                      </button>
                    </div>
                    <div>
                      <DraftEmailButton profile={p} compact />
                    </div>
                    <div>
                      <ScanFollowersButton profile={p} compact />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="text-center">
          <button className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} not shown)
          </button>
        </div>
      )}
    </div>
  )
}
