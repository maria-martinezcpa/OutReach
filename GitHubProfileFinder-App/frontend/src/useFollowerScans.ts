import { useEffect, useState } from 'react'
import { api } from './api'
import type { Job } from './types'

/** Followers scans by the account they scanned (lowercase login), newest first. Shared by every page and
 *  refreshed every 15 seconds while something is on screen, so running scans show their progress. */
export type FollowerScans = Record<string, Job[]>

let cached: FollowerScans | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<(s: FollowerScans) => void>()

function index(jobs: Job[]): FollowerScans {
  const out: FollowerScans = {}
  for (const j of jobs) {
    const login = j.params?.mode === 'followers' ? j.params.followers_of?.replace(/^@/, '').toLowerCase() : ''
    if (login) (out[login] ??= []).push(j)
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return out
}

function publish(next: FollowerScans) {
  cached = next
  listeners.forEach((l) => l(next))
}

export function refreshFollowerScans() {
  return api
    .jobs()
    .then((jobs) => Array.isArray(jobs) && publish(index(jobs)))
    .catch(() => {})
}

export function useFollowerScans(): FollowerScans {
  const [scans, setScans] = useState(cached ?? {})
  useEffect(() => {
    listeners.add(setScans)
    if (!cached) void refreshFollowerScans()
    timer ??= setInterval(refreshFollowerScans, 15000)
    return () => {
      listeners.delete(setScans)
      if (!listeners.size && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [])
  return scans
}

/** The latest scan of this person's followers, if any. */
export const latestScan = (scans: FollowerScans, login: string): Job | undefined => scans[login.toLowerCase()]?.[0]

/** Forget the loaded scans (tests start from a clean state). */
export function resetFollowerScans() {
  cached = null
}
