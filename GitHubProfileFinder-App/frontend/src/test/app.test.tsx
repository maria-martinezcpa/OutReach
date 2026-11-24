import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toQuery } from '../api'
import App from '../App'
import { emptyForm, type Profile } from '../types'
import { setDraftSettings } from '../useDraftSettings'
import { resetSeenCache } from '../useSeen'
import { resetFollowerScans } from '../useFollowerScans'
import { DEFAULT_LINKS } from '../draft'

const MAILBOX = { sender_email: '', sender_provider: 'auto' as const, ...DEFAULT_LINKS }

// Clearly labelled mock data for UI tests only.
const MOCK_PROFILE: Profile = {
  id: 1,
  login: 'mock-dev',
  name: 'Mock Developer',
  avatar_url: null,
  github_url: 'https://github.com/mock-dev',
  bio: 'Senior Game Developer',
  company: 'Mock Co',
  location: 'Berlin, Germany',
  country: 'Germany',
  region: 'Western Europe',
  continent: 'Europe',
  hireable: true,
  type: 'User',
  roles: [{ title: 'Senior Game Developer', source: 'GitHub bio' }],
  contacts: {
    emails: [{ value: 'mock@example.test', source: 'GitHub public email' }],
    phones: [],
    linkedin: { value: 'https://linkedin.com/in/mock', source: 'GitHub linked social accounts' },
    website: null,
    links: [],
  },
  followers: 42,
  following: 3,
  public_repos: 12,
  created_at: '2016-01-01T00:00:00Z',
  languages: ['C++'],
  repositories: [],
  analysis: {
    human_confidence: 'HIGH',
    activity_status: 'ACTIVE',
    last_push: '2026-08-01T00:00:00Z',
    skills: [{ name: 'Unity', confidence: 0.9, level: 'HIGH', evidence_repos: ['engine'], sources: [], basis: '' }],
    evidence: [],
    limitations: [],
    method: 'test',
  },
  fetched_at: '2026-09-01T00:00:00Z',
  period_activity: {
    since: '2026-01-01', until: '2026-06-30', commits: 17, commits_capped: false, repos: [], checked_repos: 3,
    last_commit_at: '2026-06-20T10:00:00Z', source: 'test',
  },
  saved: false,
}

const SUMMARY = {
  page: 1, per_page: 10, total_candidates: 1, checked: 3, filtered_out: 2, failed: [],
  query: 'engine pushed:>=2026-01-01', has_more: false, warning: null,
}

/** Stand-in for the browser's EventSource so tests can push server-sent events. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  onerror: (() => void) | null = null
  private listeners: Record<string, ((e: { data: string }) => void)[]> = {}
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  close() {
    this.closed = true
  }
  emit(type: string, data: unknown) {
    act(() => this.listeners[type]?.forEach((fn) => fn({ data: JSON.stringify(data) })))
  }
  static get last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]
  }
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown = () => ({})) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown
    if (url.startsWith('/api/health')) body = { status: 'ok', github_token_configured: true }
    else body = handler(url, init)
    // The nav bar polls the jobs list on every page: an empty list unless the test gives one.
    if (url === '/api/jobs' && !init?.method && !Array.isArray(body)) body = []
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const keywordBox = () => screen.getByRole('combobox', { name: 'Keywords' })

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('toQuery', () => {
  it('drops empty values and keeps commit dates and flags', () => {
    const q = new URLSearchParams(
      toQuery({ ...emptyForm, keywords: ['gis', 'bim'], q: 'engine', since: '2026-01-01', until: '2026-06-30', require_email: true }, 2),
    )
    expect(q.get('keywords')).toBe('gis,bim,engine')
    expect(q.get('q')).toBeNull()
    expect(q.get('since')).toBe('2026-01-01')
    expect(q.get('require_email')).toBe('true')
    expect(q.get('require_phone')).toBeNull()
    expect(q.get('location')).toBeNull()
    expect(q.get('page')).toBe('2')
  })
})

describe('streaming search', () => {
  it('shows each person as soon as the server finds them', async () => {
    mockFetch()
    render(<App />)
    await userEvent.type(keywordBox(), 'engine')
    await userEvent.click(screen.getByRole('button', { name: '90 days' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    const es = FakeEventSource.last
    const params = new URLSearchParams(es.url.split('?')[1])
    expect(es.url.startsWith('/api/search/stream?')).toBe(true)
    expect(params.get('keywords')).toBe('engine')
    expect(params.get('since')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    es.emit('progress', { candidates: 3, checked: 1, filtered_out: 1, found: 0, total_candidates: 50, query: SUMMARY.query })
    expect(screen.getByText(/Checking people: 1 of 3/)).toBeInTheDocument()

    // The person is on screen while the search is still running.
    es.emit('item', MOCK_PROFILE)
    expect(screen.getByText('Mock Developer')).toBeInTheDocument()
    expect(screen.getByText('mock@example.test')).toBeInTheDocument()
    expect(screen.getByText(/17\s*commits in period/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    es.emit('done', SUMMARY)
    expect(es.closed).toBe(true)
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.getByText(/query: engine pushed:>=2026-01-01/)).toBeInTheDocument()
  })

  it('stop closes the stream and keeps what was found', async () => {
    mockFetch()
    render(<App />)
    await userEvent.type(keywordBox(), 'engine')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    const es = FakeEventSource.last
    es.emit('item', MOCK_PROFILE)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(es.closed).toBe(true)
    expect(screen.getByText('Mock Developer')).toBeInTheDocument()
  })

  it('saves a profile', async () => {
    const fetchMock = mockFetch((url, init) =>
      url.startsWith('/api/saved/') && init?.method === 'POST' ? { login: 'mock-dev', saved_at: '', note: '', profile: MOCK_PROFILE } : {},
    )
    render(<App />)
    await userEvent.type(keywordBox(), 'engine')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    FakeEventSource.last.emit('item', MOCK_PROFILE)
    await userEvent.click(screen.getByRole('button', { name: /☆ Save/ }))
    expect(await screen.findByRole('button', { name: /★ Saved/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/saved/mock-dev' && i?.method === 'POST')).toBe(true)
  })

  it('shows rate-limit errors from the server', async () => {
    mockFetch()
    render(<App />)
    await userEvent.type(keywordBox(), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    FakeEventSource.last.emit('failed', { detail: 'GitHub API rate limit reached' })
    expect(await screen.findByRole('alert')).toHaveTextContent('rate limit')
  })

  it('blocks searching with an inverted commit date range', async () => {
    mockFetch()
    render(<App />)
    await userEvent.type(screen.getByLabelText('Commit date from'), '2026-05-01')
    await userEvent.type(screen.getByLabelText('Commit date to'), '2026-01-01')
    await waitFor(() => expect(screen.getByText('Start date must be before end date')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('searches commits by commit date in commit mode', async () => {
    mockFetch()
    render(<App />)
    await userEvent.click(screen.getByRole('radio', { name: 'Commits' }))
    expect(screen.getByText(/found directly by commit date/)).toBeInTheDocument()
    await userEvent.type(keywordBox(), 'shader')
    await userEvent.click(screen.getByRole('button', { name: '30 days' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(new URLSearchParams(FakeEventSource.last.url.split('?')[1]).get('mode')).toBe('commits')
  })
})

describe('suggestions', () => {
  it('suggests GitHub topics while typing and fills the chosen one', async () => {
    const fetchMock = mockFetch((url) =>
      url.startsWith('/api/suggest?field=keyword') ? [{ value: 'unity', label: 'Unity', hint: 'Unity is a game engine.' }] : {},
    )
    render(<App />)
    await userEvent.type(keywordBox(), 'uni')
    const option = await screen.findByRole('option', { name: /unity/i })
    expect(option).toHaveTextContent('Unity is a game engine.')
    await userEvent.click(option)
    // Picking a suggestion adds it as a keyword chip and clears the box for the next one.
    expect(screen.getByLabelText('Search keywords')).toHaveTextContent('unity')
    expect(keywordBox()).toHaveValue('')
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/suggest?field=keyword&q=uni')).toBe(true)
  })

  it('supports keyboard selection for language', async () => {
    mockFetch((url) => (url.startsWith('/api/suggest?field=language') ? [{ value: 'TypeScript', hint: 'GitHub language' }] : {}))
    render(<App />)
    const box = screen.getByRole('combobox', { name: 'Language' })
    await userEvent.type(box, 'type')
    await screen.findByRole('option', { name: /TypeScript/ })
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(box).toHaveValue('TypeScript')
  })

  it('keeps any keyword as a reusable shortcut', async () => {
    mockFetch(() => [])
    render(<App />)
    await userEvent.type(keywordBox(), 'unreal engine{Enter}')
    await userEvent.click(screen.getByRole('button', { name: /Keep/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove keyword unreal engine' }))
    await userEvent.click(screen.getByRole('button', { name: 'unreal engine' }))
    expect(screen.getByLabelText('Search keywords')).toHaveTextContent('unreal engine')
    expect(JSON.parse(localStorage.getItem('gpf.keywords')!)).toEqual(['unreal engine'])
  })
})

describe('background search', () => {
  const JOB = {
    id: 'job1', name: 'unreal engine', query: 'unreal engine', params: {}, target: 50, status: 'running',
    created_at: '2026-09-26T10:00:00+00:00', updated_at: '2026-09-26T10:00:00+00:00', next_page: 2, pages_done: 1,
    checked: 20, filtered_out: 19, failed: 0, total_candidates: 900, found: 1, wait_until: null, message: null,
  }

  it('starts a background search and lists people as they are found', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      let body: unknown = { status: 'ok', github_token_configured: true }
      if (url === '/api/jobs' && init?.method === 'POST') body = JOB
      else if (url === '/api/jobs') body = [JOB]
      else if (url.startsWith('/api/jobs/job1/results')) body = [MOCK_PROFILE]
      else if (url.startsWith('/api/suggest')) body = []
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await userEvent.type(keywordBox(), 'unreal engine')
    await userEvent.clear(screen.getByLabelText('Stop after people'))
    await userEvent.type(screen.getByLabelText('Stop after people'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'Run in background' }))

    expect(await screen.findByRole('heading', { name: 'unreal engine' })).toBeInTheDocument()
    expect(screen.getByText(/of 50 people found/)).toBeInTheDocument()
    expect(await screen.findByText('mock@example.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/jobs' && i?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ keywords: 'unreal engine', target: 50, mode: 'repositories' })
  })

  it('warns when the server has no GitHub token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.startsWith('/api/health') ? { status: 'ok', github_token_configured: false } : []), { status: 200 })))
    render(<App />)
    expect(await screen.findByText(/No GitHub token is configured/)).toBeInTheDocument()
  })
})

describe('token management', () => {
  const quota = { limit: 5000, remaining: 0, reset: 1900000000 }
  const ENV_TOKEN = {
    id: 'env', label: 'From backend/.env', masked: 'ghp_…Hux', login: 'me', source: 'env', active: true,
    added_at: null, valid: true, error: null, core: quota, search: { limit: 30, remaining: 30, reset: 1900000000 },
  }

  it('lists tokens with quota and adds a new one', async () => {
    let tokens: unknown[] = [ENV_TOKEN]
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/tokens' && init?.method === 'POST') {
        const added = { ...ENV_TOKEN, id: 'abc', label: 'Backup', masked: 'ghp_…0000', source: 'app', active: false,
          core: { ...quota, remaining: 5000 } }
        tokens = [ENV_TOKEN, added]
        return added
      }
      if (url === '/api/tokens') return tokens
      return {}
    })
    window.history.pushState({}, '', '/settings')
    render(<App />)
    expect(await screen.findByText('From backend/.env')).toBeInTheDocument()
    expect(screen.getByText('ghp_…Hux')).toBeInTheDocument()
    expect(screen.getByText('100% used')).toBeInTheDocument()
    expect(screen.getByText(/\(5,000 \/ 5,000\) · 0 left/)).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: /Core API/ })).toHaveAttribute('aria-valuenow', '100')

    await userEvent.type(screen.getByLabelText('Token'), 'ghp_newtoken0000000000000000')
    await userEvent.type(screen.getByLabelText('Token name'), 'Backup')
    await userEvent.click(screen.getByRole('button', { name: 'Add & verify' }))
    expect(await screen.findByText('Backup')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use this token' })).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/tokens' && i?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toEqual({ token: 'ghp_newtoken0000000000000000', label: 'Backup' })
    window.history.pushState({}, '', '/')
  })

  it('shows the active token usage rate in the header', async () => {
    mockFetch((url) => {
      if (url === '/api/rate-limit') return { core: { limit: 5000, remaining: 3750, reset: 1900000000 }, search: null }
      return url === '/api/jobs' ? [] : {}
    })
    render(<App />)
    const badge = await screen.findByTitle(/1,250 of 5,000 requests used this hour \(25%\)/)
    expect(badge).toHaveTextContent('GitHub API 25% used')
    expect(badge).toHaveTextContent('3,750 / 5,000 left')
  })

  it('shows the used count GitHub reported and when, and explains unknown search usage', async () => {
    const at = 1900000000
    mockFetch((url) => {
      if (url === '/api/rate-limit') return { core: { limit: 5000, remaining: 4993, used: 7, reset: at + 3600, observed_at: at }, search: null }
      if (url === '/api/tokens') return [{ ...ENV_TOKEN, core: { limit: 5000, remaining: 4993, used: 7, reset: at + 3600, observed_at: at }, search: null }]
      return url === '/api/jobs' ? [] : {}
    })
    window.history.pushState({}, '', '/settings')
    render(<App />)
    const badge = await screen.findByTitle(/7 of 5,000 requests used this hour \(0%\)/)
    expect(badge.getAttribute('title')).toMatch(/Reported by GitHub at .*Search API: shown after the next search\./)
    expect(await screen.findByText('shown after the next search with this token')).toBeInTheDocument()
    expect(screen.getByText(/\(7 \/ 5,000\) · 4,993 left/)).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('connects a GitHub App and shows its auto-renewed token with its limit', async () => {
    const APP = { ...ENV_TOKEN, id: 'github-app', label: 'GitHub App: Finder', masked: 'installation token (renewed automatically)',
      login: 'my-org', source: 'github_app', core: { limit: 12500, remaining: 12400, reset: 1900000000 } }
    let tokens: unknown[] = [ENV_TOKEN]
    let app: unknown = { configured: false }
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/github-app' && init?.method === 'PUT') {
        tokens = [APP, { ...ENV_TOKEN, active: false }]
        app = { configured: true, app_id: '123', installation_id: '777', app_name: 'Finder', account: 'my-org', active: true,
          token_expires_at: '2026-09-26T20:00:00+00:00' }
        return app
      }
      if (url === '/api/github-app') return app
      if (url === '/api/tokens') return tokens
      return {}
    })
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await userEvent.type(await screen.findByLabelText('App ID'), '123')
    await userEvent.type(screen.getByLabelText('Private key'), '-----BEGIN RSA PRIVATE KEY-----abc')
    await userEvent.click(screen.getByRole('button', { name: 'Connect & verify' }))

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(await screen.findByText('GitHub App: Finder')).toBeInTheDocument()
    expect(screen.getByText(/\(100 \/ 12,500\) · 12,400 left/)).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/github-app' && i?.method === 'PUT')!
    expect(JSON.parse(put[1]!.body as string)).toMatchObject({ app_id: '123', installation_id: '' })
    window.history.pushState({}, '', '/')
  })
})

describe('region search', () => {
  it('sends the region filter and shows the region on results', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith('/api/suggest')) return [{ value: 'Western Europe', label: 'Western Europe', hint: 'Region' }]
      return { status: 'ok', github_token_configured: true }
    })
    render(<App />)
    expect(screen.getByLabelText('Region')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Region'), 'Western Europe')
    expect(toQuery({ ...emptyForm, q: 'x', region: 'Western Europe' }, 1)).toContain('region=Western+Europe')
    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('outreach tracker', () => {
  it('updates status, follow-up and notes on saved profiles and filters by due follow-ups', async () => {
    let entry = { login: MOCK_PROFILE.login, saved_at: '2026-09-01T10:00:00+00:00', note: '', status: '', follow_up: null,
      updated_at: null, profile: MOCK_PROFILE }
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/saved' && !init?.method) return [entry]
      if (init?.method === 'PATCH') return (entry = { ...entry, ...JSON.parse(init.body as string) })
      return []
    })
    window.history.pushState({}, '', '/saved')
    render(<App />)
    const login = MOCK_PROFILE.login
    await userEvent.selectOptions(await screen.findByLabelText(`Status for ${login}`), 'contacted')
    const patches = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH')
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0][0]).toBe(`/api/saved/${login}`)
    expect(JSON.parse(patches()[0][1]!.body as string)).toEqual({ status: 'contacted' })

    await userEvent.type(screen.getByLabelText(`Follow-up date for ${login}`), '2020-01-01')
    expect(await screen.findByText('Follow-up due')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(`Notes for ${login}`), 'Asked about their GIS work')
    await userEvent.tab()
    await waitFor(() => expect(JSON.parse(patches().at(-1)![1]!.body as string)).toEqual({ note: 'Asked about their GIS work' }))

    await userEvent.selectOptions(screen.getByLabelText('Outreach status filter'), 'not_interested')
    expect(screen.queryByLabelText(`Status for ${login}`)).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Outreach status filter'), 'due')
    expect(screen.getByLabelText(`Status for ${login}`)).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})

describe('email drafts', () => {
  const MAILTO = { ...MAILBOX, app: 'mailto' as const, custom_url: '', signature: '', default_template: 'default',
    templates: [{ id: 'default', name: 'Default', subject: 'About {repo}', body: 'Hi {first_name}' }] }

  it('opens a filled-in draft for one saved person and offers to mark them contacted', async () => {
    setDraftSettings(MAILTO)
    let entry = { login: MOCK_PROFILE.login, saved_at: '2026-09-01T10:00:00+00:00', note: '', status: 'to_contact', follow_up: null,
      updated_at: null, profile: MOCK_PROFILE }
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/saved' && !init?.method) return [entry]
      if (url === '/api/open-url') return { opened: true }
      if (init?.method === 'PATCH') return (entry = { ...entry, ...JSON.parse(init.body as string) })
      return []
    })
    window.history.pushState({}, '', '/saved')
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /Draft email/ }))
    const open = fetchMock.mock.calls.find(([u]) => u === '/api/open-url')!
    const url: string = JSON.parse(open[1]!.body as string).url
    expect(url.startsWith(`mailto:${MOCK_PROFILE.contacts.emails[0].value}?subject=`)).toBe(true)
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false) // nothing changes by itself

    await userEvent.click(screen.getByRole('button', { name: 'Sent it? Mark contacted' }))
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ status: 'contacted' })
    window.history.pushState({}, '', '/')
  })

  it('saves the chosen app and template on the Email drafts page', async () => {
    setDraftSettings(MAILTO)
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/draft-settings' && init?.method === 'PUT') return JSON.parse(init.body as string)
      return []
    })
    window.history.pushState({}, '', '/drafts')
    render(<App />)
    await userEvent.click(await screen.findByRole('radio', { name: /^Gmail/ }))
    const subject = screen.getByLabelText('Subject')
    await userEvent.clear(subject)
    await userEvent.type(subject, 'Hello {{first_name}')
    expect(screen.getByLabelText('Preview subject')).toHaveTextContent('Hello Alex')
    // A second template, made the default, and a signature below every message.
    await userEvent.click(screen.getByRole('button', { name: '+ New' }))
    expect(screen.getByRole('tab', { name: 'Template 2' })).toHaveAttribute('aria-selected', 'true')
    const name = screen.getByLabelText('Template name')
    await userEvent.clear(name)
    await userEvent.type(name, 'BIM')
    await userEvent.click(screen.getByRole('checkbox', { name: /Default/ }))
    await userEvent.type(screen.getByLabelText('Signature'), 'Luke')
    expect(screen.getByLabelText('Preview message')).toHaveTextContent(/Hi Alex,\s+Luke/)

    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await screen.findByText(/Saved\./)
    const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/draft-settings' && i?.method === 'PUT')!
    const body = JSON.parse(put[1]!.body as string)
    expect(body).toMatchObject({ app: 'gmail', signature: 'Luke' })
    expect(body.templates.map((t: { name: string }) => t.name)).toEqual(['Default', 'BIM'])
    expect(body.templates[0].subject).toBe('Hello {first_name}')
    expect(body.default_template).toBe(body.templates[1].id)
    setDraftSettings(MAILTO)
    window.history.pushState({}, '', '/')
  })
})

describe('drafts with several templates and the follow-up badge', () => {
  it('lets you pick a template per person when there are several', async () => {
    setDraftSettings({ ...MAILBOX, app: 'mailto', custom_url: '', signature: 'Luke', default_template: 'gis', templates: [
      { id: 'gis', name: 'GIS', subject: 'GIS {repo}', body: 'Hi' }, { id: 'bim', name: 'BIM', subject: 'BIM work', body: 'Hey' }] })
    const entry = { login: MOCK_PROFILE.login, saved_at: '2026-09-01T10:00:00+00:00', note: '', status: '', follow_up: null,
      updated_at: null, profile: MOCK_PROFILE }
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/saved' && !init?.method) return [entry]
      if (url === '/api/open-url') return { opened: true }
      return []
    })
    window.history.pushState({}, '', '/saved')
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /Draft email/ }))
    expect(screen.getByRole('menuitem', { name: /GIS.*default/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'BIM' }))
    const url: string = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/open-url')![1]!.body as string).url
    expect(url).toContain('subject=BIM%20work')
    expect(url).toContain('body=Hey%0A%0ALuke')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('shows how many follow-ups are due on the Saved menu item', async () => {
    mockFetch((url) => (url === '/api/saved/summary' ? { total: 5, follow_ups_due: 3 } : []))
    render(<App />)
    expect(await screen.findByTitle('3 follow-ups due')).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: /Saved/ })).toContainElement(screen.getByTitle('3 follow-ups due'))
  })
})

describe('draft queue', () => {
  it('drafts one person after another and marks each Drafted', async () => {
    setDraftSettings({ ...MAILBOX, app: 'mailto', custom_url: '', signature: '', default_template: 'default',
      templates: [{ id: 'default', name: 'Default', subject: 'Hi {first_name}', body: 'Hello' }] })
    const person = (login: string, email: string | null, status = '') => ({
      login, saved_at: '2026-09-01T10:00:00+00:00', note: '', status, follow_up: null, updated_at: null,
      profile: { ...MOCK_PROFILE, id: login.length, login, name: login.toUpperCase(),
        contacts: { ...MOCK_PROFILE.contacts, emails: email ? [{ value: email, source: 'GitHub public email' }] : [] } },
    })
    const entries = [person('ann', 'ann@x.io'), person('ben', null), person('cat', 'cat@x.io', 'contacted'), person('dan', 'dan@x.io')]
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/saved' && !init?.method) return entries
      if (url === '/api/open-url') return { opened: true }
      if (init?.method === 'PATCH') {
        const login = url.split('/').pop()!
        return { ...entries.find((e) => e.login === login), ...JSON.parse(init.body as string) }
      }
      return []
    })
    const opened = () => fetchMock.mock.calls.filter(([u]) => u === '/api/open-url')
      .map(([, i]) => decodeURIComponent(JSON.parse(i!.body as string).url).split('?')[0])
    const patches = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH')
      .map(([u, i]) => [u, JSON.parse(i!.body as string).status])

    window.history.pushState({}, '', '/saved')
    render(<App />)
    // ben has no email and cat was already contacted, so only ann and dan are queued.
    await userEvent.click(await screen.findByRole('button', { name: 'Start queue (2)' }))
    const queue = screen.getByRole('region', { name: 'Draft queue' })
    expect(queue).toHaveTextContent('Draft 1 of 2')
    expect(queue).toHaveTextContent('ANN')
    await waitFor(() => expect(opened()).toEqual(['mailto:ann@x.io']))

    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(queue).toHaveTextContent('Draft 2 of 2')
    await waitFor(() => expect(opened()).toEqual(['mailto:ann@x.io', 'mailto:dan@x.io']))
    expect(patches()).toEqual([['/api/saved/ann', 'drafted']])

    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('{Enter}') // Enter = Next
    expect(queue).toHaveTextContent('Queue finished')
    expect(queue).toHaveTextContent('2 marked Drafted')
    expect(patches()).toEqual([['/api/saved/ann', 'drafted'], ['/api/saved/dan', 'drafted']])

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Draft queue' })).not.toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('queues only the ticked people when some are ticked, and Skip leaves a person unmarked', async () => {
    setDraftSettings({ ...MAILBOX, app: 'gmail', custom_url: '', signature: '', default_template: 'default',
      templates: [{ id: 'default', name: 'Default', subject: 'Hi', body: 'Hello' }] })
    const entries = ['ann', 'ben', 'cat'].map((login) => ({
      login, saved_at: '2026-09-01T10:00:00+00:00', note: '', status: '', follow_up: null, updated_at: null,
      profile: { ...MOCK_PROFILE, id: login.length + login.charCodeAt(0), login,
        contacts: { ...MOCK_PROFILE.contacts, emails: [{ value: `${login}@x.io`, source: 'GitHub public email' }] } },
    }))
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/saved' && !init?.method) return entries
      if (url === '/api/open-url') return { opened: true }
      return []
    })
    window.history.pushState({}, '', '/saved')
    render(<App />)
    await userEvent.click(await screen.findByLabelText('Tick cat'))
    await userEvent.click(screen.getByLabelText('Tick ann'))
    await userEvent.click(screen.getByRole('button', { name: 'Start queue (2)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('region', { name: 'Draft queue' })).toHaveTextContent('Draft 2 of 2')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false)
    const urls = fetchMock.mock.calls.filter(([u]) => u === '/api/open-url').map(([, i]) => JSON.parse(i!.body as string).url as string)
    expect(urls.map((u) => new URL(u).searchParams.get('to'))).toEqual(['ann@x.io', 'cat@x.io']) // table order
    window.history.pushState({}, '', '/')
  })
})

describe('all accounts', () => {
  it('lists everyone from all searches and filters by email text, domain or no email', async () => {
    const person = (login: string, emails: string[], found_in: string[]) => ({
      ...MOCK_PROFILE, id: login.charCodeAt(0), login, name: login.toUpperCase(), found_in,
      contacts: { ...MOCK_PROFILE.contacts, emails: emails.map((value) => ({ value, source: 'GitHub public email' })) },
    })
    mockFetch((url) => url === '/api/accounts'
      ? [person('ann', ['ann@gmail.com'], ['gis', 'bim']), person('ben', ['ben@outlook.com', 'b@gmail.com'], ['gis']),
         person('cat', [], ['bim']), person('dan', ['dan@acme.io'], ['gis', 'bim', 'unity'])]
      : [])
    window.history.pushState({}, '', '/accounts')
    render(<App />)
    expect(await screen.findByText(/people found across 3 background/)).toHaveTextContent('4 people found across 3 background searches')
    expect(screen.getByText(/3 with a public email/)).toBeInTheDocument()
    expect(screen.getByText('Found in: gis, bim')).toBeInTheDocument()
    expect(screen.getByText('Found in: gis, bim +1')).toBeInTheDocument()
    const names = () => screen.queryAllByText(/^(ANN|BEN|CAT|DAN)(New|Seen)?$/).map((e) => e.textContent!.replace(/(New|Seen)$/, ''))

    // Domains are listed with how many people use them, most common first.
    const domain = screen.getByLabelText('Email domain')
    expect([...domain.querySelectorAll('option')].map((o) => o.textContent)).toEqual(
      ['Any email domain', 'No email', 'gmail.com (2)', 'acme.io (1)', 'outlook.com (1)'])
    await userEvent.selectOptions(domain, 'gmail.com')
    expect(names()).toEqual(['ANN', 'BEN'])
    await userEvent.selectOptions(domain, '__none')
    expect(names()).toEqual(['CAT'])
    await userEvent.selectOptions(domain, '')

    await userEvent.type(screen.getByLabelText('Filter by email'), 'OUTLOOK')
    expect(names()).toEqual(['BEN'])
    expect(screen.getByText(/^1 of 4 match/)).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})

describe('removing accounts and my mailbox', () => {
  it('removes the ticked people from the data store and the list', async () => {
    const person = (login: string) => ({ ...MOCK_PROFILE, id: login.charCodeAt(0), login, name: login.toUpperCase(), found_in: ['gis'] })
    const fetchMock = mockFetch((url) => {
      if (url === '/api/accounts') return [person('ann'), person('ben'), person('cat')]
      if (url === '/api/accounts/remove') return { accounts: 2, search_results_removed: 3, cache_removed: 2, saved_removed: 1 }
      return []
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.history.pushState({}, '', '/accounts')
    render(<App />)
    const remove = await screen.findByRole('button', { name: 'Remove selected (0)' })
    expect(remove).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Tick ann'))
    await userEvent.click(screen.getByLabelText('Tick cat'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove selected (2)' }))
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Remove 2 people'))
    const post = fetchMock.mock.calls.find(([u]) => u === '/api/accounts/remove')!
    expect(JSON.parse(post[1]!.body as string)).toEqual({ logins: ['ann', 'cat'] })
    expect(await screen.findByText(/Removed 2 people from your data \(including 1 from Saved\)/)).toBeInTheDocument()
    expect(screen.queryByText('ANN')).not.toBeInTheDocument()
    expect(screen.getByText('BEN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove selected (0)' })).toBeDisabled()

    // Cancelling the confirmation removes nothing.
    confirmSpy.mockReturnValue(false)
    await userEvent.click(screen.getByLabelText('Tick all matching'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove selected (1)' }))
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/accounts/remove')).toHaveLength(1)
    confirmSpy.mockRestore()
    window.history.pushState({}, '', '/')
  })

  it('detects the provider of my email address on the Email drafts page', async () => {
    setDraftSettings({ ...MAILBOX, app: 'my_email', sender_email: 'maria@gmail.com', custom_url: '', signature: '',
      default_template: 'default', templates: [{ id: 'default', name: 'Default', subject: 'Hi', body: 'Hello' }] })
    mockFetch(() => [])
    window.history.pushState({}, '', '/drafts')
    render(<App />)
    expect(await screen.findByLabelText('Opens in')).toHaveTextContent('Drafts open in Gmail, in the maria@gmail.com account.')
    const address = screen.getByLabelText('Your email address')
    await userEvent.clear(address)
    await userEvent.type(address, 'maria@hotmail.com')
    expect(screen.getByLabelText('Opens in')).toHaveTextContent('Drafts open in Outlook.com, in the account signed in there.')
    await userEvent.clear(address)
    await userEvent.type(address, 'maria@acme.io')
    expect(screen.getByLabelText('Opens in')).toHaveTextContent(/your default mail app.*choose Gmail or Outlook above/)
    await userEvent.selectOptions(screen.getByLabelText('Mail provider'), 'outlook_work')
    expect(screen.getByLabelText('Opens in')).toHaveTextContent('Outlook (work or school)')
    await userEvent.clear(address)
    expect(screen.getAllByText('Enter your email address').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Save' })[0]).toBeDisabled()
    setDraftSettings({ ...MAILBOX, app: 'mailto', custom_url: '', signature: '', default_template: 'default',
      templates: [{ id: 'default', name: 'Default', subject: 'About {repo}', body: 'Hi {first_name}' }] })
    window.history.pushState({}, '', '/')
  })
})

describe('seen accounts', () => {
  it('marks people seen by hand, by drafting, or all at once, and filters new ones', async () => {
    resetSeenCache()
    setDraftSettings({ ...MAILBOX, app: 'mailto', custom_url: '', signature: '', default_template: 'default',
      templates: [{ id: 'default', name: 'Default', subject: 'Hi', body: 'Hello' }] })
    const person = (login: string) => ({ ...MOCK_PROFILE, id: login.charCodeAt(0) + 1000, login, name: login.toUpperCase(),
      found_in: ['gis'], contacts: { ...MOCK_PROFILE.contacts, emails: [{ value: `${login}@x.io`, source: 'GitHub public email' }] } })
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/accounts') return [person('xena'), person('yuri'), person('zoe')]
      if (url === '/api/seen' && !init?.method) return { yuri: '2026-09-01T10:00:00Z' }
      if (url === '/api/seen') return { changed: 1 }
      if (url === '/api/open-url') return { opened: true }
      return []
    })
    const seenPosts = () => fetchMock.mock.calls.filter(([u, i]) => u === '/api/seen' && i?.method === 'POST')
      .map(([, i]) => JSON.parse(i!.body as string))
    const badge = (name: string) => screen.getByText(name).querySelector('span')?.textContent

    window.history.pushState({}, '', '/accounts')
    render(<App />)
    await screen.findByText(/^XENA/)
    await waitFor(() => expect(badge('YURI')).toBe('Seen'))
    expect(badge('XENA')).toBe('New')

    // By hand, per row.
    await userEvent.click(within(screen.getByText('XENA').closest('tr')!).getByRole('button', { name: 'Mark seen' }))
    expect(badge('XENA')).toBe('Seen')
    expect(seenPosts().at(-1)).toEqual({ logins: ['xena'], seen: true })

    // Only new people.
    await userEvent.selectOptions(screen.getByLabelText('Seen filter'), 'new')
    expect(screen.queryByText(/^XENA/)).not.toBeInTheDocument()
    expect(screen.getByText(/^ZOE/)).toBeInTheDocument()

    // Drafting to someone marks them seen.
    await userEvent.click(within(screen.getByText('ZOE').closest('tr')!).getByRole('button', { name: /Draft email/ }))
    await waitFor(() => expect(seenPosts().at(-1)).toEqual({ logins: ['zoe'], seen: true }))
    expect(screen.queryByText(/^ZOE/)).not.toBeInTheDocument() // no longer new

    // Mark new again, then mark everyone matching as seen.
    await userEvent.selectOptions(screen.getByLabelText('Seen filter'), 'all')
    await userEvent.click(within(screen.getByText('ZOE').closest('tr')!).getByRole('button', { name: 'Mark new' }))
    expect(seenPosts().at(-1)).toEqual({ logins: ['zoe'], seen: false })
    await userEvent.click(screen.getByRole('button', { name: 'Mark all 3 matching as seen' }))
    expect(seenPosts().at(-1)).toEqual({ logins: ['xena', 'yuri', 'zoe'], seen: true })
    expect(screen.queryByRole('button', { name: /Mark all .* as seen/ })).not.toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})

describe('followers already scanned', () => {
  it('shows who has been scanned, opens the existing scan instead of starting another, and filters', async () => {
    resetSeenCache()
    resetFollowerScans()
    const person = (login: string) => ({ ...MOCK_PROFILE, id: login.charCodeAt(0) + 2000, login, name: login.toUpperCase(),
      followers: 50, found_in: ['gis'] })
    const job = (id: string, login: string, status: string, found: number, created_at: string) => ({
      id, name: `followers of @${login}`, query: '', params: { mode: 'followers', followers_of: login }, target: 100, status,
      created_at, updated_at: created_at, next_page: 1, pages_done: 1, checked: 0, filtered_out: 0, failed: 0,
      total_candidates: 50, found, wait_until: null, message: null })
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/accounts') return [person('amy'), person('bo'), person('cy')]
      if (url === '/api/jobs' && !init?.method) return [
        job('old1', 'amy', 'completed', 12, '2026-09-01T10:00:00+00:00'),
        job('new1', 'amy', 'completed', 30, '2026-09-20T10:00:00+00:00'),
        job('run1', 'Bo', 'running', 7, '2026-09-26T10:00:00+00:00'),
        { ...job('kw', 'x', 'completed', 5, '2026-09-02T10:00:00+00:00'), params: { mode: 'repositories', keywords: ['gis'] } },
      ]
      return []
    })
    window.history.pushState({}, '', '/accounts')
    render(<App />)
    const row = async (name: string) => (await screen.findByText(new RegExp(`^${name}`))).closest('tr')!
    // The newest scan counts; a running one shows its progress; login case doesn't matter.
    expect(await within(await row('AMY')).findByRole('button', { name: '✓ Followers scanned (30 found)' })).toBeInTheDocument()
    expect(within(await row('BO')).getByRole('button', { name: 'Scanning followers… (7 found)' })).toBeInTheDocument()
    expect(within(await row('CY')).getByRole('button', { name: 'Scan 50 followers' })).toBeInTheDocument()
    expect(within(await row('AMY')).getByText('Followers scanned')).toBeInTheDocument()
    expect(within(await row('CY')).queryByText('Followers scanned')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Followers scan filter'), 'not')
    expect(screen.queryByText(/^AMY/)).not.toBeInTheDocument()
    expect(screen.getByText(/^CY/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Followers scan filter'), 'scanned')
    expect(screen.queryByText(/^CY/)).not.toBeInTheDocument()

    // Clicking opens the existing scan; no new one is started.
    await userEvent.click(within(await row('AMY')).getByRole('button', { name: /Followers scanned/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/searches/new1'))
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/jobs' && i?.method === 'POST')).toBe(false)
    window.history.pushState({}, '', '/')
  })
})

describe('contact filters', () => {
  it('filters by having or not having an email, phone and LinkedIn, and combines them', async () => {
    const person = (login: string, email: boolean, phone: boolean, linkedin: boolean) => ({
      ...MOCK_PROFILE, id: login.charCodeAt(0) + 3000, login, name: login.toUpperCase(), found_in: ['gis'],
      contacts: { ...MOCK_PROFILE.contacts,
        emails: email ? [{ value: `${login}@x.io`, source: 'GitHub public email' }] : [],
        phones: phone ? [{ value: '+1 555 0100', source: 'Profile README' }] : [],
        linkedin: linkedin ? { value: `https://linkedin.com/in/${login}`, source: 'GitHub linked social accounts' } : null },
    })
    mockFetch((url) => url === '/api/accounts'
      ? [person('ella', true, true, false), person('finn', true, false, true), person('gus', false, false, true), person('hal', false, false, false)]
      : [])
    window.history.pushState({}, '', '/accounts')
    render(<App />)
    await screen.findByText(/^ELLA/)
    const names = () => screen.queryAllByText(/^(ELLA|FINN|GUS|HAL)/).map((e) => e.textContent!.match(/^(ELLA|FINN|GUS|HAL)/)![1])
    const email = screen.getByLabelText('Email filter')
    expect([...email.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Email: any', 'Has Email (2)', 'No Email (2)'])

    await userEvent.selectOptions(email, 'has')
    expect(names()).toEqual(['ELLA', 'FINN'])
    await userEvent.selectOptions(email, 'none')
    expect(names()).toEqual(['GUS', 'HAL'])

    // Combined: no email, but has LinkedIn.
    await userEvent.selectOptions(screen.getByLabelText('LinkedIn filter'), 'has')
    expect(names()).toEqual(['GUS'])

    await userEvent.selectOptions(email, 'any')
    await userEvent.selectOptions(screen.getByLabelText('LinkedIn filter'), 'any')
    await userEvent.selectOptions(screen.getByLabelText('Phone filter'), 'none')
    expect(names()).toEqual(['FINN', 'GUS', 'HAL'])
    window.history.pushState({}, '', '/')
  })
})

describe('field search and more filters', () => {
  it('searches a chosen field, applies more filters, and clears everything', async () => {
    const person = (login: string, name: string, email: string, country: string, followers: number, hireable: boolean) => ({
      ...MOCK_PROFILE, id: login.charCodeAt(0) + 4000, login, name, country, followers, hireable, found_in: ['gis'],
      contacts: { ...MOCK_PROFILE.contacts, emails: [{ value: email, source: 'GitHub public email' }] },
    })
    mockFetch((url) => url === '/api/accounts'
      ? [person('ivy', 'Ivy Stone', 'ivy@stone.io', 'Ireland', 500, true), person('jon', 'Jon Ivy', 'jon@x.io', 'Germany', 20, false),
         person('kim', 'Kim Lee', 'kim@stone.io', 'Ireland', 50, false)]
      : [])
    window.history.pushState({}, '', '/accounts')
    render(<App />)
    await screen.findByText(/^Ivy Stone/)
    const names = () => screen.queryAllByText(/^(Ivy Stone|Jon Ivy|Kim Lee)/).map((e) => e.textContent!.match(/^(Ivy Stone|Jon Ivy|Kim Lee)/)![1])
    const box = screen.getByLabelText('Filter list')

    await userEvent.type(box, 'ivy')
    expect(names()).toEqual(['Ivy Stone', 'Jon Ivy']) // all fields
    await userEvent.selectOptions(screen.getByLabelText('Search in'), 'email')
    expect(names()).toEqual(['Ivy Stone']) // only ivy@stone.io
    await userEvent.clear(box)
    await userEvent.type(box, 'stone.io')
    expect(names()).toEqual(['Ivy Stone', 'Kim Lee'])

    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    const country = screen.getByLabelText('Country')
    expect([...country.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Any country', 'Ireland (2)', 'Germany (1)'])
    await userEvent.type(screen.getByLabelText('Followers min'), '100')
    expect(names()).toEqual(['Ivy Stone'])
    expect(screen.getByRole('button', { name: /More filters \(1\)/ })).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Followers min'))
    await userEvent.click(screen.getByLabelText('Open to hire only'))
    expect(names()).toEqual(['Ivy Stone'])

    await userEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(names()).toEqual(['Ivy Stone', 'Jon Ivy', 'Kim Lee'])
    expect(screen.getByLabelText('Filter list')).toHaveValue('')
    expect(screen.getByLabelText('Search in')).toHaveValue('all')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})

describe('followers scan', () => {
  it('is not a search mode in the sidebar', () => {
    mockFetch(() => [])
    render(<App />)
    expect(screen.queryByRole('radio', { name: 'Followers' })).not.toBeInTheDocument()
  })

  it("starts a background scan of a person's followers from their profile", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/jobs' && init?.method === 'POST') return { id: 'f1', name: 'followers of @alice', status: 'running' }
      if (url.startsWith('/api/profiles/')) return { ...MOCK_PROFILE, followers: 42 }
      if (url === '/api/jobs') return []
      return {}
    })
    window.history.pushState({}, '', `/profile/${MOCK_PROFILE.login}`)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Scan 42 followers' }))
    // Opens the options first; nothing starts until "Start scan".
    const panel = screen.getByRole('dialog', { name: `Scan followers of ${MOCK_PROFILE.login}` })
    const posts = () => fetchMock.mock.calls.filter(([u, i]) => u === '/api/jobs' && i?.method === 'POST')
    expect(posts()).toHaveLength(0)
    await userEvent.click(within(panel).getByRole('button', { name: 'Start scan' }))
    const body = JSON.parse(posts()[0][1]!.body as string)
    expect(body).toMatchObject({ mode: 'followers', followers_of: MOCK_PROFILE.login, target: 100 })
    expect(body.since).toBeUndefined() // "Any time" sends no dates
    await waitFor(() => expect(window.location.pathname).toBe('/searches/f1'))
    window.history.pushState({}, '', '/')
  })

  it('scans followers who committed in a chosen period', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/jobs' && init?.method === 'POST') return { id: 'f2', name: 'followers', status: 'running' }
      if (url.startsWith('/api/profiles/')) return { ...MOCK_PROFILE, followers: 42 }
      return []
    })
    window.history.pushState({}, '', `/profile/${MOCK_PROFILE.login}`)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Scan 42 followers' }))
    const panel = screen.getByRole('dialog', { name: `Scan followers of ${MOCK_PROFILE.login}` })
    const start = within(panel).getByRole('button', { name: 'Start scan' })

    await userEvent.selectOptions(within(panel).getByLabelText('Commit period'), 'custom')
    expect(within(panel).getByText('Choose a start date')).toBeInTheDocument()
    expect(start).toBeDisabled()
    await userEvent.type(within(panel).getByLabelText('From'), '2026-03-01')
    await userEvent.type(within(panel).getByLabelText('To'), '2026-02-01')
    expect(within(panel).getByText('Start must be before end')).toBeInTheDocument()
    await userEvent.clear(within(panel).getByLabelText('To'))
    await userEvent.type(within(panel).getByLabelText('To'), '2026-06-30')
    const stop = within(panel).getByLabelText('Stop after')
    await userEvent.clear(stop)
    await userEvent.type(stop, '5000')
    await userEvent.click(start)

    const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/jobs' && i?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      mode: 'followers', followers_of: MOCK_PROFILE.login, since: '2026-03-01', until: '2026-06-30', target: 5000 })
    await waitFor(() => expect(window.location.pathname).toBe('/searches/f2'))

    // Presets send the last N days up to today.
    window.history.pushState({}, '', `/profile/${MOCK_PROFILE.login}`)
    render(<App />)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Scan 42 followers' })).at(-1)!)
    const panel2 = screen.getAllByRole('dialog').at(-1)!
    await userEvent.selectOptions(within(panel2).getByLabelText('Commit period'), '90')
    await userEvent.click(within(panel2).getByRole('button', { name: 'Start scan' }))
    const last = JSON.parse(fetchMock.mock.calls.filter(([u, i]) => u === '/api/jobs' && i?.method === 'POST').at(-1)![1]!.body as string)
    const days = (Date.parse(last.until) - Date.parse(last.since)) / 86400000
    expect(days).toBe(90)
    expect(last.until).toBe(new Date().toISOString().slice(0, 10))
    window.history.pushState({}, '', '/')
  })

  it('does not send a followers account in other modes', () => {
    expect(toQuery({ ...emptyForm, q: 'x', followers_of: 'mapper' }, 1)).not.toContain('followers_of')
  })
})

describe('multiple keywords', () => {
  it('adds keywords as chips with Enter and comma and searches for any of them', async () => {
    mockFetch(() => [])
    render(<App />)
    await userEvent.type(keywordBox(), 'gis{Enter}bim,revit{Enter}')
    await userEvent.type(keywordBox(), 'dynamo') // still typed, not yet a chip: included too
    expect(screen.getByLabelText('Search keywords')).toHaveTextContent(/gis.*bim.*revit/)

    await userEvent.type(keywordBox(), '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}')
    expect(screen.getByLabelText('Search keywords')).not.toHaveTextContent('revit') // Backspace on empty removes last
    await userEvent.type(keywordBox(), 'revit')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    const params = new URLSearchParams(FakeEventSource.last.url.split('?')[1])
    expect(params.get('keywords')).toBe('gis,bim,revit')
  })

  it('shows which keywords each person matched', async () => {
    mockFetch()
    render(<App />)
    await userEvent.type(keywordBox(), 'gis{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    FakeEventSource.last.emit('item', { ...MOCK_PROFILE, matched_keywords: ['gis'] })
    expect(screen.getByLabelText('Matched keywords')).toHaveTextContent('gis')
  })
})
