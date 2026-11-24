import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, quotaUsage, type Quota as QuotaType, type TokenInfo } from '../api'
import GitHubAppCard from '../components/GitHubAppCard'
import { Alert, Badge, Card, Spinner, btnDanger, btnPrimary, btnSecondary, input } from '../components/ui'

function Quota({ label, q, unknown }: { label: string; q?: QuotaType | null; unknown?: string }) {
  if (!q) return unknown ? <div className="flex justify-between text-xs text-slate-500"><span>{label}</span><span>{unknown}</span></div> : null
  const { used, pct, bar } = quotaUsage(q)
  const reset = new Date(q.reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="text-xs">
      <div className="flex flex-wrap justify-between gap-x-3 text-slate-500">
        <span>{label}</span>
        <span>
          <b className="text-slate-700">{pct}% used</b> ({used.toLocaleString()} / {q.limit.toLocaleString()}) ·{' '}
          {q.remaining.toLocaleString()} left · resets {reset}
          {q.observed_at && <> · as of {new Date(q.observed_at * 1000).toLocaleTimeString()}</>}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100" role="meter" aria-label={`${label} usage`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')

  const load = useCallback(() => {
    api
      .tokens()
      .then(setTokens)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load tokens'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(message)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    await act(async () => {
      const t = await api.addToken(token.trim(), label.trim())
      setToken('')
      setLabel('')
      return t
    }, 'Token added and verified with GitHub.')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">GitHub tokens</h1>
        <p className="text-sm text-slate-500">
          The active token is used for every GitHub request. Each token has its own hourly quota. Switching takes effect
          immediately, and background searches waiting on a rate limit continue right away.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="info">{notice}</Alert>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          <GitHubAppCard onChanged={load} />

          <Card title="Add a token">
            <form onSubmit={add} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="Token"
                  placeholder="ghp_… or github_pat_…"
                  className={input}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <input aria-label="Token name" placeholder="Name (optional)" className={input} value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Create one at{' '}
                  <a className="text-indigo-700 underline" href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer">
                    github.com/settings/tokens
                  </a>
                  . No scopes are needed: the app only reads public data.
                </p>
                <button className={btnPrimary} disabled={busy || !token.trim()}>
                  {busy ? 'Checking…' : 'Add & verify'}
                </button>
              </div>
            </form>
          </Card>
        </div>

        <Card title="Your tokens" actions={<button className={btnSecondary} onClick={load}>Refresh quota</button>}>
          {!tokens ? (
            <Spinner label="Checking tokens with GitHub…" />
          ) : tokens.length === 0 ? (
            <p className="text-sm text-slate-500">No tokens yet. Without a token GitHub allows only 60 requests per hour.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tokens.map((t) => (
                <li key={t.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{t.label}</span>
                        {t.active && <Badge color="indigo">Active</Badge>}
                        {t.valid === false && <Badge color="red">Invalid</Badge>}
                        {t.source === 'env' && <Badge>.env</Badge>}
                        {t.source === 'github_app' && <Badge color="green">GitHub App · auto-renewed</Badge>}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-slate-500">
                        {t.masked}
                        {t.login && <span className="font-sans"> · account @{t.login}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!t.active && t.valid !== false && (
                        <button className={btnPrimary} disabled={busy} onClick={() => act(() => api.activateToken(t.id), `Now using "${t.label}".`)}>
                          Use this token
                        </button>
                      )}
                      {t.source === 'app' && (
                        <button
                          className={btnDanger}
                          disabled={busy}
                          onClick={() => confirm(`Remove token "${t.label}" from the app?`) && act(() => api.deleteToken(t.id), 'Token removed.')}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {t.error && <p className="text-xs text-rose-600">{t.error}</p>}
                  <Quota label="Core API (profiles, repositories, commits)" q={t.core} />
                  <Quota label="Search API (per minute)" q={t.search} unknown={t.valid ? 'shown after the next search with this token' : undefined} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Tokens are stored only on this computer in <code>backend/data/tokens.json</code> and are never sent to the browser.
            Revoke a token on GitHub if it may have been exposed.
          </p>
        </Card>
      </div>
    </div>
  )
}
