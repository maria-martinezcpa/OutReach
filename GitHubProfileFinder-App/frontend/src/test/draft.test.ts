import { describe, expect, it } from 'vitest'
import { buildDraft, fillTemplate, placeholderValues, telegramUser, withSignature, type DraftSettings, type Template } from '../draft'
import { DEFAULT_LINKS, detectProvider, senderApp } from '../draft'
import type { Profile } from '../types'

const person = {
  login: 'dana', name: 'Dana Scully', company: '@acme', location: 'Dublin', github_url: 'https://github.com/dana',
  roles: [{ title: 'GIS Developer', source: 'bio' }], languages: ['Python'],
  analysis: { skills: [{ name: 'PostGIS' }] },
  repositories: [{ name: 'forked', fork: true }, { name: 'map-tools', fork: false }],
  contacts: {
    emails: [{ value: 'dana@example.com', source: 'GitHub public email' }], phones: [], linkedin: null, website: null,
    links: [{ label: 'Telegram', url: 'https://t.me/dana_s', source: 'GitHub linked social accounts' }],
  },
} as unknown as Profile

const settings = (app: DraftSettings['app'], extra: Partial<DraftSettings> & Partial<Template> = {}): DraftSettings => {
  const { subject = 'About {repo}', body = 'Hi {first_name} & co', ...rest } = extra
  return { ...MAILBOX, app, custom_url: '', signature: '', templates: [{ id: 'default', name: 'Default', subject, body }],
    default_template: 'default', ...rest }
}

const MAILBOX = { sender_email: '', sender_provider: 'auto' as const, ...DEFAULT_LINKS }

const params = (url: string) => new URL(url).searchParams

describe('draft links', () => {
  it('fills placeholders per person and leaves unknown ones alone', () => {
    const v = placeholderValues(person)
    expect(v).toMatchObject({ first_name: 'Dana', skill: 'PostGIS', repo: 'map-tools', company: 'acme', role: 'GIS Developer' })
    expect(fillTemplate('{first_name} / {nope}', v)).toBe('Dana / {nope}')
  })

  it('builds a mailto link for the default mail app', () => {
    const { draft } = buildDraft(person, settings('mailto'))
    expect(draft!.url).toBe('mailto:dana@example.com?subject=About%20map-tools&body=Hi%20Dana%20%26%20co')
  })

  it.each([
    ['gmail', 'mail.google.com', 'su'],
    ['outlook', 'outlook.live.com', 'subject'],
    ['outlook_work', 'outlook.office.com', 'subject'],
    ['yahoo', 'compose.mail.yahoo.com', 'subject'],
  ] as const)('builds a %s compose link', (app, host, subject) => {
    const url = buildDraft(person, settings(app)).draft!.url
    expect(new URL(url).host).toBe(host)
    expect(params(url).get('to')).toBe('dana@example.com')
    expect(params(url).get(subject)).toBe('About map-tools')
    expect(params(url).get('body')).toBe('Hi Dana & co')
  })

  it('opens the Telegram chat when the person linked Telegram, otherwise lets Telegram pick the chat', () => {
    expect(telegramUser(person)).toBe('dana_s')
    const url = buildDraft(person, settings('telegram')).draft!.url
    expect(url.startsWith('https://t.me/dana_s?text=')).toBe(true)
    expect(params(url).get('text')).toBe('About map-tools\n\nHi Dana & co')

    const noTelegram = { ...person, contacts: { ...person.contacts, emails: [], links: [] } } as Profile
    expect(buildDraft(noTelegram, settings('telegram')).draft!.url.startsWith('tg://msg?text=')).toBe(true)
  })

  it('uses the Telegram contact found by the backend', () => {
    const p = { ...person, contacts: { ...person.contacts, links: [], telegram: { value: 'https://t.me/dana_tg', source: 'GitHub bio' } } } as Profile
    expect(telegramUser(p)).toBe('dana_tg')
  })

  it('fills a custom compose URL', () => {
    const custom = 'https://mail.example.com/new?rcpt={to}&s={subject}&b={body}'
    const url = buildDraft(person, settings('custom', { custom_url: custom })).draft!.url
    expect(params(url).get('rcpt')).toBe('dana@example.com')
    expect(params(url).get('b')).toBe('Hi Dana & co')
    expect(buildDraft(person, settings('custom')).reason).toMatch(/custom compose URL/)
  })

  it('uses the chosen template, the default otherwise, and adds the signature', () => {
    const s: DraftSettings = {
      ...MAILBOX, app: 'mailto', custom_url: '', signature: '--\n{name} · {login}', default_template: 'b',
      templates: [{ id: 'a', name: 'GIS', subject: 'GIS {repo}', body: 'A' }, { id: 'b', name: 'BIM', subject: 'BIM', body: 'B\n\n' }],
    }
    expect(buildDraft(person, s).draft!.subject).toBe('BIM')
    expect(buildDraft(person, s).draft!.body).toBe('B\n\n--\nDana Scully · dana\n')
    expect(buildDraft(person, s, 'a').draft!.subject).toBe('GIS map-tools')
    expect(buildDraft(person, s, 'missing').draft!.subject).toBe('GIS map-tools') // falls back to the first
    expect(withSignature('Hello', '   ')).toBe('Hello')
  })

  it('needs a public email for email apps and warns about very long mailto links', () => {
    const noEmail = { ...person, contacts: { ...person.contacts, emails: [] } } as unknown as Profile
    expect(buildDraft(noEmail, settings('gmail'))).toEqual({ draft: null, reason: 'No public email address' })
    expect(buildDraft(person, settings('mailto', { body: 'x'.repeat(3000) })).draft!.warning).toMatch(/long/)
    expect(buildDraft(person, settings('gmail', { body: 'x'.repeat(3000) })).draft!.warning).toBeUndefined()
  })
})

describe('my email address', () => {
  const mine = (sender_email: string, extra: Partial<DraftSettings> = {}) =>
    settings('my_email', { sender_email, ...extra })

  it('recognises Gmail and Outlook addresses, and leaves company domains to the user', () => {
    expect(detectProvider('Me@GMAIL.com')).toBe('gmail')
    expect(detectProvider('me@googlemail.com')).toBe('gmail')
    for (const d of ['outlook.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'outlook.de']) expect(detectProvider(`me@${d}`)).toBe('outlook')
    expect(detectProvider('me@acme.io')).toBeNull()
    expect(senderApp(mine('me@acme.io'))).toBe('mailto')
    expect(senderApp(mine('me@acme.io', { sender_provider: 'outlook_work' }))).toBe('outlook_work')
    expect(senderApp(mine('me@gmail.com', { sender_provider: 'other' }))).toBe('mailto')
  })

  it('opens Gmail drafts in that exact account, using the Gmail link', () => {
    const url = buildDraft(person, mine('maria@gmail.com', { gmail_link: 'https://mail.google.com/mail/u/1/' })).draft!.url
    expect(url.startsWith('https://mail.google.com/mail/u/1/?')).toBe(true)
    expect(params(url).get('authuser')).toBe('maria@gmail.com')
    expect(params(url).get('to')).toBe('dana@example.com')
    expect(params(url).get('su')).toBe('About map-tools')
  })

  it('opens Outlook drafts using the Outlook links', () => {
    const live = buildDraft(person, mine('kevin@outlook.com')).draft!.url
    expect(live.startsWith('https://outlook.live.com/mail/0/deeplink/compose?')).toBe(true)
    expect(params(live).get('subject')).toBe('About map-tools')
    const work = buildDraft(person, mine('kevin@acme.io', { sender_provider: 'outlook_work', outlook_work_link: 'https://outlook.office365.com/mail/' })).draft!.url
    expect(work.startsWith('https://outlook.office365.com/mail/deeplink/compose?')).toBe(true)
    expect(buildDraft(person, mine('kevin@acme.io')).draft!.url.startsWith('mailto:dana@example.com?')).toBe(true)
  })
})

