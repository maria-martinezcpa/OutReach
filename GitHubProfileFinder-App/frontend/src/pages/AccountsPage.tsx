import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api'
import ResultsTable from '../components/ResultsTable'
import { Alert, EmptyState, Spinner } from '../components/ui'
import type { Profile } from '../types'

/** Everyone found by any background search, once each, with the table's filters (email, domain, skill…). */
export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.accounts().then(setAccounts).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load accounts'))
  }, [])

  async function toggleSave(p: Profile) {
    setBusy(p.login)
    try {
      if (p.saved) await api.unsave(p.login)
      else await api.save(p.login)
      setAccounts((as) => as?.map((a) => (a.login === p.login ? { ...a, saved: !p.saved } : a)) ?? null)
      window.dispatchEvent(new Event('saved-changed'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update saved profiles')
    } finally {
      setBusy(null)
    }
  }

  const [notice, setNotice] = useState<string | null>(null)

  async function remove(logins: string[]) {
    setError(null)
    try {
      const r = await api.removeAccounts(logins)
      const gone = new Set(logins)
      setAccounts((as) => as?.filter((a) => !gone.has(a.login)) ?? null)
      setNotice(`Removed ${r.accounts} ${r.accounts === 1 ? 'person' : 'people'} from your data` +
        (r.saved_removed ? ` (including ${r.saved_removed} from Saved).` : '.'))
      window.dispatchEvent(new Event('saved-changed'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove them')
    }
  }

  if (error && !accounts) return <Alert>{error}</Alert>
  if (!accounts) return <Spinner label="Loading everyone your searches found…" />

  const withEmail = accounts.filter((a) => a.contacts.emails.length).length
  const searches = new Set(accounts.flatMap((a) => a.found_in ?? [])).size

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">All accounts</h1>
        <p className="text-sm text-slate-500">
          <b className="text-slate-700">{accounts.length.toLocaleString()}</b> people found across {searches} background
          search{searches === 1 ? '' : 'es'}, each listed once · {withEmail.toLocaleString()} with a public email.
          Filter by email address or domain below.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="info">{notice}</Alert>}
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">
          Run a search in the background from the <Link to="/" className="text-indigo-700 underline">Search</Link> page.
        </EmptyState>
      ) : (
        <ResultsTable profiles={accounts} onToggleSave={toggleSave} busy={busy} onRemove={remove} />
      )}
    </div>
  )
}
