import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { EmptyState, Spinner, btnSecondary } from '../components/ui'
import { useSearch } from '../searchContext'
import { emptyForm, type HistoryEntry, type SearchForm } from '../types'

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const { run } = useSearch()
  const navigate = useNavigate()

  useEffect(() => {
    api.history().then(setItems).catch(() => setItems([]))
  }, [])

  function rerun(entry: HistoryEntry) {
    const form: SearchForm = { ...emptyForm }
    for (const [k, v] of Object.entries(entry.params)) {
      if (k in form && k !== 'page') (form as unknown as Record<string, unknown>)[k] = typeof v === 'boolean' || Array.isArray(v) ? v : String(v)
    }
    navigate('/')
    run(1, form)
  }

  if (!items) return <Spinner label="Loading history…" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Search history</h1>
        {items.length > 0 && (
          <button className={btnSecondary} onClick={() => api.clearHistory().then(() => setItems([]))}>Clear history</button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState title="No searches yet" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {items.map((h) => (
            <li key={h.at + h.query} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm text-slate-800">{h.query}</div>
                <div className="text-xs text-slate-500">{new Date(h.at).toLocaleString()} · {h.results} results</div>
              </div>
              <button className={btnSecondary} onClick={() => rerun(h)}>Run again</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
