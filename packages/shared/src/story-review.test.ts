import { describe, expect, it } from 'vitest'
import { decideStoryReview, newProject, nextKeys, prepareStoryReview, storyReviewBlock, type Issue, type Project, type ReviewGroupInput, type Story } from './index.js'

const story = (id: string): Story => ({ id, title: id, asA: 'uživatel', iWant: 'spravovat úkoly', soThat: 'mám přehled', acceptance: [`Kritérium ${id}`], priority: 'must', status: 'draft', screenIds: ['screen'] })
const task = (id: string, storyId?: string): Issue => ({ id, storyId, title: id, description: '', type: 'task', layer: 'fe', repoId: 'main', status: 'todo', source: 'breakdown', files: [], createdAt: 'a', updatedAt: 'a' })
const base = (): Project => ({ ...newProject('review', 'Review'), key: 'RV', stories: [story('RV-1'), story('RV-2')], issues: [task('RV-3', 'RV-1')], screens: [{ id: 'screen', name: 'Screen', width: 800, height: 600, figmaId: '', elements: [{ id: 'layer', figmaId: '', kind: 'button', type: 'button', name: 'Button', x: 0, y: 0, w: 10, h: 10, note: '', storyIds: ['RV-1', 'RV-2'], work: false }] }] })
const merged = (): ReviewGroupInput => ({ kind: 'merge', title: 'Sloučit správu úkolů', rationale: 'Stejný uživatelský cíl.', sourceIds: ['RV-1', 'RV-2'], stories: [{ ...story('new'), epicId: '', acceptance: ['Společné kritérium'] }], coverage: ['RV-1', 'RV-2'].map((sourceId) => ({ sourceId, criterion: 0, target: 0, targetCriterion: 0, note: 'Původní kritéria jsou duplicity.' })) })
const analyzed = (p: Project, groups = [merged()]): Project => ({ ...p, storyReviews: [prepareStoryReview(p, { summary: 'Revize', groups }, groups.flatMap((g) => g.sourceIds), 'r', 'now')] })

describe('backlog reorganization', () => {
  it('does not change stories until accepted; reserves new keys and archives the complete old breakdown', () => {
    const p = base()
    p.issues!.push({ ...task('RV-4'), parentId: 'RV-3', type: 'subtask' })
    const ready = analyzed(p)
    expect(ready.stories).toEqual(p.stories)
    const out = decideStoryReview(ready, 'r', 'r-1', true)
    expect(out.stories.map((s) => [s.id, s.status])).toEqual([['RV-5', 'draft']])
    expect(out.issues).toEqual([])
    expect(out.storyArchive?.[0]?.issues.map((i) => i.id)).toEqual(['RV-3', 'RV-4'])
    expect(out.storyArchive?.map((a) => a.replacedBy)).toEqual([['RV-5'], ['RV-5']])
    expect(out.screens[0]!.elements[0]!.storyIds).toEqual(['RV-5'])
    expect(nextKeys({ ...out, stories: [] })).toEqual(['RV-5'])
    expect(out.storyReviews![0]!.groups[0]!.status).toBe('accepted')
    expect(() => decideStoryReview(out, 'r', 'r-1', true)).toThrow(/vyřízen/)
  })
  it('rejects omissions, duplicate sources, unknown epics/screens and unmapped criteria', () => {
    const p = base()
    const g = merged()
    expect(() => analyzed(p, [{ ...g, coverage: g.coverage.slice(1) }])).toThrow(/Chybí přiřazení/)
    expect(() => analyzed(p, [g, g])).toThrow(/více skupin/)
    expect(() => prepareStoryReview(p, { summary: '', groups: [] }, ['RV-1'], 'r', '')).toThrow(/nepokrývá/)
    expect(() => analyzed(p, [{ ...g, stories: [{ ...g.stories[0]!, epicId: 'unknown' }] }])).toThrow(/neexistuje/)
    expect(() => analyzed(p, [{ ...g, stories: [{ ...g.stories[0]!, screenIds: [] }] }])).toThrow(/Ztrácí/)
    expect(() => analyzed(p, [{ ...g, coverage: [{ ...g.coverage[0]!, target: 5 }] }])).toThrow(/Neplatné/)
  })
  it('protects implementation evidence, nested task runs and independently defined tests', () => {
    for (const status of ['running', 'review', 'failed', 'done', 'blocked'] as const) {
      const p = base(); p.issues![0]!.status = status
      expect(storyReviewBlock(p, p.stories[0]!)).toBeTruthy()
    }
    const p = base(); p.issues!.push({ ...task('RV-4'), parentId: 'RV-3', status: 'running' })
    expect(storyReviewBlock(p, p.stories[0]!)).toBeTruthy()
    expect(storyReviewBlock(base(), base().stories[0]!)).toBeUndefined()
    const committed = base(); committed.issues![0]!.commits = { base: 'a', head: 'b' }
    expect(storyReviewBlock(committed, committed.stories[0]!)).toBeTruthy()
  })
  it('rejects stale reviews and invalid edited coverage, but allows rejection after any edit', () => {
    const p = analyzed(base())
    const changed = { ...p, stories: p.stories.map((s) => ({ ...s, title: 'Změněno' })) }
    expect(() => decideStoryReview(changed, 'r', 'r-1', true)).toThrow(/změnily/)
    expect(decideStoryReview(changed, 'r', 'r-1', false).stories).toEqual(changed.stories)
    expect(() => decideStoryReview(p, 'r', 'r-1', true, { ...merged(), coverage: [] })).toThrow(/Chybí přiřazení/)
  })
  it('applies independent groups sequentially without invalidating each other through shared design layers', () => {
    const p = base()
    const groups: ReviewGroupInput[] = p.stories.map((s) => ({ kind: 'clarify', title: s.id, rationale: 'Upřesnění', sourceIds: [s.id], stories: [{ ...s, title: 'Upřesněno', epicId: '' }], coverage: [{ sourceId: s.id, criterion: 0, target: 0, targetCriterion: 0, note: '' }] }))
    const first = decideStoryReview(analyzed(p, groups), 'r', 'r-1', true)
    const second = decideStoryReview(first, 'r', 'r-2', true)
    expect(second.storyReviews![0]!.groups.map((g) => g.status)).toEqual(['accepted', 'accepted'])
    expect(second.screens[0]!.elements[0]!.storyIds).toHaveLength(2)
  })
  it('supports splitting and keeps every original criterion traceable', () => {
    const p = { ...base(), stories: [{ ...story('RV-1'), acceptance: ['A', 'B'] }] }
    const g: ReviewGroupInput = { kind: 'split', title: 'Rozdělit', rationale: 'Dva cíle', sourceIds: ['RV-1'], stories: [{ ...story('a'), epicId: '', acceptance: ['A'] }, { ...story('b'), epicId: '', acceptance: ['B'] }], coverage: [0, 1].map((criterion) => ({ sourceId: 'RV-1', criterion, target: criterion, targetCriterion: 0, note: '' })) }
    expect(decideStoryReview(analyzed(p, [g]), 'r', 'r-1', true).stories.map((s) => s.acceptance)).toEqual([['A'], ['B']])
  })
  it('archives draft test definitions with their source, while tests with scripts protect the story', () => {
    const p = base()
    p.walkthroughs = [{ id: 'wt-draft', title: 'Ověřit seznam', storyIds: ['RV-1'], route: '/', section: 'main', instructions: 'Otevřít seznam.', script: 'e2e/walkthroughs/draft.spec.ts', status: 'draft', createdAt: '', updatedAt: '' }]
    expect(storyReviewBlock(p, p.stories[0]!)).toBeUndefined()
    const accepted = decideStoryReview(analyzed(p), 'r', 'r-1', true)
    expect(accepted.walkthroughs).toEqual([])
    expect(accepted.storyArchive![0]!.tests).toEqual(p.walkthroughs)
    p.walkthroughs[0]!.status = 'ready'
    expect(storyReviewBlock(p, p.stories[0]!)).toBeTruthy()
  })
})
