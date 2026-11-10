import { describe, expect, it } from 'vitest'
import { backlogChange, hasIde, ideSettingsOf, newProject, normalizeProject, sectionPromptsOf, workflowOf, workflowPreset, type Backlog, type Project } from './index.js'

const draft = { title: 'Košík', asA: 'zákazník', iWant: 'košík', soThat: 'nakoupím', acceptance: ['A'], priority: 'must' as const }
const b = (x: Partial<Backlog>): Backlog => ({ decision: 'new', storyId: '', candidates: [], addCriteria: [], epicId: '', epic: { title: '', description: '' }, story: draft, ...x })
const base = (): Project => ({ ...newProject('x', 'Eshop'), key: 'ES', stories: [{ id: 'ES-1', title: 'Katalog', asA: 'a', iWant: 'b', soThat: 'c', acceptance: ['A'], priority: 'must', status: 'ready', screenIds: [] }] })

describe('agentic IDE model', () => {
  it('is a workflow preset whose step carries no generation prompt', () => {
    const w = workflowPreset('ide', workflowOf(newProject('x', 'X')))
    expect(w.steps.map((s) => s.kind)).toEqual(['ide', 'preview', 'tests', 'wiki'])
    w.steps[0]!.prompt = 'Konvence repozitáře'
    const p = normalizeProject({ ...newProject('x', 'X'), workflow: w })
    expect(hasIde(p)).toBe(true)
    expect(sectionPromptsOf(p)).not.toHaveProperty('ide')
    expect(ideSettingsOf(p)).toEqual({ record: 'auto', wiki: 'auto', voice: false })
  })

  it('treats an unknown story as unsorted instead of guessing and drops unknown candidates', () => {
    const r = backlogChange(base(), b({ decision: 'existing', storyId: 'ES-9', candidates: ['ES-1', 'ES-7'] }), 'p1')
    expect(r.ops).toEqual([])
    expect(r.storyId).toBeUndefined()
    expect(r.events).toMatchObject([{ kind: 'unsorted', candidates: ['ES-1'], draft }])
  })

  it('adds only new criteria and records nothing when the prompt adds none', () => {
    const p = base()
    expect(backlogChange(p, b({ decision: 'existing', storyId: 'ES-1', addCriteria: [' A '] }), 'p1')).toMatchObject({ ops: [], events: [], storyId: 'ES-1' })
    const r = backlogChange(p, b({ decision: 'existing', storyId: 'ES-1', addCriteria: ['B'] }), 'p1')
    expect(r.ops).toMatchObject([{ type: 'story.upsert', story: { id: 'ES-1', acceptance: ['A', 'B'] } }])
    expect(r.events[0]?.revert).toMatchObject({ type: 'story', before: { acceptance: ['A'] } })
  })

  it('creates a story under a known epic only, and a new epic only with a title', () => {
    const p = base()
    expect(backlogChange(p, b({ epicId: 'ES-404' }), 'p').ops).toMatchObject([{ type: 'story.upsert', story: { id: 'ES-2', epicId: undefined } }])
    expect(backlogChange(p, b({ epicId: 'new', epic: { title: ' ', description: '' } }), 'p').ops).toHaveLength(1)
    expect(backlogChange(p, b({ epicId: 'new', epic: { title: 'Nákup', description: '' } }), 'p').ops.map((o) => o.type)).toEqual(['epic.upsert', 'story.upsert'])
    expect(backlogChange(p, b({ decision: 'technical' }), 'p')).toMatchObject({ ops: [], events: [], summary: 'Technická změna, bez story' })
  })
})
