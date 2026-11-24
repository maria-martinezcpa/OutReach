import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api'
import DraftEmailButton from '../components/DraftEmailButton'
import DraftQueue from '../components/DraftQueue'
import TelegramHandle from '../components/TelegramHandle'
import { Alert, ConfidenceBadge, EmptyState, Spinner, btnDanger, btnPrimary, btnSecondary, formatDate } from '../components/ui'
import { buildDraft, templateById } from '../draft'
import { openQueueDraft } from '../openDraft'
import { useSearch } from '../searchContext'
import type { OutreachStatus, SavedEntry } from '../types'
import { useDraftSettings } from '../useDraftSettings'

const STATUSES: { value: OutreachStatus; label: string }[] = [
  { value: '', label: '—' },
  { value: 'to_contact', label: 'To contact' },
  { value: 'drafted', label: 'Drafted' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'replied', label: 'Replied' },
  { value: 'not_interested', label: 'Not interested' },
]

const today = () => new Date().toISOString().slice(0, 10)

/** Follow-ups due today or earlier, unless the conversation is closed. */
const isDue = (e: SavedEntry) => !!e.follow_up && e.follow_up <= today() && e.status !== 'not_interested'

function Tracker({ entry, onChange }: { entry: SavedEntry; onChange: (changes: Partial<SavedEntry>) => void }) {
  const [note, setNote] = useState(entry.note)
  const [drafted, setDrafted] = useState(false)
  const due = isDue(entry)
  return (
    <div className="w-56 space-y-1.5">
      <div className="flex gap-1.5">
        <select
          aria-label={`Status for ${entry.login}`}
          value={entry.status}
          onChange={(e) => onChange({ status: e.target.value as OutreachStatus })}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input
          type="date"
          aria-label={`Follow-up date for ${entry.login}`}
          title="Follow-up date"
          value={entry.follow_up ?? ''}
          onChange={(e) => onChange({ follow_up: e.target.value || null })}
          className={`w-[7.5rem] rounded-md border px-1.5 py-1 text-xs ${due ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white'}`}
        />
      </div>
      <textarea
        aria-label={`Notes for ${entry.login}`}
        placeholder="Notes"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== entry.note && onChange({ note })}
        className="w-full resize-y rounded-md border border-slate-300 px-1.5 py-1 text-xs"
      />
      {due && <div className="text-[11px] font-medium text-amber-700">Follow-up due</div>}
      <div className="flex flex-wrap items-center gap-2">
        <DraftEmailButton profile={entry.profile} compact onDrafted={() => setDrafted(true)} />
        {drafted && entry.status !== 'contacted' && entry.status !== 'drafted' && (
          <button
            className="text-xs font-medium text-indigo-700 hover:underline"
            onClick={() => {
              onChange({ status: 'drafted' })
              setDrafted(false)
            }}
          >
            Saved to Drafts
          </button>
        )}
        {drafted && entry.status !== 'contacted' && (
          <button
            className="text-xs font-medium text-emerald-700 hover:underline"
            onClick={() => {
              onChange({ status: 'contacted' })
              setDrafted(false)
            }}
          >
            Sent it? Mark contacted
          </button>
        )}
      </div>
    </div>
  )
}

export default function SavedPage() {
  const [entries, setEntries] = useState<SavedEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | OutreachStatus>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<SavedEntry[] | null>(null)
  const [queueTemplate, setQueueTemplate] = useState('')
  const settings = useDraftSettings()
  const { updateProfile } = useSearch()

  useEffect(() => {
    api.saved().then(setEntries).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
  }, [])

  async function remove(login: string) {
    await api.unsave(login)
    updateProfile(login, { saved: false })
    setEntries((es) => es?.filter((e) => e.login !== login) ?? null)
    window.dispatchEvent(new Event('saved-changed'))
  }

  async function track(login: string, changes: Partial<SavedEntry>) {
    setEntries((es) => es?.map((e) => (e.login === login ? { ...e, ...changes } : e)) ?? null)
    try {
      const updated = await api.updateSaved(login, changes)
      setEntries((es) => es?.map((e) => (e.login === login ? updated : e)) ?? null)
      window.dispatchEvent(new Event('saved-changed'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the change')
    }
  }

  async function clearAll() {
    if (!confirm('Remove all saved profiles?')) return
    await api.clearSaved()
    entries?.forEach((e) => updateProfile(e.login, { saved: false }))
    setEntries([])
    window.dispatchEvent(new Event('saved-changed'))
  }

  if (error) return <Alert>{error}</Alert>
  if (!entries) return <Spinner label="Loading saved profiles…" />

  const q = filter.toLowerCase()
  const dueCount = entries.filter(isDue).length
  const shown = entries.filter((e) =>
    (statusFilter === 'all' || (statusFilter === 'due' ? isDue(e) : e.status === statusFilter)) &&
    [e.login, e.profile.name, e.profile.location, e.profile.country, e.profile.region, e.profile.continent, e.profile.company, ...e.profile.analysis.skills.map((s) => s.name)]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q)),
  )

  // Draft queue: the ticked people, or else everyone shown who has not been drafted or contacted yet.
  const templateId = settings ? templateById(settings, queueTemplate || undefined).id : ''
  const canDraft = (e: SavedEntry) => !!settings && !!buildDraft(e.profile, settings, templateId).draft
  const untouched = (e: SavedEntry) => e.status === '' || e.status === 'to_contact'
  const candidates = selected.size
    ? shown.filter((e) => selected.has(e.login) && canDraft(e))
    : shown.filter((e) => untouched(e) && canDraft(e))
  const allTicked = shown.length > 0 && shown.every((e) => selected.has(e.login))
  const toggle = (login: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(login)) next.delete(login)
      else next.add(login)
      return next
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Saved profiles</h1>
          <p className="text-sm text-slate-500">
            Stored in <code className="text-xs">backend/data/saved_profiles.json</code> and <code className="text-xs">saved_profiles.csv</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            placeholder="Filter by name, skill, country, region…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <select
            aria-label="Outreach status filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="due">Follow-up due ({dueCount})</option>
            {STATUSES.slice(1).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            <option value="">No status</option>
          </select>
          <a className={btnSecondary} href={api.exportUrl('csv')}>Export CSV</a>
          <a className={btnSecondary} href={api.exportUrl('json')}>Export JSON</a>
          {entries.length > 0 && <button className={btnDanger} onClick={clearAll}>Remove all</button>}
        </div>
      </div>

      {queue && settings ? (
        <DraftQueue
          queue={queue}
          settings={settings}
          templateId={templateId}
          onDrafted={(login) => track(login, { status: 'drafted' })}
          onClose={() => {
            setQueue(null)
            setSelected(new Set())
          }}
        />
      ) : (
        entries.length > 0 && settings && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <span className="font-medium text-slate-900">Draft queue</span>
            <span className="text-slate-500">
              {selected.size
                ? `${candidates.length} of ${selected.size} ticked ${selected.size === 1 ? 'person' : 'people'} can be drafted`
                : `${candidates.length} shown ${candidates.length === 1 ? 'person has' : 'people have'} not been drafted or contacted yet`}
            </span>
            {settings.templates.length > 1 && (
              <select aria-label="Queue template" value={templateId} onChange={(e) => setQueueTemplate(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
                {settings.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <button className={`${btnPrimary} ml-auto`} disabled={!candidates.length} onClick={() => {
                setQueue(candidates)
                void openQueueDraft(candidates[0], settings, templateId)
              }}>
              Start queue ({candidates.length})
            </button>
          </div>
        )
      )}

      {entries.length === 0 ? (
        <EmptyState title="No saved profiles yet">Use the Save button on a search result.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" aria-label="Tick everyone shown" className="accent-indigo-600" checked={allTicked}
                    onChange={() => setSelected(allTicked ? new Set() : new Set(shown.map((e) => e.login)))} />
                </th>
                <th className="px-4 py-2">Person</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Location</th>
                <th className="px-4 py-2">Skills</th>
                <th className="px-4 py-2">Confidence</th>
                <th className="px-4 py-2">Outreach</th>
                <th className="px-4 py-2">Saved</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((entry) => {
                const { login, saved_at, profile: p } = entry
                return (
                <tr key={login} className={`align-top ${selected.has(login) ? 'bg-indigo-50/40' : ''}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" aria-label={`Tick ${login}`} className="accent-indigo-600" checked={selected.has(login)}
                      onChange={() => toggle(login)} />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/profile/${login}`} className="flex items-center gap-3">
                      <img src={p.avatar_url || ''} alt="" className="size-9 rounded-full bg-slate-100" />
                      <span>
                        <span className="block font-medium text-slate-900">{p.name || login}</span>
                        <span className="block text-xs text-slate-500">@{login}{p.roles[0] && ` · ${p.roles[0].title}`}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="space-y-0.5 px-4 py-3 text-xs">
                    {p.contacts.emails.map((e) => <div key={e.value}>{e.value}</div>)}
                    {p.contacts.phones.map((x) => <div key={x.value}>{x.value}</div>)}
                    {p.contacts.linkedin && <a className="block text-indigo-700 hover:underline" href={p.contacts.linkedin.value} target="_blank" rel="noreferrer">LinkedIn</a>}
                    {p.contacts.telegram && <div><TelegramHandle url={p.contacts.telegram.value} /></div>}
                    {p.contacts.website && <a className="block text-indigo-700 hover:underline" href={p.contacts.website} target="_blank" rel="noreferrer">Website</a>}
                  </td>
                  <td className="px-4 py-3 text-xs">{p.location || '—'}<div className="text-slate-500">{p.country}</div><div className="text-slate-400">{p.region ?? p.continent}</div></td>
                  <td className="px-4 py-3 text-xs">{p.analysis.skills.slice(0, 4).map((s) => s.name).join(', ')}</td>
                  <td className="px-4 py-3"><ConfidenceBadge value={p.analysis.human_confidence} /></td>
                  <td className="px-4 py-3"><Tracker entry={entry} onChange={(c) => track(login, c)} /></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(saved_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-xs text-rose-600 hover:underline" onClick={() => remove(login)}>Remove</button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
