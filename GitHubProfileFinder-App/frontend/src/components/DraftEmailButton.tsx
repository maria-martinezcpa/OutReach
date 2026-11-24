import { useEffect, useRef, useState } from 'react'
import { DRAFT_APPS, buildDraft } from '../draft'
import { openDraftUrl } from '../openDraft'
import type { Profile } from '../types'
import { useDraftSettings } from '../useDraftSettings'
import { setSeen } from '../useSeen'
import { btnSecondary } from './ui'

/** Opens a filled-in draft to this one person in the user's chosen app. Nothing is sent automatically.
 *  With several templates, a small menu picks which one to use. */
export default function DraftEmailButton({ profile, compact = false, onDrafted }: {
  profile: Profile
  compact?: boolean
  onDrafted?: () => void
}) {
  const settings = useDraftSettings()
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  if (!settings) return null
  const app = DRAFT_APPS.find((a) => a.value === settings.app)?.label ?? 'your email app'
  const { draft, reason } = buildDraft(profile, settings)
  const several = settings.templates.length > 1

  async function open(templateId?: string) {
    setMenu(false)
    const { draft } = buildDraft(profile, settings!, templateId)
    if (!draft) return
    setError(null)
    if (draft.warning && !confirm(draft.warning)) return
    if (!(await openDraftUrl(draft.url))) {
      setError(`Could not open ${app}`)
      return
    }
    setSeen([profile.login])
    onDrafted?.()
  }

  const label = settings.app === 'telegram' ? 'Draft message' : 'Draft email'
  const cls = compact
    ? 'whitespace-nowrap text-xs font-medium text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline'
    : btnSecondary
  return (
    <span ref={box} className="relative inline-block">
      <button
        onClick={() => (several ? setMenu(!menu) : open())}
        disabled={!draft}
        aria-haspopup={several ? 'menu' : undefined}
        aria-expanded={several ? menu : undefined}
        title={draft ? `Open a draft to ${draft.to || `@${profile.login}`} in ${app}. You review and send it yourself.` : reason}
        className={cls}
      >
        ✉ {label}{several && ' ▾'}
      </button>
      {menu && (
        <span role="menu" aria-label="Choose a template"
          className="absolute right-0 z-20 mt-1 block w-56 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
          {settings.templates.map((t) => (
            <button key={t.id} role="menuitem" onClick={() => open(t.id)}
              className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">
              {t.name}
              {t.id === settings.default_template && <span className="ml-1 text-xs text-slate-400">(default)</span>}
            </button>
          ))}
        </span>
      )}
      {error && <span className="block text-xs text-rose-600">{error}</span>}
    </span>
  )
}
