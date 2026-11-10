import type { Epic, Issue, Project, Story, Walkthrough } from './index.js'

export type ItemKind = 'epic' | 'story' | 'issue' | 'test'
export const itemOf = (p: Project, kind: ItemKind, id: string): Epic | Story | Issue | Walkthrough | undefined =>
  (kind === 'epic' ? p.epics : kind === 'story' ? p.stories : kind === 'issue' ? p.issues : p.walkthroughs)?.find((i) => i.id === id)
export const itemTitle = (item: Epic | Story | Issue | Walkthrough) => 'section' in item ? item.title ?? item.section : item.title

export const deletionImpact = (p: Project, kind: ItemKind, id: string) => {
  const stories = new Set(kind === 'story' ? [id] : [])
  const issues = new Set((p.issues ?? []).filter((i) => kind === 'issue' ? i.id === id : !!i.storyId && stories.has(i.storyId)).map((i) => i.id))
  const tests = (p.walkthroughs ?? []).filter((w) => kind === 'test' ? w.id === id : w.storyIds.length > 0 && w.storyIds.every((sid) => stories.has(sid)))
  const testIds = new Set(tests.map((w) => w.id))
  for (const i of p.issues ?? []) if (i.source === 'test' && tests.some((w) => i.testTitle === `test:${w.id}`)) issues.add(i.id)
  let grew = true
  while (grew) { const count = issues.size; for (const i of p.issues ?? []) if (i.parentId && issues.has(i.parentId)) issues.add(i.id); grew = count !== issues.size }
  return { stories, issues, tests, testIds, detachedStories: kind === 'epic' ? p.stories.filter((s) => s.epicId === id) : [] }
}

export const deleteItemModel = (p: Project, kind: ItemKind, id: string, title: unknown): Project => {
  const item = itemOf(p, kind, id)
  if (!item) throw new Error('Položka už neexistuje.')
  if (typeof title !== 'string' || title !== itemTitle(item)) throw new Error('Pro potvrzení opište přesný název položky.')
  const impact = deletionImpact(p, kind, id)
  if ((p.issues ?? []).some((i) => impact.issues.has(i.id) && i.status === 'running') || impact.tests.some((w) => w.status === 'recording' || w.status === 'generating')) throw new Error('Nejprve zastavte běžící práci.')
  const changedTestStories = new Set(impact.tests.flatMap((w) => w.storyIds))
  const removedPlanning = new Set([`${kind}:${id}`, ...[...impact.stories].map((id) => `story:${id}`), ...[...impact.issues].map((id) => `issue:${id}`), ...impact.tests.map((w) => `test:${w.id}`)])
  return {
    ...p, storyRevision: (p.storyRevision ?? 0) + 1,
    ...(p.planning ? { planning: Object.fromEntries(Object.entries(p.planning).filter(([key]) => !removedPlanning.has(key))) } : {}),
    deletedKeys: [...new Set([...(p.deletedKeys ?? []), id, ...impact.issues, ...impact.stories])],
    epics: (p.epics ?? []).filter((e) => kind !== 'epic' || e.id !== id),
    stories: p.stories.filter((s) => !impact.stories.has(s.id)).map((s) => ({ ...s,
      ...(kind === 'epic' && s.epicId === id ? { epicId: undefined } : {}),
      ...(changedTestStories.has(s.id) && s.status === 'verified' ? { status: 'implemented' as const } : {}),
    })),
    issues: (p.issues ?? []).filter((i) => !impact.issues.has(i.id)),
    walkthroughs: (p.walkthroughs ?? []).filter((w) => !impact.testIds.has(w.id)).map((w) => ({ ...w, storyIds: w.storyIds.filter((sid) => !impact.stories.has(sid)) })),
    screens: p.screens.map((sc) => ({ ...sc, elements: sc.elements.map((e) => ({ ...e, storyIds: e.storyIds.filter((sid) => !impact.stories.has(sid)) })) })),
    wiki: (p.wiki ?? []).filter((w) => kind !== 'epic' || w.id !== id).map((w) => ({ ...w, sources: w.sources.filter((key) => key !== id && !impact.stories.has(key) && !impact.issues.has(key)),
      ...(w.draft ? { draft: { ...w.draft, sources: w.draft.sources.filter((key) => key !== id && !impact.stories.has(key) && !impact.issues.has(key)) } } : {}),
    })),
    ...(p.testReport ? { testReport: { ...p.testReport, cases: p.testReport.cases.filter((c) => !c.storyIds.some((sid) => impact.stories.has(sid))) } } : {}),
  }
}
