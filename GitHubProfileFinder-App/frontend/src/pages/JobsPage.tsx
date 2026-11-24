import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import ResultsTable from '../components/ResultsTable'
import { Alert, Badge, EmptyState, Spinner, btnDanger, btnPrimary, btnSecondary, type Tone } from '../components/ui'
import type { Job, JobStatus, Profile } from '../types'

const statusTone: Record<JobStatus, Tone> = {
  running: 'indigo',
  waiting: 'amber',
  paused: 'slate',
  completed: 'green',
  failed: 'red',
}

const isActive = (j: Job) => j.status === 'running' || j.status === 'waiting'

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge color={statusTone[status]}>
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-indigo-600" />}
      {status}
    </Badge>
  )
}

function Progress({ job }: { job: Job }) {
  const pct = Math.min(100, Math.round((job.found / Math.max(job.target, 1)) * 100))
  return (
    <div className="h-1.5 rounded-full bg-slate-100" role="progressbar" aria-valuenow={job.found} aria-valuemax={job.target}>
      <div className={`h-1.5 rounded-full ${job.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function JobDetail({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [results, setResults] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const navigate = useNavigate()
  const countRef = useRef(0)

  // Reset when switching to another search.
  useEffect(() => {
    setResults([])
    countRef.current = 0
    setError(null)
    setNotice(null)
  }, [job.id])

  // Fetch only new results (offset) whenever the job reports more than we have.
  useEffect(() => {
    if (job.found <= countRef.current) return
    let cancelled = false
    api
      .jobResults(job.id, countRef.current)
      .then((more) => {
        if (cancelled || !more.length) return
        countRef.current += more.length
        setResults((r) => [...r, ...more])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [job.id, job.found])

  async function act(label: string, fn: () => Promise<unknown>, message?: string) {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (message) setNotice(message)
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  async function toggleSave(p: Profile) {
    setBusy(p.login)
    try {
      if (p.saved) await api.unsave(p.login)
      else await api.save(p.login)
      setResults((rs) => rs.map((r) => (r.login === p.login ? { ...r, saved: !p.saved } : r)))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update saved profiles')
    } finally {
      setBusy(null)
    }
  }

  async function saveAll() {
    await act('saveall', async () => {
      const { saved } = await api.saveAllJob(job.id)
      setResults((rs) => rs.map((r) => ({ ...r, saved: true })))
      setNotice(`${saved} people added to your Saved list.`)
    })
  }

  async function remove(logins: string[]) {
    setError(null)
    try {
      const r = await api.removeAccounts(logins)
      const gone = new Set(logins)
      setResults((rs) => rs.filter((p) => !gone.has(p.login)))
      countRef.current = Math.max(0, countRef.current - logins.length)
      setNotice(`Removed ${r.accounts} ${r.accounts === 1 ? 'person' : 'people'} from your data (from every search, the cache and Saved).`)
      window.dispatchEvent(new Event('saved-changed'))
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove them')
    }
  }

  const targetReached = job.status === 'completed' && job.found >= job.target
  const exhausted = job.status === 'completed' && job.message === 'No more search results'

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-slate-900">{job.name}</h1>
              <StatusBadge status={job.status} />
            </div>
            <p className="mt-0.5 break-all font-mono text-xs text-slate-400">{job.query}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {job.status === 'waiting' && (
              <button className={btnPrimary} disabled={!!busy} onClick={() => act('wake', () => api.wakeJob(job.id))}>
                Continue now
              </button>
            )}
            {isActive(job) && (
              <button className={btnSecondary} disabled={!!busy} onClick={() => act('pause', () => api.pauseJob(job.id))}>
                Pause
              </button>
            )}
            {(job.status === 'paused' || job.status === 'failed') && (
              <button className={btnPrimary} disabled={!!busy} onClick={() => act('resume', () => api.resumeJob(job.id))}>
                Continue search
              </button>
            )}
            {targetReached && (
              <button className={btnPrimary} disabled={!!busy} onClick={() => act('more', () => api.resumeJob(job.id, 100))}>
                Continue: find 100 more
              </button>
            )}
            <button className={btnSecondary} disabled={!results.length || !!busy} onClick={saveAll}>
              Add all to Saved list
            </button>
            <a className={btnSecondary} href={api.jobExportUrl(job.id, 'csv')}>CSV</a>
            <a className={btnSecondary} href={api.jobExportUrl(job.id, 'json')}>JSON</a>
            <button
              className={btnDanger}
              disabled={!!busy}
              onClick={() => confirm(`Delete the search "${job.name}" and its list?`) && act('delete', async () => {
                await api.deleteJob(job.id)
                navigate('/searches')
              })}
            >
              Delete
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span>
              <b className="text-slate-900">{job.found}</b> <span className="text-slate-500">of {job.target} people found</span>
            </span>
            <span className="text-xs text-slate-500">
              page {job.pages_done} · {job.checked} checked · {job.filtered_out} filtered out · {job.total_candidates.toLocaleString()} GitHub matches
            </span>
          </div>
          <Progress job={job} />
        </div>

        {job.status === 'waiting' && job.wait_until && (
          <p className="mt-3 text-sm text-amber-700">
            {job.message}. Checking every 30 seconds and continuing as soon as the quota is back (at the latest{' '}
            {new Date(job.wait_until).toLocaleTimeString()}).
          </p>
        )}
        {job.status === 'failed' && <p className="mt-3 text-sm text-rose-700">Stopped: {job.message}</p>}
        {exhausted && <p className="mt-3 text-sm text-slate-500">Finished: GitHub has no more results for this search.</p>}
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="info">{notice}</Alert>}

      {results.length === 0 ? (
        isActive(job) ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Spinner label="Searching… people appear here as soon as they are found." />
          </div>
        ) : (
          <EmptyState title="No matching people found">Try broader keywords or a longer period.</EmptyState>
        )
      ) : (
        <ResultsTable profiles={results} onToggleSave={toggleSave} busy={busy} onRemove={remove} />
      )}
    </div>
  )
}

export default function JobsPage() {
  const { id } = useParams()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .jobs()
      .then((j) => {
        setJobs(j)
        setError(null)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load searches'))
  }, [])

  const anyActive = jobs?.some(isActive) ?? false
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, anyActive ? 1500 : 8000)
    return () => clearInterval(timer)
  }, [refresh, anyActive])

  if (error && !jobs) return <Alert>{error}</Alert>
  if (!jobs) return <Spinner label="Loading searches…" />

  const selected = jobs.find((j) => j.id === id) ?? (id ? undefined : jobs[0])

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr] 2xl:grid-cols-[360px_1fr]">
      <aside className="h-fit space-y-2 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1" aria-label="Background searches">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Background searches</h2>
          <Link to="/" className="text-sm text-indigo-700 hover:underline">+ New</Link>
        </div>
        {jobs.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            None yet. On the Search page, set your filters and press <b>Run in background</b>.
          </p>
        )}
        {jobs.map((j) => (
          <Link
            key={j.id}
            to={`/searches/${j.id}`}
            className={`block rounded-xl border bg-white p-3 shadow-sm transition hover:border-indigo-300 ${selected?.id === j.id ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-slate-900">{j.name}</span>
              <StatusBadge status={j.status} />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {j.found} / {j.target} people · page {j.pages_done}
            </div>
            <div className="mt-2">
              <Progress job={j} />
            </div>
          </Link>
        ))}
      </aside>

      {selected ? (
        <JobDetail job={selected} onChanged={refresh} />
      ) : (
        <EmptyState title={id ? 'Search not found' : 'Select a search'}>
          {id ? 'It may have been deleted.' : 'Pick a background search on the left.'}
        </EmptyState>
      )}
    </div>
  )
}
