import { useEffect, useState } from 'react'
import { api } from './api'
import type { DraftSettings } from './draft'

// Loaded once and shared by every Draft email button; the Email drafts page updates it on save.
let cached: DraftSettings | null = null
let pending: Promise<DraftSettings> | null = null
const listeners = new Set<(s: DraftSettings) => void>()

export function setDraftSettings(s: DraftSettings) {
  cached = s
  listeners.forEach((l) => l(s))
}

export function useDraftSettings(): DraftSettings | null {
  const [settings, setSettings] = useState(cached)
  useEffect(() => {
    listeners.add(setSettings)
    if (!cached) {
      pending ??= api.draftSettings()
      pending
        .then((s) => {
          if (s && typeof s.app === 'string' && Array.isArray(s.templates) && s.templates.length > 0) setDraftSettings(s)
        })
        .catch(() => {})
        .finally(() => (pending = null))
    }
    return () => {
      listeners.delete(setSettings)
    }
  }, [])
  return settings
}
