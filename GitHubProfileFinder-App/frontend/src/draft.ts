import type { Profile } from './types'

export type DraftApp = 'my_email' | 'mailto' | 'gmail' | 'outlook' | 'outlook_work' | 'yahoo' | 'telegram' | 'custom'
export type SenderProvider = 'auto' | 'gmail' | 'outlook' | 'outlook_work' | 'other'

export interface Template {
  id: string
  name: string
  subject: string
  body: string
}

export interface DraftSettings {
  app: DraftApp
  custom_url: string
  signature: string // added below every template's message
  templates: Template[]
  default_template: string
  sender_email: string // my_email: drafts open in this address's mailbox
  sender_provider: SenderProvider // 'auto' = detect from the domain
  gmail_link: string // where each web mailbox lives, ending in '/'
  outlook_link: string
  outlook_work_link: string
}

const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']
const OUTLOOK_DOMAINS = /^(outlook|hotmail|live|msn|passport)\.[a-z.]+$/

/** Which web mailbox an address belongs to, from its domain. Company addresses can't be told apart
 *  (they may use Google Workspace or Microsoft 365), so they return null and the user picks. */
export function detectProvider(email: string): 'gmail' | 'outlook' | null {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  if (GMAIL_DOMAINS.includes(domain)) return 'gmail'
  if (OUTLOOK_DOMAINS.test(domain)) return 'outlook'
  return null
}

/** The app a "My email address" setting really opens: Gmail, Outlook.com, Outlook (work) or the default mail app. */
export function senderApp(s: DraftSettings): 'gmail' | 'outlook' | 'outlook_work' | 'mailto' {
  const p = s.sender_provider === 'auto' ? detectProvider(s.sender_email) : s.sender_provider
  return p === 'gmail' || p === 'outlook' || p === 'outlook_work' ? p : 'mailto'
}

export const templateById = (s: DraftSettings, id?: string): Template =>
  s.templates.find((t) => t.id === (id ?? s.default_template)) ?? s.templates[0]

/** The message with the signature below it. */
export function withSignature(body: string, signature: string): string {
  return signature.trim() ? `${body.trimEnd()}\n\n${signature.trim()}\n` : body
}

export const DRAFT_APPS: { value: DraftApp; label: string; hint: string }[] = [
  {
    value: 'my_email',
    label: 'My email address',
    hint: 'Enter your address: Gmail and Outlook addresses are recognised and drafts open in that mailbox.',
  },
  { value: 'mailto', label: 'Default mail app', hint: 'Outlook desktop, Thunderbird, Mail… whichever Windows opens for email links.' },
  { value: 'gmail', label: 'Gmail', hint: 'Opens a Gmail compose window in your browser (sign in to Gmail there first).' },
  { value: 'outlook', label: 'Outlook.com', hint: 'Personal Outlook / Hotmail / Live accounts, in your browser.' },
  { value: 'outlook_work', label: 'Outlook (work or school)', hint: 'Microsoft 365 accounts at outlook.office.com, in your browser.' },
  { value: 'yahoo', label: 'Yahoo Mail', hint: 'Opens a Yahoo Mail compose window in your browser.' },
  {
    value: 'telegram',
    label: 'Telegram',
    hint: 'Opens the chat with people who linked a Telegram account on GitHub; otherwise Telegram asks which chat to use. Subject and message are sent as one text.',
  },
  { value: 'custom', label: 'Other (custom URL)', hint: 'Any service with a compose link. Use {to}, {subject} and {body} where the values go.' },
]

export const PLACEHOLDERS: { key: string; description: string }[] = [
  { key: 'first_name', description: 'First name (username if no name)' },
  { key: 'name', description: 'Full name (username if no name)' },
  { key: 'login', description: 'GitHub username' },
  { key: 'skill', description: 'Top detected skill' },
  { key: 'repo', description: 'Most recently pushed own repository' },
  { key: 'role', description: 'Role from their bio or README' },
  { key: 'company', description: 'Company' },
  { key: 'location', description: 'Location' },
  { key: 'github_url', description: 'Link to their GitHub profile' },
]

export const SAMPLE_VALUES: Record<string, string> = {
  first_name: 'Alex', name: 'Alex Chapin', login: 'alexc', skill: 'Python', repo: 'gis-tools', role: 'GIS Developer',
  company: 'Acme Maps', location: 'Dublin, Ireland', github_url: 'https://github.com/alexc',
}

export function placeholderValues(p: Profile): Record<string, string> {
  const name = p.name?.trim() || p.login
  const ownRepo = p.repositories.find((r) => !r.fork) ?? p.repositories[0]
  return {
    first_name: name.split(/\s+/)[0],
    name,
    login: p.login,
    skill: p.analysis.skills[0]?.name ?? p.languages[0] ?? 'open source',
    repo: ownRepo?.name ?? 'your projects',
    role: p.roles[0]?.title ?? '',
    company: (p.company ?? '').replace(/^@/, '').trim(),
    location: p.location ?? '',
    github_url: p.github_url,
  }
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole))
}

/** Telegram username from a t.me link the person added to their GitHub profile. */
export function telegramUser(p: Profile): string | null {
  for (const l of [...(p.contacts.telegram ? [{ url: p.contacts.telegram.value }] : []), ...p.contacts.links]) {
    const m = l.url.match(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})\/?$/)
    if (m) return m[1]
  }
  return null
}

export const needsEmail = (app: DraftApp) => app !== 'telegram'

export const DEFAULT_LINKS = {
  gmail_link: 'https://mail.google.com/mail/',
  outlook_link: 'https://outlook.live.com/mail/0/',
  outlook_work_link: 'https://outlook.office.com/mail/',
}

const enc = encodeURIComponent
const MAILTO_SAFE_LENGTH = 1800 // longer mailto: links are cut off by some mail apps

export interface Draft {
  url: string
  to: string
  subject: string
  body: string
  warning?: string
}

/** The link that opens a filled-in draft for this person, or null with the reason it can't be made. */
export function buildDraft(p: Profile, s: DraftSettings, templateId?: string): { draft: Draft | null; reason?: string } {
  const values = placeholderValues(p)
  const t = templateById(s, templateId)
  const subject = fillTemplate(t.subject, values).trim()
  const body = fillTemplate(withSignature(t.body, s.signature), values)
  const to = p.contacts.emails[0]?.value ?? ''
  if (needsEmail(s.app) && !to) return { draft: null, reason: 'No public email address' }
  if (s.app === 'custom' && !s.custom_url) return { draft: null, reason: 'Set the custom compose URL on the Email drafts page' }

  const app = s.app === 'my_email' ? senderApp(s) : s.app
  // Gmail can open a specific signed-in account; Outlook opens whichever account is signed in at that link.
  const gmailAccount = s.app === 'my_email' && s.sender_email ? `authuser=${enc(s.sender_email)}&` : ''
  let url: string
  switch (app) {
    case 'mailto':
      url = `mailto:${encodeURI(to)}?subject=${enc(subject)}&body=${enc(body)}`
      break
    case 'gmail':
      url = `${s.gmail_link}?${gmailAccount}view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`
      break
    case 'outlook':
      url = `${s.outlook_link}deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`
      break
    case 'outlook_work':
      url = `${s.outlook_work_link}deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`
      break
    case 'yahoo':
      url = `https://compose.mail.yahoo.com/?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`
      break
    case 'telegram': {
      const text = subject ? `${subject}\n\n${body}` : body
      const user = telegramUser(p)
      url = user ? `https://t.me/${user}?text=${enc(text)}` : `tg://msg?text=${enc(text)}`
      break
    }
    case 'custom':
      url = s.custom_url.replace(/\{to\}/g, enc(to)).replace(/\{subject\}/g, enc(subject)).replace(/\{body\}/g, enc(body))
      break
  }
  const warning =
    app === 'mailto' && url.length > MAILTO_SAFE_LENGTH
      ? 'This message is long: some mail apps cut off long email links. Check the draft before sending.'
      : undefined
  return { draft: { url, to, subject, body, warning } }
}
