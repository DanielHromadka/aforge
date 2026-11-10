import { z } from 'zod'
import { itemOf, itemTitle, type ItemKind } from './items.js'
import type { Project } from './index.js'

const date = z.string().datetime({ offset: true })
export const PlanningEntryInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  text: z.string().trim().min(1).max(4000),
  level: z.enum(['info', 'warning', 'constraint']),
  remindAt: date.optional(),
  deadlineAt: date.optional(),
})
export const PlanningInputSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  estimateMinutes: z.number().finite().nonnegative().max(60_000_000).optional(),
  entries: z.array(PlanningEntryInputSchema).max(100),
}).superRefine((p, ctx) => {
  if (new Set(p.entries.map((e) => e.id)).size !== p.entries.length) ctx.addIssue({ code: 'custom', message: 'Každá poznámka musí mít jedinečné ID.' })
})
export type PlanningEntryInput = z.infer<typeof PlanningEntryInputSchema>
export interface PlanningEntry extends PlanningEntryInput {
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  readBy?: Record<string, string>
}
export interface ItemPlanning {
  version: number
  estimateMinutes?: number
  entries: PlanningEntry[]
  updatedAt: string
  updatedBy: string
}
export interface PlanningNotice {
  projectId: string
  projectName: string
  sessionName: string
  kind: ItemKind
  itemType: 'epic' | 'story' | 'task' | 'bug' | 'subtask' | 'test'
  itemId: string
  itemTitle: string
  entry: PlanningEntryInput
  dueAt: string
  overdue: boolean
  read: boolean
}
export interface PlanningInbox { now: string; nextDueAt?: string; notices: PlanningNotice[] }
export const planningKey = (kind: ItemKind, id: string) => `${kind}:${id}`
export const PLANNING_LEVEL = { info: 'Poznámka', warning: 'Upozornění', constraint: 'Omezení' }

/** The deadline is a second alert, even when the earlier reminder was already read. */
export const planningTrigger = (e: PlanningEntry, now: number): string | undefined => {
  if (e.resolvedAt) return undefined
  return [e.remindAt, e.deadlineAt].filter((at): at is string => !!at && Date.parse(at) <= now).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}
export const planningNotices = (p: Project, userId: string, now = Date.now()): PlanningNotice[] => {
  const notices: PlanningNotice[] = []
  for (const [key, plan] of Object.entries(p.planning ?? {})) {
    const separator = key.indexOf(':')
    const kind = key.slice(0, separator) as ItemKind
    const id = key.slice(separator + 1)
    if (!['epic', 'story', 'issue', 'test'].includes(kind)) continue
    const item = itemOf(p, kind, id)
    if (!item) continue // Deleted and replaced items retain history, but never send live alerts.
    for (const e of plan.entries) {
      const dueAt = planningTrigger(e, now)
      if (!dueAt) continue
      const { readBy: _readBy, resolvedAt: _resolvedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...entry } = e
      notices.push({ projectId: p.id, projectName: p.name, sessionName: p.session?.name ?? 'Session 1', kind, itemType: 'type' in item ? item.type : kind === 'issue' ? 'task' : kind, itemId: id, itemTitle: itemTitle(item), entry, dueAt,
        overdue: !!e.deadlineAt && Date.parse(e.deadlineAt) <= now,
        read: !!e.readBy?.[userId] && Date.parse(e.readBy[userId]!) >= Date.parse(dueAt),
      })
    }
  }
  return notices
}
export const nextPlanningTime = (p: Project, now = Date.now()): number | undefined => {
  let next: number | undefined
  for (const [key, plan] of Object.entries(p.planning ?? {})) {
    const split = key.indexOf(':')
    const kind = key.slice(0, split) as ItemKind
    if (!['epic', 'story', 'issue', 'test'].includes(kind) || !itemOf(p, kind, key.slice(split + 1))) continue
    for (const e of plan.entries) if (!e.resolvedAt) for (const at of [e.remindAt, e.deadlineAt]) {
      const time = at ? Date.parse(at) : NaN
      if (time > now && (next === undefined || time < next)) next = time
    }
  }
  return next
}

/** Reorganization must not silently discard human reminders. Estimates on split results need re-estimation. */
export const reorganizePlanning = (p: Project, sources: string[], issueIds: string[], results: string[], at: string): Project['planning'] => {
  const sourcePlans = sources.map((id) => p.planning?.[planningKey('story', id)]).filter((x): x is ItemPlanning => !!x)
  const plans = [...sourcePlans, ...issueIds.map((id) => p.planning?.[planningKey('issue', id)]).filter((x): x is ItemPlanning => !!x)]
  if (!plans.length) return p.planning
  const estimates = sourcePlans.flatMap((x) => x.estimateMinutes === undefined ? [] : [x.estimateMinutes])
  const entries = plans.flatMap((plan) => plan.entries).map((e, i) => ({ ...e, id: `transferred-${i + 1}`, updatedAt: at }))
  const planning = { ...p.planning }
  for (const id of results) planning[planningKey('story', id)] = { version: 1, updatedAt: at, updatedBy: 'reorganization', entries,
    ...(results.length === 1 && estimates.length ? { estimateMinutes: estimates.reduce((sum, value) => sum + value, 0) } : {}),
  }
  return planning
}
