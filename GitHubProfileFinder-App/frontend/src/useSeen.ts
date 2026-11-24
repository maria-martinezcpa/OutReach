import { useEffect, useState } from 'react'
import { api } from './api'

// People already looked at (lowercase login -> first seen). Loaded once and shared by every table and page.
let cached: Record<string, string> | null = null
let pending: Promise<Record<string, string>> | null = null
const listeners = new Set<(s: Record<string, string>) => void>()

function publish(next: Record<string, string>) {
  cached = next
  listeners.forEach((l) => l(next))
}

/** Marks people as seen (or new again). Updates every page at once, then saves in the background. */
export function setSeen(logins: string[], seen = true) {
  const keys = logins.map((l) => l.toLowerCase())
  const base = cached ?? {}
  if (seen ? keys.every((k) => k in base) : keys.every((k) => !(k in base))) return
  const next = { ...base }
  const now = new Date().toISOString()
  for (const k of keys) {
    if (seen) next[k] ??= now
    else delete next[k]
  }
  publish(next)
  api.setSeen(keys, seen).catch(() => {})
}

export function useSeen(): Record<string, string> {
  const [seen, setState] = useState(cached ?? {})
  useEffect(() => {
    listeners.add(setState)
    if (!cached) {
      pending ??= api.seen()
      pending
        .then((s) => {
          if (s && typeof s === 'object' && !Array.isArray(s)) publish({ ...s, ...(cached ?? {}) })
        })
        .catch(() => {})
        .finally(() => (pending = null))
    }
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return seen
}

/** Forget the loaded list so the next page load fetches it again (tests start from a clean state). */
export function resetSeenCache() {
  cached = null
  pending = null
}
