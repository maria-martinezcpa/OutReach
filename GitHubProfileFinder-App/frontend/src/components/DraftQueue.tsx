import { useEffect, useState } from 'react'
import { DRAFT_APPS, type DraftSettings } from '../draft'
import { openQueueDraft } from '../openDraft'
import type { SavedEntry } from '../types'
import { btnPrimary, btnSecondary } from './ui'

/** Walks through a list of saved people one at a time: after the user has saved the current draft in their
 *  app, Next (or Enter) marks the person Drafted and opens the next one. Nothing is sent. The caller opens
 *  the first draft when the queue starts (see openQueueDraft). */
export default function DraftQueue({ queue, settings, templateId, onDrafted, onClose }: {
  queue: SavedEntry[]
  settings: DraftSettings
  templateId: string
  onDrafted: (login: string) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [drafted, setDrafted] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const app = DRAFT_APPS.find((a) => a.value === settings.app)?.label ?? 'your email app'
  const done = index >= queue.length
  const current = done ? null : queue[index]

  async function open(i: number) {
    setError(null)
    if (!(await openQueueDraft(queue[i], settings, templateId))) setError(`Could not open ${app}. Use "Open again" to retry.`)
  }

  function advance(markDrafted: boolean) {
    if (!current) return
    if (markDrafted) {
      onDrafted(current.login)
      setDrafted((n) => n + 1)
    }
    const next = index + 1
    setIndex(next)
    if (next < queue.length) void open(next)
  }

  // Enter = Next, unless typing somewhere or a button has focus (Enter already clicks that button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (e.key !== 'Enter' || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag ?? '')) return
      e.preventDefault()
      advance(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pct = Math.round((Math.min(index, queue.length) / Math.max(queue.length, 1)) * 100)
  const tip = settings.app === 'telegram'
    ? 'The message waits in the chat as a draft.'
    : settings.app === 'mailto'
      ? 'In Outlook press Ctrl+S, then close the message window.'
      : 'Change one character so it saves to Drafts, then close the compose window.'

  return (
    <section aria-label="Draft queue" className="sticky top-16 z-10 rounded-xl border border-indigo-200 bg-indigo-50/95 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {current ? (
            <>
              <div className="text-xs font-medium uppercase tracking-wide text-indigo-700">
                Draft {index + 1} of {queue.length}
              </div>
              <div className="truncate text-base font-semibold text-slate-900">
                {current.profile.name || current.login}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {settings.app === 'telegram' ? `@${current.login}` : current.profile.contacts.emails[0]?.value}
                </span>
              </div>
              <div className="text-xs text-slate-600">Opened in {app}. {tip} Then press <b>Next</b> or <kbd className="rounded border border-slate-300 bg-white px-1">Enter</kbd>.</div>
            </>
          ) : (
            <>
              <div className="text-base font-semibold text-slate-900">Queue finished</div>
              <div className="text-sm text-slate-600">
                {drafted} marked Drafted{queue.length - drafted > 0 && `, ${queue.length - drafted} skipped`}. Review and send them from your Drafts
                folder, then set each person to Contacted.
              </div>
            </>
          )}
          {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {current && (
            <>
              <button className={btnSecondary} onClick={() => open(index)}>Open again</button>
              <button className={btnSecondary} onClick={() => advance(false)}>Skip</button>
              <button className={btnPrimary} onClick={() => advance(true)}>Next ⏎</button>
            </>
          )}
          <button className={btnSecondary} onClick={onClose}>{current ? 'Stop' : 'Close'}</button>
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-white" role="progressbar" aria-valuenow={index} aria-valuemax={queue.length}>
        <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </section>
  )
}
