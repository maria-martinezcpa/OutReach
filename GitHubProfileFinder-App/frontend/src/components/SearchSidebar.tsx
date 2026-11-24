import { useState, type FormEvent, type ReactNode } from 'react'
import { allKeywords } from '../api'
import type { SearchForm } from '../types'
import Autocomplete from './Autocomplete'
import { btnPrimary, btnSecondary, input } from './ui'

const KEYWORDS_KEY = 'gpf.keywords'

function loadKeywords(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEYWORDS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function storeKeywords(list: string[]) {
  try {
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: shortcuts just won't persist */
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const today = () => new Date().toISOString().slice(0, 10)

const PERIOD_PRESETS: { label: string; since: () => string }[] = [
  { label: '7 days', since: () => isoDaysAgo(7) },
  { label: '30 days', since: () => isoDaysAgo(30) },
  { label: '90 days', since: () => isoDaysAgo(90) },
  { label: '6 months', since: () => isoDaysAgo(182) },
  { label: '1 year', since: () => isoDaysAgo(365) },
]

const MODES: { value: SearchForm['mode']; label: string; help: string; keywordHelp: string }[] = [
  {
    value: 'repositories',
    label: 'Repositories',
    help: 'People who own repositories matching your keywords. Commit dates are checked for each person.',
    keywordHelp: 'Matches repository names, descriptions and topics. Examples: unity, "game engine", topic:webgl, react OR vue',
  },
  {
    value: 'commits',
    label: 'Commits',
    help: 'People whose commit messages match your keywords, found directly by commit date. Great for "who worked on X recently".',
    keywordHelp: 'Matches commit messages. Examples: shader, "fix memory leak", migrate kubernetes',
  },
  {
    value: 'users',
    label: 'Profiles',
    help: 'GitHub user search by name, username, location and stats. Commit dates are checked for each person.',
    keywordHelp: 'Matches username, name and email. Examples: john, "Jane Doe"',
  },
]

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </div>
  )
}

interface Props {
  form: SearchForm
  onChange: (form: SearchForm) => void
  onSubmit: () => void
  onReset: () => void
  onBackground: (target: number) => void
  loading: boolean
  starting?: boolean
}

export default function SearchSidebar({ form, onChange, onSubmit, onReset, onBackground, loading, starting }: Props) {
  const set = <K extends keyof SearchForm>(key: K, value: SearchForm[K]) => onChange({ ...form, [key]: value })
  const [keywords, setKeywords] = useState<string[]>(loadKeywords)
  const [target, setTarget] = useState('100')
  const current = allKeywords(form)
  const unkept = current.filter((k) => !keywords.includes(k))
  const addKeyword = (k: string) => {
    const t = k.trim()
    if (!t || form.keywords.some((x) => x.toLowerCase() === t.toLowerCase())) return onChange({ ...form, q: '' })
    onChange({ ...form, q: '', keywords: [...form.keywords, t] })
  }
  const removeKeyword = (k: string) => set('keywords', form.keywords.filter((x) => x !== k))
  const mode = MODES.find((m) => m.value === form.mode) ?? MODES[0]
  const updateKeywords = (list: string[]) => {
    setKeywords(list)
    storeKeywords(list)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }
  const periodError = form.since && form.until && form.since > form.until ? 'Start date must be before end date' : ''

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Search filters">
      <div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={form.mode === m.value}
              onClick={() => set('mode', m.value)}
              className={`rounded-md px-2 py-1.5 font-medium transition ${form.mode === m.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{mode.help}</p>
      </div>

      <Field
        label="Keywords — people matching ANY of them are included"
        hint={`Press Enter or comma after each keyword. ${mode.keywordHelp}`}
      >
        <div className="rounded-lg border border-slate-300 bg-white p-1.5 focus-within:border-indigo-400">
          {form.keywords.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1" aria-label="Search keywords">
              {form.keywords.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 py-0.5 pl-2 pr-1 text-xs font-medium text-indigo-800">
                  {k}
                  <button type="button" aria-label={`Remove keyword ${k}`} onClick={() => removeKeyword(k)} className="rounded px-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-800">
                    ×
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => onChange({ ...form, keywords: [] })} className="px-1 text-xs text-slate-400 hover:text-slate-700">
                clear
              </button>
            </div>
          )}
          <Autocomplete
            field="keyword"
            label="Keywords"
            value={form.q}
            onChange={(v) => set('q', v)}
            onCommit={addKeyword}
            onBackspaceEmpty={() => form.keywords.length && removeKeyword(form.keywords[form.keywords.length - 1])}
            placeholder={form.keywords.length ? 'Add another keyword…' : 'Type a keyword, press Enter: gis, bim, revit…'}
          />
        </div>
        {unkept.length > 0 && (
          <button
            type="button"
            title="Keep these keywords as one-click shortcuts"
            onClick={() => updateKeywords([...keywords, ...unkept])}
            className="mt-1 text-xs text-slate-500 hover:text-indigo-700"
          >
            ＋ Keep {unkept.length === 1 ? `"${unkept[0]}"` : `these ${unkept.length} keywords`} as shortcuts
          </button>
        )}
      </Field>
      {keywords.length > 0 && (
        <div className="-mt-3 flex flex-wrap gap-1" aria-label="My keywords">
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center rounded-full border border-slate-200 bg-white text-xs text-slate-600">
              <button type="button" title="Add to the search" onClick={() => addKeyword(k)} className="py-0.5 pl-2 pr-1 hover:text-indigo-700">
                {k}
              </button>
              <button
                type="button"
                aria-label={`Remove ${k}`}
                onClick={() => updateKeywords(keywords.filter((x) => x !== k))}
                className="pr-2 text-slate-400 hover:text-rose-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <fieldset className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
        <legend className="px-1 text-xs font-semibold text-indigo-900">Commit date</legend>
        <p className="text-xs text-slate-500">Only people who authored commits between these dates.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <input type="date" aria-label="Commit date from" className={input} value={form.since} max={today()} onChange={(e) => set('since', e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" aria-label="Commit date to" className={input} value={form.until} max={today()} onChange={(e) => set('until', e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange({ ...form, since: p.since(), until: today() })}
              className="rounded-md border border-indigo-200 bg-white px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50"
            >
              {p.label}
            </button>
          ))}
          {(form.since || form.until) && (
            <button type="button" onClick={() => onChange({ ...form, since: '', until: '' })} className="px-2 py-0.5 text-xs text-slate-500 hover:text-slate-800">
              Clear
            </button>
          )}
        </div>
        {periodError && <p className="text-xs text-rose-600">{periodError}</p>}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Language">
          <Autocomplete field="language" label="Language" value={form.language} onChange={(v) => set('language', v)} placeholder="Type: Pyt, Rus…" />
        </Field>
        <Field label="Location">
          <Autocomplete field="location" label="Location" value={form.location} onChange={(v) => set('location', v)} placeholder="Type: Ber, Lon…" />
        </Field>
        <Field label="Country">
          <Autocomplete field="country" label="Country" value={form.country} onChange={(v) => set('country', v)} placeholder="Type: Ger, Ind…" />
        </Field>
        <Field label="Region">
          <Autocomplete field="region" label="Region" value={form.region} onChange={(v) => set('region', v)} placeholder="Europe, Middle East…" />
        </Field>
        <Field label="Min followers">
          <input type="number" min={0} aria-label="Min followers" className={input} value={form.min_followers} onChange={(e) => set('min_followers', e.target.value)} />
        </Field>
        <Field label="Min repos">
          <input type="number" min={0} aria-label="Min repos" className={input} value={form.min_repos} onChange={(e) => set('min_repos', e.target.value)} />
        </Field>
        <Field label="Min account age (yrs)">
          <input type="number" min={0} step={0.5} aria-label="Min account age" className={input} value={form.min_account_age_years} onChange={(e) => set('min_account_age_years', e.target.value)} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-600">Must have public…</legend>
        <p className="mb-2 text-xs text-slate-500">
          Always required: at least one of <b>email</b>, <b>phone</b>, <b>LinkedIn</b> or <b>Telegram</b>. People without any are skipped.
          Tick boxes below to require specific ones.
        </p>
        <div className="grid grid-cols-2 gap-1 text-sm">
          {(
            [
              ['require_email', 'Email'],
              ['require_phone', 'Phone'],
              ['require_linkedin', 'LinkedIn'],
              ['require_telegram', 'Telegram'],
              ['require_website', 'Website'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" className="accent-indigo-600" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Candidates per page" hint="People appear one by one as soon as they are found.">
        <select className={input} aria-label="Candidates per page" value={form.per_page} onChange={(e) => set('per_page', e.target.value)}>
          {['5', '10', '20', '30'].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </Field>

      <div className="flex gap-2">
        <button type="submit" className={`${btnPrimary} flex-1`} disabled={loading || !!periodError}>
          {loading ? 'Searching…' : 'Search'}
        </button>
        <button type="button" className={btnSecondary} onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-slate-600">
          <b>Background search</b> keeps going page after page and adds every match to a list. Run several at once.
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            Stop after
            <input
              type="number"
              min={1}
              aria-label="Stop after people"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            people
          </label>
          <button
            type="button"
            className={`${btnSecondary} flex-1`}
            disabled={starting || !!periodError}
            onClick={() => onBackground(Math.max(1, Math.round(Number(target)) || 100))}
          >
            {starting ? 'Starting…' : 'Run in background'}
          </button>
        </div>
      </div>
    </form>
  )
}
