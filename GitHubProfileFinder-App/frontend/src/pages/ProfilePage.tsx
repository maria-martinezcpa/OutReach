import { useCallback, useEffect, useState } from 'react'
import TelegramHandle from '../components/TelegramHandle'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import {
  ActivityBadge, Alert, Badge, Card, ConfidenceBadge, LevelBadge, Spinner, btnDanger, btnPrimary, btnSecondary, formatDate,
} from '../components/ui'
import DraftEmailButton from '../components/DraftEmailButton'
import ScanFollowersButton from '../components/ScanFollowersButton'
import { useSearch } from '../searchContext'
import { setSeen } from '../useSeen'
import type { Profile } from '../types'

const effectStyle = {
  supports: { icon: '＋', cls: 'text-emerald-600' },
  against: { icon: '－', cls: 'text-rose-600' },
  neutral: { icon: '•', cls: 'text-slate-400' },
}

function Source({ children }: { children: string }) {
  return <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{children}</span>
}

function ContactLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2 last:border-0 sm:grid-cols-[120px_1fr]">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

const none = <span className="text-slate-400">Not publicly listed</span>

export default function ProfilePage() {
  const { login = '' } = useParams()
  const navigate = useNavigate()
  const { result, updateProfile } = useSearch()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const period = result?.items.find((p) => p.login.toLowerCase() === login.toLowerCase())?.period_activity ?? null

  const load = useCallback(
    async (refresh = false) => {
      setError(null)
      setBusy(true)
      try {
        setProfile(await api.profile(login, refresh))
        setSeen([login]) // opening someone's profile counts as having seen them
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load profile')
      } finally {
        setBusy(false)
      }
    },
    [login],
  )

  useEffect(() => {
    setProfile(null)
    load()
  }, [load])

  async function toggleSave() {
    if (!profile) return
    setBusy(true)
    try {
      if (profile.saved) await api.unsave(profile.login)
      else await api.save(profile.login)
      setProfile({ ...profile, saved: !profile.saved })
      updateProfile(profile.login, { saved: !profile.saved })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update saved profiles')
    } finally {
      setBusy(false)
    }
  }

  async function deleteData() {
    if (!profile || !confirm(`Delete all stored data for @${profile.login} (cache and saved list)?`)) return
    await api.deleteData(profile.login)
    updateProfile(profile.login, { saved: false })
    navigate(-1)
  }

  if (error && !profile) return <Alert>{error}</Alert>
  if (!profile) return <Spinner label={`Loading @${login}…`} />

  const p = profile
  const a = p.analysis
  const c = p.contacts
  const periodRepos = period?.repos ?? []

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="text-sm text-indigo-700 hover:underline">
        ← Back to results
      </button>
      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="flex flex-col gap-5 sm:flex-row">
          <img src={p.avatar_url || ''} alt="" className="size-24 rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">{p.name || p.login}</h1>
                <a href={p.github_url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-indigo-700">
                  @{p.login}
                </a>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={p.saved ? btnSecondary : btnPrimary} onClick={toggleSave} disabled={busy}>
                  {p.saved ? '★ Saved' : '☆ Save'}
                </button>
                <DraftEmailButton profile={p} />
                <ScanFollowersButton profile={p} />
                <button className={btnSecondary} onClick={() => load(true)} disabled={busy}>Refresh</button>
                <a className={btnSecondary} href={p.github_url} target="_blank" rel="noreferrer">GitHub ↗</a>
                <button className={btnDanger} onClick={deleteData}>Delete stored data</button>
              </div>
            </div>
            {p.bio && <p className="mt-3 text-slate-700">{p.bio}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <ConfidenceBadge value={a.human_confidence} />
              <ActivityBadge value={a.activity_status} />
              {p.hireable && <Badge color="green">Open to hire</Badge>}
              <Badge>{p.followers} followers</Badge>
              <Badge>{p.following} following</Badge>
              <Badge>{p.public_repos} public repos</Badge>
              <Badge>Joined {formatDate(p.created_at)}</Badge>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Contact">
          <dl>
            <ContactLine label="Name">{p.name || none}</ContactLine>
            <ContactLine label="Roles">
              {p.roles.length ? p.roles.map((r) => <div key={r.title}>{r.title}<Source>{r.source}</Source></div>) : none}
            </ContactLine>
            <ContactLine label="Email">
              {c.emails.length ? c.emails.map((e) => <div key={e.value}><a className="text-indigo-700 hover:underline" href={`mailto:${e.value}`}>{e.value}</a><Source>{e.source}</Source></div>) : none}
            </ContactLine>
            <ContactLine label="Phone">
              {c.phones.length ? c.phones.map((x) => <div key={x.value}>{x.value}<Source>{x.source}</Source></div>) : none}
            </ContactLine>
            <ContactLine label="LinkedIn">
              {c.linkedin ? <><a className="text-indigo-700 hover:underline" href={c.linkedin.value} target="_blank" rel="noreferrer">{c.linkedin.value}</a><Source>{c.linkedin.source}</Source></> : none}
            </ContactLine>
            <ContactLine label="Telegram">
              {c.telegram ? <><TelegramHandle url={c.telegram.value} /><Source>{c.telegram.source}</Source></> : none}
            </ContactLine>
            <ContactLine label="GitHub"><a className="text-indigo-700 hover:underline" href={p.github_url} target="_blank" rel="noreferrer">{p.github_url}</a></ContactLine>
            <ContactLine label="Other links">
              {c.links.length ? c.links.map((l) => <div key={l.url}><span className="text-slate-500">{l.label}: </span><a className="text-indigo-700 hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.url}</a><Source>{l.source}</Source></div>) : none}
            </ContactLine>
            <ContactLine label="Location">{p.location || none}</ContactLine>
            <ContactLine label="Country">{p.country || <span className="text-slate-400">Could not be determined from location</span>}</ContactLine>
            <ContactLine label="Region">
              {p.region || p.continent ? (
                <>
                  {[p.region, p.continent].filter(Boolean).join(' · ')}
                  <span className="ml-1 text-xs text-slate-400">{p.country ? `(calculated from ${p.country})` : '(from location)'}</span>
                </>
              ) : (
                <span className="text-slate-400">Could not be determined</span>
              )}
            </ContactLine>
            <ContactLine label="Company">{p.company || none}</ContactLine>
          </dl>
          <p className="mt-3 text-xs text-slate-400">Only information this person published on their GitHub profile is shown.</p>
        </Card>

        <Card title="Human / bot analysis">
          <div className="mb-3 flex items-center gap-2">
            <ConfidenceBadge value={a.human_confidence} />
            <span className="text-xs text-slate-400">Automated assessment</span>
          </div>
          <ul className="space-y-1.5 text-sm">
            {a.evidence.map((s) => (
              <li key={s.signal + s.observation} className="flex gap-2">
                <span className={`w-4 shrink-0 font-bold ${effectStyle[s.effect].cls}`}>{effectStyle[s.effect].icon}</span>
                <span><span className="font-medium">{s.signal}:</span> {s.observation}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Limitations</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
            {a.limitations.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="mt-3 text-xs text-slate-400">Method: {a.method}</p>
        </Card>

        <Card title="Activity">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">Status</dt><dd><ActivityBadge value={a.activity_status} /></dd></div>
            <div><dt className="text-slate-500">Last push</dt><dd>{formatDate(a.last_push)}</dd></div>
            <div><dt className="text-slate-500">Account created</dt><dd>{formatDate(p.created_at)}</dd></div>
            <div><dt className="text-slate-500">Languages</dt><dd>{p.languages.slice(0, 6).join(', ') || '—'}</dd></div>
          </dl>
          {period ? (
            <div className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm">
              <div className="font-medium text-indigo-900">
                {period.commits}{period.commits_capped ? '+' : ''} commits between {formatDate(period.since)} and {formatDate(period.until)}
              </div>
              <ul className="mt-1 text-indigo-800">
                {periodRepos.map((r) => <li key={r.name}>{r.name}: {r.commits}</li>)}
              </ul>
              {period.last_commit_at && <p className="mt-1 text-indigo-800">Latest commit in range: {new Date(period.last_commit_at).toLocaleString()}</p>}
              <p className="mt-1 text-xs text-indigo-700/70">
                Counted by commit author date. Source: {period.source}
                {period.source.startsWith('Commits in') && ` (${period.checked_repos} most recently pushed repositories checked)`}.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-400">Search with a commit period to see commits in that range.</p>
          )}
        </Card>

        <Card title="Skills">
          <p className="mb-3 text-xs text-slate-500">Detected from public activity — not verified professional expertise.</p>
          {a.skills.length === 0 && <p className="text-sm text-slate-400">No skills detected.</p>}
          <ul className="space-y-3">
            {a.skills.map((s) => (
              <li key={s.name}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{s.name}</span>
                  <LevelBadge level={s.level} />
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${Math.round(s.confidence * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {s.evidence_repos.length > 0 && <>Repos: {s.evidence_repos.join(', ')} · </>}
                  Sources: {s.sources.join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`Repositories (${p.repositories.length} most recently pushed)`}>
        <ul className="divide-y divide-slate-100">
          {p.repositories.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 hover:underline">{r.name}</a>
                {r.fork && <Badge>fork</Badge>}
                {r.language && <Badge color="indigo">{r.language}</Badge>}
                <span className="text-xs text-slate-400">★ {r.stars} · forks {r.forks} · pushed {formatDate(r.pushed_at)}</span>
              </div>
              {r.description && <p className="mt-0.5 text-sm text-slate-600">{r.description}</p>}
              {r.topics.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.topics.slice(0, 8).map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">{t}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Sources">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>GitHub user profile (name, bio, company, location, public email, website, twitter) via the REST API</li>
          <li>Social accounts the user linked on their GitHub profile</li>
          <li>The user's profile README (the <code>{p.login}/{p.login}</code> repository), if it exists</li>
          <li>Public repositories owned by the user (languages, topics, descriptions, push dates)</li>
          {period && <li>Commit history of up to {period.checked_repos} repositories within the searched period</li>}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Fetched {new Date(p.fetched_at).toLocaleString()} · cached for 24 hours · <Link to="/saved" className="underline">saved profiles</Link>
        </p>
      </Card>
    </div>
  )
}
