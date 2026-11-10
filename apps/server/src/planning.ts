import { itemOf, nextPlanningTime, planningKey, planningNotices, planningTrigger, PlanningInputSchema, type AppUser, type ItemKind, type PlanningInbox, type Project } from '@aforge/shared'
import { roleOf } from './auth.js'
import { listWorkingSessions, loadProject, mutateProject } from './store.js'
import { publish } from './events.js'

const conflict = () => Object.assign(new Error('Plánování mezitím někdo upravil. Načtěte aktuální hodnoty a změnu zopakujte.'), { statusCode: 409 })

export const savePlanningModel = (p: Project, kind: ItemKind, id: string, raw: unknown, userId: string, at = new Date().toISOString()): Project => {
  if (!itemOf(p, kind, id)) throw new Error('Položka už neexistuje.')
  const input = PlanningInputSchema.parse(raw)
  const key = planningKey(kind, id)
  const old = p.planning?.[key]
  if (input.expectedVersion !== (old?.version ?? 0)) throw conflict()
  const entries = input.entries.map((entry) => {
    const before = old?.entries.find((e) => e.id === entry.id)
    const changed = !before || entry.text !== before.text || entry.level !== before.level || entry.remindAt !== before.remindAt || entry.deadlineAt !== before.deadlineAt
    return { ...entry, createdAt: before?.createdAt ?? at, updatedAt: changed ? at : before!.updatedAt,
      ...(before?.resolvedAt ? { resolvedAt: before.resolvedAt } : {}),
      ...(!changed && before?.readBy ? { readBy: before.readBy } : {}),
    }
  })
  return { ...p, planning: { ...p.planning, [key]: { version: (old?.version ?? 0) + 1, estimateMinutes: input.estimateMinutes, entries, updatedAt: at, updatedBy: userId } } }
}

export const savePlanning = async (projectId: string, kind: ItemKind, id: string, raw: unknown, userId: string) => {
  const saved = await mutateProject(projectId, (p) => savePlanningModel(p, kind, id, raw, userId))
  publish(projectId, 'project', 'changed', '')
  return saved
}

export const resolvePlanningEntry = async (projectId: string, kind: ItemKind, id: string, entryId: string, expectedVersion: number, resolved: boolean, userId: string) => {
  const at = new Date().toISOString()
  const saved = await mutateProject(projectId, (p) => {
    const key = planningKey(kind, id)
    const plan = p.planning?.[key]
    if (!itemOf(p, kind, id) || !plan?.entries.some((e) => e.id === entryId)) throw new Error('Poznámka už neexistuje.')
    if (plan.version !== expectedVersion) throw conflict()
    return { ...p, planning: { ...p.planning, [key]: { ...plan, version: plan.version + 1, updatedAt: at, updatedBy: userId,
      entries: plan.entries.map((e) => e.id === entryId ? { ...e, resolvedAt: resolved ? at : undefined, updatedAt: at, ...(!resolved ? { readBy: {} } : {}) } : e),
    } } }
  })
  publish(projectId, 'project', 'changed', '')
  return saved
}

/** Read receipts belong to the signed-in user; viewing a reminder never dismisses it for colleagues. */
export const readPlanningEntry = async (projectId: string, kind: ItemKind, id: string, entryId: string, dueAt: string, userId: string) => {
  const now = Date.now()
  const saved = await mutateProject(projectId, (p) => {
    const key = planningKey(kind, id)
    const plan = p.planning?.[key]
    const entry = plan?.entries.find((e) => e.id === entryId)
    if (!itemOf(p, kind, id) || !entry || !plan) throw new Error('Upozornění už neexistuje.')
    if (planningTrigger(entry, now) !== dueAt) throw conflict()
    return { ...p, planning: { ...p.planning, [key]: { ...plan, entries: plan.entries.map((e) => e.id === entryId ? { ...e, readBy: { ...e.readBy, [userId]: new Date(now).toISOString() } } : e) } } }
  })
  publish(projectId, 'project', 'changed', '')
  return saved
}

export const planningInbox = async (user: AppUser, now = Date.now()): Promise<PlanningInbox> => {
  const sessions = (await listWorkingSessions()).filter((s) => !!roleOf(user, s.id))
  const results = await Promise.allSettled(sessions.map(async (s) => {
    const p = await loadProject(s.id)
    if (p.session?.archivedAt || p.session?.snapshot) return undefined
    return { notices: planningNotices(p, user.id, now), next: nextPlanningTime(p, now) }
  }))
  const notices: PlanningInbox['notices'] = []
  let next: number | undefined
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue
    notices.push(...result.value.notices)
    const candidate = result.value.next
    if (candidate !== undefined && (next === undefined || candidate < next)) next = candidate
  }
  notices.sort((a, b) => Number(a.read) - Number(b.read) || Number(b.overdue) - Number(a.overdue) || Date.parse(a.dueAt) - Date.parse(b.dueAt))
  return { now: new Date(now).toISOString(), ...(next !== undefined ? { nextDueAt: new Date(next).toISOString() } : {}), notices }
}
