import type { ReactNode } from 'react'
import type { ActivityStatus, HumanConfidence, Level } from '../types'

const tone = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
}
export type Tone = keyof typeof tone

export function Badge({ children, color = 'slate', title }: { children: ReactNode; color?: Tone; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${tone[color]}`}
    >
      {children}
    </span>
  )
}

const confidenceTone: Record<HumanConfidence, Tone> = {
  HIGH: 'green',
  MEDIUM: 'amber',
  LOW: 'red',
  INSUFFICIENT_DATA: 'slate',
}

export function ConfidenceBadge({ value }: { value: HumanConfidence }) {
  return (
    <Badge color={confidenceTone[value]} title="Automated estimate from public activity. Not identity verification.">
      Human: {value === 'INSUFFICIENT_DATA' ? 'insufficient data' : value.toLowerCase()}
    </Badge>
  )
}

const activityTone: Record<ActivityStatus, Tone> = { ACTIVE: 'green', MODERATE: 'amber', INACTIVE: 'slate', UNKNOWN: 'slate' }

export function ActivityBadge({ value }: { value: ActivityStatus }) {
  return <Badge color={activityTone[value]}>{value.charAt(0) + value.slice(1).toLowerCase()}</Badge>
}

export function LevelBadge({ level }: { level: Level }) {
  return <Badge color={level === 'HIGH' ? 'green' : level === 'MEDIUM' ? 'amber' : 'slate'}>{level.toLowerCase()}</Badge>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-500" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  )
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const cls = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  }[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  )
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50'
export const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`
export const btnSecondary = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`
export const btnDanger = `${btn} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`
export const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
