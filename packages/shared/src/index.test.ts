import { describe, expect, it } from 'vitest'
import { applyOps, AgentReplySchema, designOutline, newProject, normalizeProject, storyIdsInTitle, type DesignElement, type Screen, type Story } from './index.js'

const story: Story = { id: 'US-1', title: 'Login', asA: 'user', iWant: 'log in', soThat: 'work', acceptance: [], priority: 'must', status: 'draft', screenIds: [] }

describe('applyOps', () => {
  it('upserts and deletes stories by id', () => {
    let p = applyOps(newProject('x', 'X'), [{ type: 'story.upsert', story }])
    p = applyOps(p, [{ type: 'story.upsert', story: { ...story, title: 'Sign in' } }])
    expect(p.stories).toEqual([{ ...story, title: 'Sign in' }])
    expect(applyOps(p, [{ type: 'story.delete', id: 'US-1' }]).stories).toEqual([])
  })

  it('upserts and deletes diagrams, creating the architecture on the way', () => {
    const diagram = { id: 'dg-1', title: 'Architektura', type: 'flowchart' as const, mermaid: 'flowchart TD\n  FE --> BE', description: '', steps: [], storyIds: [] }
    let p = applyOps(newProject('x', 'X'), [{ type: 'diagram.upsert', diagram }])
    expect(p.architecture?.diagrams).toEqual([diagram])
    p = applyOps(p, [{ type: 'diagram.upsert', diagram: { ...diagram, title: 'Celek' } }, { type: 'diagram.delete', id: 'nope' }])
    expect(p.architecture?.diagrams.map((d) => d.title)).toEqual(['Celek'])
    expect(applyOps(p, [{ type: 'diagram.delete', id: 'dg-1' }]).architecture?.diagrams).toEqual([])
  })

  it('annotates an element without touching what came from Figma', () => {
    const el: DesignElement = { id: 'el-1', figmaId: '1:2', kind: 'button', type: 'INSTANCE', name: 'OK', x: 1, y: 2, w: 3, h: 4, note: '', storyIds: [], work: false }
    const base = { ...newProject('x', 'X'), screens: [{ id: 's', figmaId: '1:1', name: 'S', width: 10, height: 10, elements: [el] }] }
    const p = applyOps(base, [{ type: 'element.annotate', screenId: 's', id: 'el-1', work: true, note: 'Odešle formulář' }])
    expect(p.screens[0]!.elements).toEqual([{ ...el, work: true, note: 'Odešle formulář' }])
    expect(applyOps(base, [{ type: 'element.annotate', screenId: 's', id: 'nope', work: true }]).screens).toEqual(base.screens)
  })
})

it('reads story ids from test titles', () => {
  expect(storyIdsInTitle('[US-3] [US-12] booking › conflict')).toEqual(['US-3', 'US-12'])
})

it('rejects agent replies with unknown ops', () => {
  expect(AgentReplySchema.safeParse({ reply: '', proposals: [{ id: 'p', title: '', rationale: '', ops: [{ type: 'rm.rf' }] }], conflicts: [] }).success).toBe(false)
})

it('outlines the upper layers and every annotated element', () => {
  const el = (id: string, parentId?: string, work = false): DesignElement => ({ id, figmaId: id, parentId, kind: 'container', type: 'FRAME', name: id, x: 0, y: 0, w: 1, h: 1, note: '', storyIds: [], work })
  const screen: Screen = { id: 's', figmaId: 's', name: 'S', width: 1, height: 1, elements: [el('a'), el('b', 'a'), el('c', 'b'), el('d', 'c'), el('e', 'd', true)] }
  expect(designOutline(screen, 1).map((e) => e.id)).toEqual(['a', 'b', 'e'])
})

it('reads old projects: blocks and the stack choice go, the agent stays', () => {
  const old = { ...newProject('x', 'X'), stack: { backend: 'dotnet', frontend: 'react', hosting: 'aks', agent: 'codex' }, blocks: { nodes: [], edges: [] }, prompts: undefined } as never
  const p = normalizeProject(old)
  expect(p.stack).toEqual({ agent: 'codex' })
  expect(p.prompts).toEqual({})
  expect('blocks' in p).toBe(false)
})
