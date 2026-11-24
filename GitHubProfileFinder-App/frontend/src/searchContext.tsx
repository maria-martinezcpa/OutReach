import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { emptyForm, type Profile, type SearchForm, type SearchProgress, type SearchResponse } from './types'

interface SearchState {
  form: SearchForm
  setForm: (form: SearchForm) => void
  result: SearchResponse | null
  progress: SearchProgress | null
  loading: boolean
  error: string | null
  run: (page?: number, form?: SearchForm) => void
  stop: () => void
  reset: () => void
  updateProfile: (login: string, patch: Partial<Profile>) => void
}

const SearchContext = createContext<SearchState | null>(null)

const emptyResult = (page: number, perPage: number): SearchResponse => ({
  items: [],
  page,
  per_page: perPage,
  total_candidates: 0,
  checked: 0,
  filtered_out: 0,
  failed: [],
  query: '',
  has_more: false,
  warning: null,
})

// Search state lives above the router so results survive navigating to a profile and back.
export function SearchProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<SearchForm>(emptyForm)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [progress, setProgress] = useState<SearchProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const source = useRef<EventSource | null>(null)

  const stop = useCallback(() => {
    source.current?.close()
    source.current = null
    setLoading(false)
  }, [])

  // Results stream in over server-sent events: each matching person is shown the moment it is found.
  const run = useCallback(
    (page = 1, override?: SearchForm) => {
      const f = override ?? form
      if (override) setForm(override)
      source.current?.close()
      setLoading(true)
      setError(null)
      setProgress(null)
      setResult(emptyResult(page, Number(f.per_page) || 10))

      const es = new EventSource(api.searchStreamUrl(f, page))
      source.current = es
      const finish = () => {
        es.close()
        if (source.current === es) {
          source.current = null
          setLoading(false)
        }
      }
      const data = (e: Event) => JSON.parse((e as MessageEvent).data)

      es.addEventListener('progress', (e) => {
        const p: SearchProgress = data(e)
        setProgress(p)
        setResult((r) => r && { ...r, query: p.query, total_candidates: p.total_candidates })
      })
      es.addEventListener('item', (e) => {
        const p: Profile = data(e)
        setResult((r) => r && { ...r, items: [...r.items, p] })
      })
      es.addEventListener('done', (e) => {
        const summary: Omit<SearchResponse, 'items'> = data(e)
        setResult((r) => r && { ...r, ...summary, items: r.items })
        finish()
      })
      es.addEventListener('failed', (e) => {
        setError(data(e).detail)
        finish()
      })
      es.onerror = () => {
        if (source.current === es) setError('Lost connection to the backend. Is the API server running on port 8000?')
        finish()
      }
    },
    [form],
  )

  const reset = useCallback(() => {
    stop()
    setForm(emptyForm)
    setResult(null)
    setProgress(null)
    setError(null)
  }, [stop])

  const updateProfile = useCallback((login: string, patch: Partial<Profile>) => {
    setResult((r) => r && { ...r, items: r.items.map((p) => (p.login === login ? { ...p, ...patch } : p)) })
  }, [])

  const value = useMemo(
    () => ({ form, setForm, result, progress, loading, error, run, stop, reset, updateProfile }),
    [form, result, progress, loading, error, run, stop, reset, updateProfile],
  )
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearch(): SearchState {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch must be used inside SearchProvider')
  return ctx
}
