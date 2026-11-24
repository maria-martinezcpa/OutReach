import { Link } from 'react-router-dom'
import type { Profile } from '../types'
import TelegramHandle from './TelegramHandle'
import { ActivityBadge, Badge, ConfidenceBadge, btnPrimary, btnSecondary, formatDate } from './ui'

interface Props {
  profile: Profile
  onToggleSave: (profile: Profile) => void
  saving?: boolean
}

function ContactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 text-sm">
      <dt className="w-16 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  )
}

const missing = <span className="text-slate-300">not public</span>

export default function ProfileCard({ profile: p, onToggleSave, saving }: Props) {
  const c = p.contacts
  const place = [p.location, p.country && !p.location?.includes(p.country) ? p.country : null, p.region ?? p.continent]
    .filter(Boolean)
    .join(' · ')
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md" aria-label={p.name || p.login}>
      <div className="flex gap-4">
        <img src={p.avatar_url || ''} alt="" className="size-14 shrink-0 rounded-full bg-slate-100" loading="lazy" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-slate-900">{p.name || p.login}</h3>
              <p className="text-sm text-slate-500">
                @{p.login}
                {p.roles.length > 0 && <span className="text-slate-700"> · {p.roles.map((r) => r.title).join(', ')}</span>}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {place || 'Location not listed'}
                {p.company && <> · {p.company}</>}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className={p.saved ? btnSecondary : btnPrimary} onClick={() => onToggleSave(p)} disabled={saving}>
                {p.saved ? '★ Saved' : '☆ Save'}
              </button>
              <Link to={`/profile/${p.login}`} className={btnSecondary}>
                View profile
              </Link>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <ConfidenceBadge value={p.analysis.human_confidence} />
            <ActivityBadge value={p.analysis.activity_status} />
            {p.period_activity && (
              <Badge color="indigo" title={p.period_activity.source}>
                {p.period_activity.commits}
                {p.period_activity.commits_capped ? '+' : ''} commits in period
                {p.period_activity.last_commit_at && <> · last {formatDate(p.period_activity.last_commit_at)}</>}
              </Badge>
            )}
            <Badge>{p.followers} followers</Badge>
            <Badge>{p.public_repos} repos</Badge>
          </div>

          <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <ContactRow label="Email">
              {c.emails.length ? <a className="text-indigo-700 hover:underline" href={`mailto:${c.emails[0].value}`}>{c.emails.map((e) => e.value).join(', ')}</a> : missing}
            </ContactRow>
            <ContactRow label="Phone">{c.phones.length ? c.phones.map((x) => x.value).join(', ') : missing}</ContactRow>
            <ContactRow label="LinkedIn">
              {c.linkedin ? <a className="text-indigo-700 hover:underline" href={c.linkedin.value} target="_blank" rel="noreferrer">{c.linkedin.value.replace(/^https?:\/\/(www\.)?/, '')}</a> : missing}
            </ContactRow>
            <ContactRow label="Telegram">
              {c.telegram ? <TelegramHandle url={c.telegram.value} /> : missing}
            </ContactRow>
            <ContactRow label="Website">
              {c.website ? <a className="text-indigo-700 hover:underline" href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, '')}</a> : missing}
            </ContactRow>
          </dl>

          {p.matched_keywords && p.matched_keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1 text-xs" aria-label="Matched keywords">
              <span className="text-slate-500">Matched:</span>
              {p.matched_keywords.map((k) => (
                <span key={k} className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">{k}</span>
              ))}
            </div>
          )}

          {p.analysis.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1" aria-label="Detected skills">
              {p.analysis.skills.slice(0, 8).map((s) => (
                <span
                  key={s.name}
                  title={`${Math.round(s.confidence * 100)}% · detected from public activity`}
                  className={`rounded-full px-2 py-0.5 text-xs ${s.level === 'HIGH' ? 'bg-indigo-600 text-white' : s.level === 'MEDIUM' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'}`}
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
