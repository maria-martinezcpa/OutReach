import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api'
import ProfileCard from '../components/ProfileCard'
import SearchSidebar from '../components/SearchSidebar'
import { Alert, EmptyState, Spinner, btnSecondary } from '../components/ui'
import { useSearch } from '../searchContext'
import type { Profile, SearchProgress } from '../types'

type SortKey = 'relevance' | 'period' | 'followers' | 'confidence' | 'contacts' | 'name'

const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1, INSUFFICIENT_DATA: 0 }
const contactCount = (p: Profile) =>
  p.contacts.emails.length + p.contacts.phones.length + (p.contacts.linkedin ? 1 : 0) + (p.contacts.telegram ? 1 : 0) + (p.contacts.website ? 1 : 0)

function sortProfiles(items: Profile[], key: SortKey): Profile[] {
  const sorted = [...items]
  switch (key) {
    case 'period':
      return sorted.sort((a, b) => (b.period_activity?.commits ?? 0) - (a.period_activity?.commits ?? 0))
    case 'followers':
      return sorted.sort((a, b) => b.followers - a.followers)
    case 'confidence':
      return sorted.sort((a, b) => confidenceRank[b.analysis.human_confidence] - confidenceRank[a.analysis.human_confidence])
    case 'contacts':
      return sorted.sort((a, b) => contactCount(b) - contactCount(a))
    case 'name':
      return sorted.sort((a, b) => (a.name || a.login).localeCompare(b.name || b.login))
    default:
      return sorted
  }
}

function LiveProgress({ progress, onStop }: { progress: SearchProgress | null; onStop: () => void }) {
  const pct = progress && progress.candidates ? Math.round((progress.checked / progress.candidates) * 100) : 0
  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <Spinner
          label={
            progress
              ? `Checking people: ${progress.checked} of ${progress.candidates} · ${progress.found} found · ${progress.filtered_out} did not match`
              : 'Asking GitHub for candidates…'
          }
        />
        <button className={btnSecondary} onClick={onStop}>Stop</button>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-400">People appear below the moment they are found.</p>
    </div>
  )
}

export default function SearchPage() {
  const { form, setForm, result, progress, loading, error, run, stop, reset, updateProfile } = useSearch()
  const [sort, setSort] = useState<SortKey>('relevance')
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const items = useMemo(() => sortProfiles(result?.items ?? [], sort), [result, sort])
  const [starting, setStarting] = useState(false)
  const navigate = useNavigate()

  async function startBackground(target: number) {
    setStarting(true)
    setSaveError(null)
    try {
      const job = await api.createJob(form, target)
      navigate(`/searches/${job.id}`)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not start background search')
    } finally {
      setStarting(false)
    }
  }

  async function toggleSave(p: Profile) {
    setSaving(p.login)
    setSaveError(null)
    try {
      if (p.saved) await api.unsave(p.login)
      else await api.save(p.login)
      updateProfile(p.login, { saved: !p.saved })
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not update saved profiles')
    } finally {
      setSaving(null)
    }
  }

  const logins = items.map((p) => p.login)

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-20">
        <SearchSidebar
          form={form}
          onChange={setForm}
          onSubmit={() => run(1)}
          onReset={reset}
          onBackground={startBackground}
          loading={loading}
          starting={starting}
        />
      </aside>

      <section className="min-w-0 space-y-4" aria-live="polite">
        {result && (items.length > 0 || !loading) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{items.length}</span> matching people on page {result.page}
              <span className="text-slate-400">
                {' '}· {result.checked} checked, {result.filtered_out} filtered out · {result.total_candidates.toLocaleString()}{' '}
                {{ repositories: 'repositories', users: 'users', commits: 'commits', followers: 'followers' }[form.mode]}{' '}
                {form.mode === 'followers' ? `of @${form.followers_of.replace(/^@/, '')}` : 'matched on GitHub'}
              </span>
              <div className="mt-0.5 font-mono text-xs text-slate-400">query: {result.query}</div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-500">
                Sort{' '}
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">
                  <option value="relevance">Relevance</option>
                  <option value="period">Commits in period</option>
                  <option value="contacts">Most contact info</option>
                  <option value="followers">Followers</option>
                  <option value="confidence">Human confidence</option>
                  <option value="name">Name</option>
                </select>
              </label>
              {logins.length > 0 && (
                <>
                  <a className={btnSecondary} href={api.exportUrl('csv', logins)}>Export CSV</a>
                  <a className={btnSecondary} href={api.exportUrl('json', logins)}>JSON</a>
                </>
              )}
            </div>
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        {saveError && <Alert>{saveError}</Alert>}
        {result?.warning && !loading && <Alert kind="warning">{result.warning} Showing partial results.</Alert>}

        {loading && <LiveProgress progress={progress} onStop={stop} />}
        {loading && items.length === 0 && <div className="h-40 animate-pulse rounded-xl bg-white shadow-sm" />}

        {!loading && !result && !error && (
          <EmptyState title="Search GitHub for professionals">
            Type any skill, technology or topic, optionally choose a commit period, then press <b>Search</b> for one page of
            results or <b>Run in background</b> to keep collecting people into a list.
          </EmptyState>
        )}

        {!loading && result && items.length === 0 && (
          <EmptyState title="No matching profiles on this page">
            {result.filtered_out > 0
              ? `${result.filtered_out} candidates were checked but did not match your filters. Try the next page or relax the filters.`
              : 'Try different keywords or a wider period.'}
          </EmptyState>
        )}

        {items.map((p) => <ProfileCard key={p.id} profile={p} onToggleSave={toggleSave} saving={saving === p.login} />)}

        {result && !loading && (result.page > 1 || result.has_more) && (
          <nav className="flex items-center justify-center gap-3 pt-2" aria-label="Pagination">
            <button className={btnSecondary} disabled={result.page <= 1} onClick={() => run(result.page - 1)}>
              ← Previous
            </button>
            <span className="text-sm text-slate-500">Page {result.page}</span>
            <button className={btnSecondary} disabled={!result.has_more} onClick={() => run(result.page + 1)}>
              Next →
            </button>
          </nav>
        )}
      </section>
    </div>
  )
}
