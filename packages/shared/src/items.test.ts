import { describe, expect, it } from 'vitest'
import { deleteItemModel, deletionImpact, newProject, nextKeys, type Issue, type Project, type Story, type Walkthrough } from './index.js'

const story = (id: string): Story => ({ id, epicId: 'EP-1', title: `Název ${id}`, asA: '', iWant: '', soThat: '', acceptance: [], status: 'draft', priority: 'should', screenIds: [] })
const issue = (id: string, parentId?: string): Issue => ({ id, parentId, storyId: parentId ? undefined : 'EP-2', type: 'task', title: id, description: '', layer: 'fe', repoId: 'main', status: 'todo', source: 'manual', files: [], createdAt: '', updatedAt: '' })
const test = (id: string, storyIds: string[]): Walkthrough => ({ id, storyIds, title: id, route: '/', section: 'main', instructions: '', script: `e2e/walkthroughs/${id}.spec.ts`, status: 'draft', createdAt: '', updatedAt: '' })
const base = (): Project => ({ ...newProject('items', 'Items'), key: 'EP', epics: [{ id: 'EP-1', title: 'Epic', description: '', screenIds: [] }], stories: [story('EP-2'), story('EP-3')], issues: [issue('EP-4'), issue('EP-5', 'EP-4'), issue('EP-6', 'EP-5')], walkthroughs: [test('own', ['EP-2']), test('shared', ['EP-2', 'EP-3'])] })
describe('item deletion', () => {
  it('requires the exact title, including case, and removes an entire descendant chain', () => {
    const p = base()
    for (const value of [undefined, '', 'název EP-2', ' Název EP-2']) expect(() => deleteItemModel(p, 'story', 'EP-2', value)).toThrow(/přesný název/)
    const out = deleteItemModel(p, 'story', 'EP-2', 'Název EP-2')
    expect(out.stories.map((s) => s.id)).toEqual(['EP-3'])
    expect(out.issues).toEqual([])
    expect(out.walkthroughs).toHaveLength(1)
    expect(out.walkthroughs![0]!.storyIds).toEqual(['EP-3'])
    expect(nextKeys(out)).toEqual(['EP-7'])
    expect(p.issues).toHaveLength(3)
  })
  it('deletes an epic without deleting its stories and prevents running descendant deletion', () => {
    const p = base()
    const out = deleteItemModel(p, 'epic', 'EP-1', 'Epic')
    expect(out.epics).toEqual([])
    expect(out.stories.every((s) => !s.epicId)).toBe(true)
    expect(out.issues).toEqual(p.issues)
    p.issues![2]!.status = 'running'
    expect(() => deleteItemModel(p, 'issue', 'EP-4', 'EP-4')).toThrow(/zastavte/)
  })
  it('removes test-generated bugs and exposes the same cascade for preview and execution', () => {
    const p = base()
    p.issues!.push({ ...issue('EP-7'), source: 'test', testTitle: 'test:own', type: 'bug' })
    expect(deletionImpact(p, 'test', 'own').issues.has('EP-7')).toBe(true)
    expect(deleteItemModel(p, 'test', 'own', 'own').issues?.some((i) => i.id === 'EP-7')).toBe(false)
    p.walkthroughs![0]!.status = 'recording'
    expect(() => deleteItemModel(p, 'test', 'own', 'own')).toThrow(/zastavte/)
  })
})
