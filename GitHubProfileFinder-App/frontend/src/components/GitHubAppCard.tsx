import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError, api, type GitHubAppStatus } from '../api'
import { Alert, Badge, Card, btnDanger, btnPrimary, input } from './ui'

interface Props {
  onChanged: () => void
}

export default function GitHubAppCard({ onChanged }: Props) {
  const [status, setStatus] = useState<GitHubAppStatus | null>(null)
  const [appId, setAppId] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.githubApp().then(setStatus).catch(() => setStatus({ configured: false }))
  }, [])

  async function readKeyFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setPrivateKey(await file.text())
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setStatus(await api.setupGithubApp({ app_id: appId.trim(), installation_id: installationId.trim(), private_key: privateKey }))
      setPrivateKey('')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect the GitHub App')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Disconnect the GitHub App from this app? Its private key will be deleted from this computer.')) return
    setBusy(true)
    setError(null)
    try {
      await api.removeGithubApp()
      setStatus({ configured: false })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="GitHub App">
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {status?.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900">{status.app_name ?? `App ${status.app_id}`}</span>
              <Badge color="green">Connected</Badge>
              {status.active && <Badge color="indigo">Active</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              App ID {status.app_id} · installation {status.installation_id}
              {status.account && <> on @{status.account}</>}
              {status.token_expires_at && (
                <> · current token renews automatically before {new Date(status.token_expires_at).toLocaleTimeString()}</>
              )}
            </p>
          </div>
          <button className={btnDanger} disabled={busy} onClick={remove}>
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-slate-600">
            Run the search as your <b>GitHub App</b>. The app creates installation tokens itself and renews them every hour, and
            GitHub App installations get higher rate limits than a personal token.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
            <li>
              Create or open your app at{' '}
              <a className="text-indigo-700 underline" href="https://github.com/settings/apps" target="_blank" rel="noreferrer">
                github.com/settings/apps
              </a>
              . No permissions are needed to read public data.
            </li>
            <li>Copy the <b>App ID</b> and generate a <b>private key</b> (.pem file).</li>
            <li>Install the app on your account. The installation ID is optional; the first installation is used if blank.</li>
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <input aria-label="App ID" placeholder="App ID, e.g. 123456" className={input} value={appId} onChange={(e) => setAppId(e.target.value)} />
            <input
              aria-label="Installation ID"
              placeholder="Installation ID (optional)"
              className={input}
              value={installationId}
              onChange={(e) => setInstallationId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Private key (.pem){' '}
              <input type="file" accept=".pem" aria-label="Private key file" className="ml-2 text-xs" onChange={readKeyFile} />
            </label>
            <textarea
              aria-label="Private key"
              rows={4}
              spellCheck={false}
              autoComplete="off"
              placeholder="-----BEGIN RSA PRIVATE KEY----- … or choose the .pem file above"
              className={`${input} font-mono text-xs`}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">The key is stored only on this computer and never shown again in the browser.</p>
            <button className={btnPrimary} disabled={busy || !appId.trim() || !privateKey.trim()}>
              {busy ? 'Connecting…' : 'Connect & verify'}
            </button>
          </div>
        </form>
      )}
    </Card>
  )
}
