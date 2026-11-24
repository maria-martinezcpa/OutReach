import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { api, quotaUsage, type Quota } from './api'
import { Alert } from './components/ui'
import AccountsPage from './pages/AccountsPage'
import DraftsPage from './pages/DraftsPage'
import HistoryPage from './pages/HistoryPage'
import JobsPage from './pages/JobsPage'
import ProfilePage from './pages/ProfilePage'
import SavedPage from './pages/SavedPage'
import SearchPage from './pages/SearchPage'
import SettingsPage from './pages/SettingsPage'
import { SearchProvider } from './searchContext'

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:text-slate-900'}`

function RunningCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const load = () =>
      api
        .jobs()
        .then((js) => setCount(js.filter((j) => j.status === 'running' || j.status === 'waiting').length))
        .catch(() => {})
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])
  if (!count) return null
  return <span className="ml-1 rounded-full bg-indigo-600 px-1.5 text-xs text-white">{count}</span>
}

/** Follow-ups due today or earlier; SavedPage fires 'saved-changed' after tracker edits. */
function FollowUpBadge() {
  const [due, setDue] = useState(0)
  useEffect(() => {
    const load = () => api.savedSummary().then((s) => setDue(s.follow_ups_due ?? 0)).catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    window.addEventListener('saved-changed', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('saved-changed', load)
    }
  }, [])
  if (!due) return null
  return (
    <span title={`${due} follow-up${due > 1 ? 's' : ''} due`} className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">
      {due}
    </span>
  )
}

function QuotaIndicator() {
  const [quota, setQuota] = useState<{ core: Quota | null; search: Quota | null } | null>(null)
  useEffect(() => {
    const load = () => api.rateLimit().then(setQuota).catch(() => {})
    load()
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  }, [])
  const core = quota?.core
  if (!core) return null
  const { used, pct, bar } = quotaUsage(core)
  const low = core.remaining < core.limit * 0.1
  const reset = new Date(core.reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const search = quota.search
    ? ` Search API: ${quotaUsage(quota.search).used} of ${quota.search.limit} used this minute.`
    : ' Search API: shown after the next search.'
  const asOf = core.observed_at
    ? ` Reported by GitHub at ${new Date(core.observed_at * 1000).toLocaleTimeString()}.`
    : ''
  return (
    <NavLink
      to="/settings"
      title={`GitHub API usage of the active token: ${used.toLocaleString()} of ${core.limit.toLocaleString()} requests used this hour (${pct}%). Each person checked costs about 5–10. Resets at ${reset}.${asOf}${search}`}
      className={`mr-2 hidden w-56 rounded-md px-2 py-1 text-xs sm:block ${low ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}
    >
      <div className="flex justify-between gap-2">
        <span>
          GitHub API <b>{pct}%</b> used
        </span>
        <span>
          {core.remaining.toLocaleString()} / {core.limit.toLocaleString()} left
        </span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-slate-200">
        <div className={`h-1 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {low && <div className="mt-0.5">resets {reset}</div>}
    </NavLink>
  )
}

function TokenNotice() {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    api.health().then((h) => setMissing(!h.github_token_configured)).catch(() => {})
  }, [])
  if (!missing) return null
  return (
    <div className="mb-4">
      <Alert kind="warning">
        No GitHub token is configured, so GitHub allows only 60 requests per hour.{' '}
        <NavLink to="/settings" className="font-medium underline">Add a token</NavLink>.
      </Alert>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SearchProvider>
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex w-full items-center justify-between gap-4 px-4 py-3 lg:px-8">
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="grid size-7 place-items-center rounded-lg bg-indigo-600 text-sm text-white">GF</span>
              GitHub Profile Finder
            </NavLink>
            <nav className="flex items-center gap-1">
              <QuotaIndicator />
              <NavLink to="/" end className={navCls}>Search</NavLink>
              <NavLink to="/searches" className={navCls}>
                Background searches <RunningCount />
              </NavLink>
              <NavLink to="/accounts" className={navCls}>All accounts</NavLink>
              <NavLink to="/saved" className={navCls}>
                Saved <FollowUpBadge />
              </NavLink>
              <NavLink to="/history" className={navCls}>History</NavLink>
              <NavLink to="/drafts" className={navCls}>Email drafts</NavLink>
              <NavLink to="/settings" className={navCls}>Tokens</NavLink>
            </nav>
          </div>
        </header>
        <main className="w-full px-4 py-6 lg:px-8">
          <TokenNotice />
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/profile/:login" element={<ProfilePage />} />
            <Route path="/searches" element={<JobsPage />} />
            <Route path="/searches/:id" element={<JobsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/drafts" element={<DraftsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <footer className="w-full px-4 pb-8 lg:px-8 text-xs text-slate-400">
          Uses only information people published on their GitHub profiles. Assessments are automated and do not verify identity.
          GitHub's Acceptable Use Policy prohibits using this data for spam or unsolicited bulk email.
        </footer>
      </SearchProvider>
    </BrowserRouter>
  )
}
