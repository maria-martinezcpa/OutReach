import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api'
import { emptyForm, type Profile } from '../types'
import { latestScan, refreshFollowerScans, useFollowerScans } from '../useFollowerScans'
import { btnPrimary, btnSecondary, input } from './ui'

const PERIODS: { value: string; label: string; days: number }[] = [
  { value: '', label: 'Any time', days: 0 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '182', label: 'Last 6 months', days: 182 },
  { value: '365', label: 'Last year', days: 365 },
  { value: 'custom', label: 'Custom dates…', days: 0 },
]

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const today = () => new Date().toISOString().slice(0, 10)

/** Starts a background search over everyone following this person, checked like any other candidate,
 *  optionally keeping only followers who committed in a period. If their followers were scanned already,
 *  it shows that and opens the existing scan; "New scan…" starts another (e.g. with other dates). */
export default function ScanFollowersButton({ profile, compact = false }: { profile: Profile; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [target, setTarget] = useState('100')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const scan = latestScan(useFollowerScans(), profile.login)
  const n = profile.followers

  const range =
    period === 'custom'
      ? { since, until: until || today() }
      : period
        ? { since: isoDaysAgo(PERIODS.find((p) => p.value === period)!.days), until: today() }
        : { since: '', until: '' }
  const rangeError = period === 'custom' && (!since ? 'Choose a start date' : range.until < since ? 'Start must be before end' : '')

  async function start() {
    if (rangeError) return
    setBusy(true)
    setError(null)
    try {
      const job = await api.createJob(
        { ...emptyForm, mode: 'followers', followers_of: profile.login, per_page: '20', ...range },
        Math.max(1, Math.round(Number(target)) || 100),
      )
      void refreshFollowerScans()
      navigate(`/searches/${job.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the followers scan')
      setBusy(false)
    }
  }

  const link = 'whitespace-nowrap text-xs font-medium hover:underline disabled:text-slate-400 disabled:no-underline'
  let main
  if (scan) {
    const running = scan.status === 'running' || scan.status === 'waiting'
    main = (
      <button
        onClick={() => navigate(`/searches/${scan.id}`)}
        title={`${scan.name}: started ${new Date(scan.created_at).toLocaleDateString()} (${scan.status}). Open that scan.`}
        className={compact ? `${link} text-purple-700`
          : 'inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-800 hover:bg-purple-100'}
      >
        {running ? `Scanning followers… (${scan.found} found)` : `✓ Followers scanned (${scan.found} found)`}
      </button>
    )
  } else {
    main = (
      <button
        onClick={() => setOpen(!open)}
        disabled={n === 0}
        aria-expanded={open}
        title={n === 0 ? 'No followers to scan' : `Scan the ${n.toLocaleString()} followers of @${profile.login} in the background`}
        className={compact ? `${link} text-indigo-700` : btnSecondary}
      >
        {`Scan ${n.toLocaleString()} followers`}
      </button>
    )
  }

  return (
    <span className="relative inline-block text-left">
      {main}
      {scan && n > 0 && (
        <button onClick={() => setOpen(!open)} aria-expanded={open} className={`${link} ml-2 text-slate-500`}>
          New scan…
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label={`Scan followers of ${profile.login}`}
          className="absolute right-0 z-20 mt-1 w-72 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs shadow-lg"
        >
          <div className="text-sm font-medium text-slate-900">Scan {n.toLocaleString()} followers of @{profile.login}</div>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-600">Committed code in</span>
            <select aria-label="Commit period" className={input} value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          {period === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-slate-600">From</span>
                <input type="date" aria-label="From" className={input} value={since} max={today()} onChange={(e) => setSince(e.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-slate-600">To</span>
                <input type="date" aria-label="To" className={input} value={until} max={today()} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </div>
          )}
          <p className="text-slate-500">
            {period
              ? 'Only followers who committed to their own repositories in this period are kept (costs a few more requests each).'
              : 'Every follower with a public email, phone or LinkedIn is kept.'}
          </p>
          <label className="flex items-center gap-2 text-slate-600">
            Stop after
            <input type="number" min={1} aria-label="Stop after" className="w-20 rounded-md border border-slate-300 px-2 py-1"
              value={target} onChange={(e) => setTarget(e.target.value)} />
            people
          </label>
          {(rangeError || error) && <p className="text-rose-600">{rangeError || error}</p>}
          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !!rangeError} onClick={start}>{busy ? 'Starting…' : 'Start scan'}</button>
          </div>
        </div>
      )}
    </span>
  )
}
