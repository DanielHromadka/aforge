import { z } from 'zod'
import { nextKeys, type Issue, type Project, type Story, type Walkthrough } from './index.js'
import { reorganizePlanning } from './planning.js'

// Result keys are assigned only on acceptance, from the current project sequence.
export const ReviewStorySchema = z.object({
  title: z.string().trim().min(1), asA: z.string(), iWant: z.string(), soThat: z.string(),
  description: z.string().optional(),
  epicId: z.string().describe('Existing epic key, or empty for no epic'),
  priority: z.enum(['must', 'should', 'could', 'wont']), screenIds: z.array(z.string()),
  acceptance: z.array(z.string().trim().min(1)),
})
export const ReviewGroupSchema = z.object({
  kind: z.enum(['merge', 'split', 'reshape', 'move', 'clarify', 'keep']),
  title: z.string().trim().min(1), rationale: z.string().trim().min(1),
  sourceIds: z.array(z.string()).min(1),
  stories: z.array(ReviewStorySchema).min(1),
  coverage: z.array(z.object({
    sourceId: z.string(), criterion: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(), targetCriterion: z.number().int().nonnegative(),
    note: z.string().describe('How the original criterion is preserved, including deduplication'),
  })),
})
export const StoryReviewResultSchema = z.object({ summary: z.string(), groups: z.array(ReviewGroupSchema) })
export type ReviewGroupInput = z.infer<typeof ReviewGroupSchema>
export type ReviewStory = z.infer<typeof ReviewStorySchema>
export interface ReviewGroup extends ReviewGroupInput {
  id: string
  status: 'pending' | 'accepted' | 'rejected'
  before: Story[]
  fingerprint: string
  resultIds?: string[]
  decidedAt?: string
}
export interface StoryReview {
  id: string
  createdAt: string
  summary: string
  sourceIds: string[]
  groups: ReviewGroup[]
}
export interface StoryArchive {
  story: Story
  issues: Issue[]
  tests?: Walkthrough[]
  replacedBy: string[]
  reviewId: string
  groupId: string
  at: string
}

const ownIssues = (p: Project, ids: string[]): Issue[] => {
  const own = new Set((p.issues ?? []).filter((i) => i.storyId && ids.includes(i.storyId)).map((i) => i.id))
  let grew = true
  while (grew) { const count = own.size; for (const i of p.issues ?? []) if (i.parentId && own.has(i.parentId)) own.add(i.id); grew = count !== own.size }
  return (p.issues ?? []).filter((i) => own.has(i.id))
}
export const storyReviewBlock = (p: Project, s: Story): string | undefined => {
  if (s.status === 'implemented' || s.status === 'verified') return 'Story už je implementovaná.'
  const issues = ownIssues(p, [s.id])
  if (issues.some((i) => !['proposed', 'todo'].includes(i.status) || i.commits || i.files.length || i.feedback)) return 'Na taskech nebo buzích už začala práce.'
  if (p.testReport?.cases.some((c) => c.storyIds.includes(s.id))) return 'Story už má výsledky testů.'
  if (p.walkthroughs?.some((w) => w.storyIds.includes(s.id) && w.status !== 'draft')) return 'Na samostatných testech nebo průchodech už začala práce.'
  return undefined
}

export const reviewFingerprint = (p: Project, ids: string[]) => JSON.stringify({
  stories: ids.map((id) => p.stories.find((s) => s.id === id)),
  issues: ownIssues(p, ids),
  tests: (p.walkthroughs ?? []).filter((w) => w.storyIds.some((id) => ids.includes(id))),
  attachments: (p.attachments ?? []).filter((a) => (a.itemKind === 'story' && ids.includes(a.itemId)) || (a.itemKind === 'issue' && ownIssues(p, ids).some((i) => i.id === a.itemId)) || a.refs?.some((r) => r.kind === 'story' && ids.includes(r.id))).map(({ id, name, size, mime }) => ({ id, name, size, mime })),
  epics: p.epics ?? [], screens: p.screens.map((sc) => ({ ...sc, elements: sc.elements.map((e) => ({ ...e, storyIds: e.storyIds.filter((id) => ids.includes(id)) })) })),
})

/** Reject malformed or lossy proposals before they are shown, and again after user edits. */
export const validateReviewGroup = (p: Project, input: ReviewGroupInput): ReviewGroupInput => {
  const g = ReviewGroupSchema.parse(input)
  const fail = (message: string): never => { throw new Error(`${g.title}: ${message}`) }
  if (new Set(g.sourceIds).size !== g.sourceIds.length) fail('Story je ve skupině vícekrát.')
  const sources = g.sourceIds.map((id) => {
    const s = p.stories.find((s) => s.id === id)
    if (!s) return fail(`Story ${id} už není v backlogu.`)
    const block = storyReviewBlock(p, s)
    if (block) fail(`${id}: ${block}`)
    return s
  })
  if (sources.some((s) => s.description?.trim()) && !g.stories.some((s) => s.description?.trim())) fail('Výsledek musí zachovat podrobný popis zdrojových stories.')
  if (g.kind === 'merge' && (sources.length < 2 || g.stories.length !== 1)) fail('Sloučení musí mít více vstupů a jeden výsledek.')
  if (g.kind === 'split' && (sources.length !== 1 || g.stories.length < 2)) fail('Rozdělení musí mít jeden vstup a více výsledků.')
  if (['move', 'clarify', 'keep'].includes(g.kind) && (sources.length !== 1 || g.stories.length !== 1)) fail('Tato změna musí mít jednu vstupní i výslednou story.')
  for (const s of g.stories) {
    if (s.epicId && !p.epics?.some((e) => e.id === s.epicId)) fail(`Epic ${s.epicId} neexistuje.`)
    if (s.screenIds.some((id) => !p.screens.some((sc) => sc.id === id))) fail('Výsledek odkazuje na neexistující obrazovku.')
  }
  for (const m of g.coverage) {
    const s = sources.find((s) => s.id === m.sourceId)
    if (!s || s.acceptance[m.criterion] === undefined || g.stories[m.target]?.acceptance[m.targetCriterion] === undefined) fail('Neplatné přiřazení akceptačního kritéria.')
  }
  for (const s of sources) {
    for (let criterion = 0; criterion < s.acceptance.length; criterion++) {
      if (!g.coverage.some((m) => m.sourceId === s.id && m.criterion === criterion)) fail(`Chybí přiřazení kritéria ${s.id} č. ${criterion + 1}.`)
    }
    for (const id of s.screenIds) if (!g.stories.some((t) => t.screenIds.includes(id))) fail(`Ztrácí se vazba na obrazovku ${id}.`)
  }
  if (g.kind === 'keep') {
    const { id: _id, status: _status, ...before } = sources[0]!
    const t = g.stories[0]!
    for (const key of ['title', 'asA', 'iWant', 'soThat', 'priority'] as const) if (t[key] !== before[key]) fail('Ponechání nesmí měnit obsah.')
    if ((t.description ?? '') !== (before.description ?? '')) fail('Ponechání nesmí měnit popis.')
    if (t.epicId !== (before.epicId ?? '') || JSON.stringify(t.acceptance) !== JSON.stringify(before.acceptance) || JSON.stringify(t.screenIds) !== JSON.stringify(before.screenIds)) fail('Ponechání nesmí měnit obsah.')
  }
  return g
}

export const prepareStoryReview = (p: Project, raw: unknown, ids: string[], id: string, at: string): StoryReview => {
  const result = StoryReviewResultSchema.parse(raw)
  const seen = new Set<string>()
  const groups = result.groups.map((input, n): ReviewGroup => {
    const g = validateReviewGroup(p, input)
    for (const source of g.sourceIds) {
      if (!ids.includes(source) || seen.has(source)) throw new Error(`Story ${source} je mimo výběr nebo ve více skupinách.`)
      seen.add(source)
    }
    return { ...g, id: `${id}-${n + 1}`, status: 'pending', before: g.sourceIds.map((id) => p.stories.find((s) => s.id === id)!), fingerprint: reviewFingerprint(p, g.sourceIds) }
  })
  if (ids.some((id) => !seen.has(id))) throw new Error('Analýza nepokrývá všechny vybrané stories, včetně těch k ponechání.')
  return { id, createdAt: at, summary: result.summary, sourceIds: ids, groups }
}

/** Every group is one atomic decision; originals and their old breakdown remain inspectable. */
export const decideStoryReview = (p: Project, reviewId: string, groupId: string, accept: boolean, edited?: ReviewGroupInput, at = new Date().toISOString()): Project => {
  const review = p.storyReviews?.find((r) => r.id === reviewId)
  const group = review?.groups.find((g) => g.id === groupId)
  if (!group || group.status !== 'pending') throw new Error('Návrh neexistuje nebo už byl vyřízen.')
  let next = p
  let resultIds: string[] | undefined
  let input: ReviewGroupInput = group
  if (accept) {
    if (reviewFingerprint(p, group.sourceIds) !== group.fingerprint) throw new Error('Zadání, design nebo rozpad se od analýzy změnily. Spusťte novou analýzu.')
    input = validateReviewGroup(p, edited ?? group)
    if (input.kind !== group.kind || JSON.stringify(input.sourceIds) !== JSON.stringify(group.sourceIds)) throw new Error('Upravovat lze výsledný obsah a kritéria, nikoli vstupní stories nebo typ změny.')
    if (input.kind === 'keep') resultIds = group.sourceIds
    else {
      resultIds = nextKeys(p, input.stories.length)
      const stories: Story[] = input.stories.map((s, n) => ({ ...s, id: resultIds![n]!, epicId: s.epicId || undefined, status: 'draft' }))
      const sources = new Set(group.sourceIds)
      const oldIssues = new Set(ownIssues(p, group.sourceIds).map((i) => i.id))
      next = {
        ...p, storyRevision: (p.storyRevision ?? 0) + 1,
        planning: reorganizePlanning(p, group.sourceIds, [...oldIssues], resultIds, at),
        attachments: p.attachments?.map((a) => (a.itemKind === 'story' && sources.has(a.itemId)) || (a.itemKind === 'issue' && oldIssues.has(a.itemId)) || a.refs?.some((r) => (r.kind === 'story' && sources.has(r.id)) || (r.kind === 'issue' && oldIssues.has(r.id)))
          ? { ...a, refs: [...(a.refs ?? []), ...resultIds!.map((id) => ({ kind: 'story' as const, id }))] } : a),
        stories: [...p.stories.filter((s) => !sources.has(s.id)), ...stories],
        issues: (p.issues ?? []).filter((i) => !oldIssues.has(i.id)),
        walkthroughs: (p.walkthroughs ?? []).filter((w) => !w.storyIds.length || !w.storyIds.every((id) => sources.has(id))).map((w) => ({ ...w, storyIds: w.storyIds.filter((id) => !sources.has(id)) })),
        storyArchive: [...(p.storyArchive ?? []), ...group.before.map((story) => ({
          story, issues: ownIssues(p, [story.id]), replacedBy: resultIds!, reviewId, groupId, at,
          tests: (p.walkthroughs ?? []).filter((w) => w.storyIds.includes(story.id)),
        }))],
        // A layer can refer to multiple descendants until its precise ownership is refined.
        screens: p.screens.map((sc) => ({ ...sc, elements: sc.elements.map((e) => ({ ...e,
          storyIds: [...new Set(e.storyIds.flatMap((id) => sources.has(id) ? resultIds! : [id]))],
        })) })),
      }
    }
  }
  return { ...next, storyReviews: (next.storyReviews ?? []).map((r) => r.id !== reviewId ? r : { ...r, groups: r.groups.map((g) => g.id !== groupId ? g : { ...g, ...input, status: accept ? 'accepted' : 'rejected', decidedAt: at, resultIds }) }) }
}
