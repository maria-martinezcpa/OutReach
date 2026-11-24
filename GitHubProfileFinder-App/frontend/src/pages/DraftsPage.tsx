import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import { Alert, Card, Spinner, btnDanger, btnPrimary, btnSecondary, input } from '../components/ui'
import {
  DEFAULT_LINKS, DRAFT_APPS, PLACEHOLDERS, SAMPLE_VALUES, detectProvider, fillTemplate, placeholderValues, senderApp,
  templateById, withSignature, type DraftSettings, type SenderProvider, type Template,
} from '../draft'
import type { SavedEntry } from '../types'
import { setDraftSettings, useDraftSettings } from '../useDraftSettings'

const newId = () => `t${Date.now().toString(36)}`

const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook.com', outlook_work: 'Outlook (work or school)', mailto: 'your default mail app' }
const LINKS: { key: 'gmail_link' | 'outlook_link' | 'outlook_work_link'; label: string; hint: string }[] = [
  { key: 'gmail_link', label: 'Gmail link', hint: 'For a second Gmail account signed in on this browser use https://mail.google.com/mail/u/1/' },
  { key: 'outlook_link', label: 'Outlook.com link', hint: 'Personal Outlook, Hotmail and Live accounts' },
  { key: 'outlook_work_link', label: 'Outlook (work or school) link', hint: 'Microsoft 365 accounts' },
]

function PlaceholderButtons({ onInsert }: { onInsert: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PLACEHOLDERS.map((p) => (
        <button key={p.key} type="button" title={p.description} onClick={() => onInsert(p.key)}
          className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">
          {`{${p.key}}`}
        </button>
      ))}
    </div>
  )
}

/** Inserts `{key}` at the cursor of a textarea and returns the new text. */
function insertAt(el: HTMLTextAreaElement | null, text: string, key: string): string {
  const token = `{${key}}`
  if (!el) return text + token
  const { selectionStart: a, selectionEnd: b } = el
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(a + token.length, a + token.length)
  })
  return text.slice(0, a) + token + text.slice(b)
}

export default function DraftsPage() {
  const loaded = useDraftSettings()
  const [edits, setEdits] = useState<DraftSettings | null>(null)
  const form = edits ?? loaded
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedEntry[]>([])
  const [previewLogin, setPreviewLogin] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const sigRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.saved().then(setSaved).catch(() => {})
  }, [])

  if (!form) return <Spinner label="Loading draft settings…" />

  const current = templateById(form, currentId ?? undefined)
  const change = (next: DraftSettings) => {
    setEdits(next)
    setNotice(null)
  }
  const set = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => change({ ...form, [key]: value })
  const setTemplate = (patch: Partial<Template>) =>
    set('templates', form.templates.map((t) => (t.id === current.id ? { ...t, ...patch } : t)))

  function addTemplate(copy: boolean) {
    const t: Template = copy
      ? { ...current, id: newId(), name: `${current.name} (copy)`.slice(0, 60) }
      : { id: newId(), name: `Template ${form!.templates.length + 1}`, subject: '', body: 'Hi {first_name},\n\n' }
    change({ ...form!, templates: [...form!.templates, t] })
    setCurrentId(t.id)
  }

  function deleteTemplate() {
    if (form!.templates.length < 2 || !confirm(`Delete the template "${current.name}"?`)) return
    const templates = form!.templates.filter((t) => t.id !== current.id)
    const default_template = form!.default_template === current.id ? templates[0].id : form!.default_template
    change({ ...form!, templates, default_template })
    setCurrentId(templates[0].id)
  }

  const dirty = !!edits && JSON.stringify(edits) !== JSON.stringify(loaded)
  const detected = detectProvider(form.sender_email)
  const opensIn = form.app === 'my_email' ? senderApp(form) : null
  const needsAddress = form.app === 'my_email' && !form.sender_email.trim()
  const unnamed = form.templates.some((t) => !t.name.trim())
  const app = DRAFT_APPS.find((a) => a.value === form.app)!
  const person = saved.find((e) => e.login === previewLogin)?.profile
  const values = person ? placeholderValues(person) : SAMPLE_VALUES

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const s = await api.saveDraftSettings(form!)
      setDraftSettings(s)
      setEdits(null)
      setNotice('Saved. The Draft email buttons now use these settings.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const saveBar = (
    <div className="flex items-center justify-end gap-3">
      {unnamed && <span className="text-xs text-rose-600">Every template needs a name</span>}
      {needsAddress && <span className="text-xs text-rose-600">Enter your email address</span>}
      {dirty && !unnamed && <span className="text-xs text-amber-700">Unsaved changes</span>}
      <button className={btnPrimary} disabled={busy || !dirty || unnamed || needsAddress} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Email drafts</h1>
        <p className="text-sm text-slate-500">
          Write your messages once. <b>Draft email</b> on a person opens one in your chosen app, filled in for that one person.
          You review, edit and send each message yourself; nothing is sent automatically.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="info">{notice}</Alert>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          <Card title="Open drafts in">
            <div className="space-y-2" role="radiogroup" aria-label="Draft app">
              {DRAFT_APPS.map((a) => (
                <label
                  key={a.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${form.app === a.value ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <input type="radio" name="draft-app" className="mt-1 accent-indigo-600" checked={form.app === a.value} onChange={() => set('app', a.value)} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{a.label}</span>
                    <span className="block text-xs text-slate-500">{a.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {form.app === 'my_email' && (
              <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Your email address</span>
                  <input
                    type="email"
                    className={input}
                    placeholder="you@gmail.com or you@outlook.com"
                    value={form.sender_email}
                    onChange={(e) => set('sender_email', e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">This address uses</span>
                  <select
                    aria-label="Mail provider"
                    className={input}
                    value={form.sender_provider}
                    onChange={(e) => set('sender_provider', e.target.value as SenderProvider)}
                  >
                    <option value="auto">
                      Detect automatically{form.sender_email && ` (${detected ? PROVIDER_LABEL[detected] : 'not recognised'})`}
                    </option>
                    <option value="gmail">Gmail / Google Workspace</option>
                    <option value="outlook">Outlook.com</option>
                    <option value="outlook_work">Outlook (work or school, Microsoft 365)</option>
                    <option value="other">Other: use my default mail app</option>
                  </select>
                </label>
                {form.sender_email && (
                  <p className="text-xs text-slate-600" aria-label="Opens in">
                    Drafts open in <b>{PROVIDER_LABEL[opensIn!]}</b>
                    {opensIn === 'gmail' && <>, in the <b>{form.sender_email}</b> account</>}
                    {opensIn === 'outlook' || opensIn === 'outlook_work' ? ', in the account signed in there' : ''}.
                    {form.sender_provider === 'auto' && !detected && ' Company addresses can’t be recognised: choose Gmail or Outlook above if your company uses one.'}
                  </p>
                )}
              </div>
            )}
            {form.app === 'custom' && (
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Compose URL</span>
                <input
                  className={`${input} font-mono`}
                  placeholder="https://mail.example.com/compose?to={to}&subject={subject}&body={body}"
                  value={form.custom_url}
                  onChange={(e) => set('custom_url', e.target.value)}
                />
                {form.custom_url && !/\{(to|subject|body)\}/.test(form.custom_url) && (
                  <span className="mt-1 block text-xs text-amber-700">
                    This link has no {'{to}'}, {'{subject}'} or {'{body}'}, so the draft will open without the message.
                  </span>
                )}
              </label>
            )}
          </Card>

          {(form.app === 'my_email' || form.app === 'gmail' || form.app === 'outlook' || form.app === 'outlook_work') && (
            <Card title="Mailbox links">
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Where drafts open in the browser. Change these only to use a different account or address.</p>
                {LINKS.map((l) => (
                  <label key={l.key} className="block">
                    <span className="mb-1 flex justify-between text-xs font-medium text-slate-600">
                      {l.label}
                      {form[l.key] !== DEFAULT_LINKS[l.key] && (
                        <button type="button" className="font-normal text-indigo-700 hover:underline" onClick={() => set(l.key, DEFAULT_LINKS[l.key])}>
                          Reset
                        </button>
                      )}
                    </span>
                    <input className={`${input} font-mono`} value={form[l.key]} onChange={(e) => set(l.key, e.target.value)} />
                    <span className="mt-1 block text-xs text-slate-400">{l.hint}</span>
                  </label>
                ))}
                {saveBar}
              </div>
            </Card>
          )}

          <Card title="Signature">
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Added below the message of every template. Placeholders work here too.</p>
              <textarea
                ref={sigRef}
                aria-label="Signature"
                rows={4}
                className={`${input} font-sans`}
                placeholder={'Best regards,\nYour name\nyour@email.com · https://your-site.com'}
                value={form.signature}
                onChange={(e) => set('signature', e.target.value)}
              />
              <PlaceholderButtons onInsert={(k) => set('signature', insertAt(sigRef.current, form.signature, k))} />
              {saveBar}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="Templates"
            actions={
              <div className="flex gap-2">
                <button className={btnSecondary} onClick={() => addTemplate(false)} disabled={form.templates.length >= 20}>+ New</button>
                <button className={btnSecondary} onClick={() => addTemplate(true)} disabled={form.templates.length >= 20}>Duplicate</button>
              </div>
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Templates">
                {form.templates.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={t.id === current.id}
                    onClick={() => setCurrentId(t.id)}
                    className={`rounded-md px-3 py-1 text-sm ${t.id === current.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    {t.name || 'Untitled'}
                    {t.id === form.default_template && <span className="ml-1 opacity-70">★</span>}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Template name</span>
                  <input className={input} value={current.name} maxLength={60} onChange={(e) => setTemplate({ name: e.target.value })} />
                </label>
                <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    checked={form.default_template === current.id}
                    onChange={() => set('default_template', current.id)}
                    disabled={form.default_template === current.id}
                  />
                  Default ★
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Subject</span>
                <input className={input} value={current.subject} onChange={(e) => setTemplate({ subject: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Message</span>
                <textarea ref={bodyRef} rows={10} className={`${input} font-sans`} value={current.body} onChange={(e) => setTemplate({ body: e.target.value })} />
              </label>
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Insert a placeholder (filled in per person)</span>
                <PlaceholderButtons onInsert={(k) => setTemplate({ body: insertAt(bodyRef.current, current.body, k) })} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className={btnDanger} onClick={deleteTemplate} disabled={form.templates.length < 2}>Delete template</button>
                {saveBar}
              </div>
            </div>
          </Card>

          <Card
            title={`Preview: ${current.name || 'Untitled'}`}
            actions={
              <select aria-label="Preview for" value={previewLogin} onChange={(e) => setPreviewLogin(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                <option value="">Sample person</option>
                {saved.map((e) => <option key={e.login} value={e.login}>{e.profile.name || e.login}</option>)}
              </select>
            }
          >
            <div className="space-y-2 text-sm">
              <div className="text-xs text-slate-500">
                Opens in <b>{opensIn ? PROVIDER_LABEL[opensIn] : app.label}</b>
                {form.app !== 'telegram' && <> · to {person ? person.contacts.emails[0]?.value ?? 'no public email' : 'their public email'}</>}
              </div>
              <div className="font-medium text-slate-900" aria-label="Preview subject">{fillTemplate(current.subject, values)}</div>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-slate-700" aria-label="Preview message">
                {fillTemplate(withSignature(current.body, form.signature), values)}
              </pre>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
