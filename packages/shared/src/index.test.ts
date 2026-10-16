import { describe, expect, it } from 'vitest'
import { applyOps, AgentReplySchema, newProject, storyIdsInTitle, type Story } from './index.js'

const story: Story = { id: 'US-1', title: 'Login', asA: 'user', iWant: 'log in', soThat: 'work', acceptance: [], priority: 'must', status: 'draft', screenIds: [] }

describe('applyOps', () => {
  it('upserts and deletes stories by id', () => {
    let p = applyOps(newProject('x', 'X'), [{ type: 'story.upsert', story }])
    p = applyOps(p, [{ type: 'story.upsert', story: { ...story, title: 'Sign in' } }])
    expect(p.stories).toEqual([{ ...story, title: 'Sign in' }])
    expect(applyOps(p, [{ type: 'story.delete', id: 'US-1' }]).stories).toEqual([])
  })

  it('drops the edges of a deleted block', () => {
    const node = { id: 'a', kind: 'page' as const, label: 'A', description: '', x: 0, y: 0, storyIds: [] }
    const p = applyOps(newProject('x', 'X'), [
      { type: 'block.upsert', node },
      { type: 'block.upsert', node: { ...node, id: 'b' } },
      { type: 'edge.upsert', edge: { id: 'e', from: 'a', to: 'b', label: '' } },
      { type: 'block.delete', id: 'a' },
    ])
    expect(p.blocks.nodes.map((n) => n.id)).toEqual(['b'])
    expect(p.blocks.edges).toEqual([])
  })

  it('adds elements to the right screen', () => {
    const el = { id: 'el-1', kind: 'button' as const, x: 1, y: 2, w: 3, h: 4, label: 'OK', note: '', storyIds: [] }
    const p = applyOps(newProject('x', 'X'), [{ type: 'element.upsert', screenId: 'screen-1', element: el }])
    expect(p.screens[0]!.elements).toEqual([el])
  })
})

it('reads story ids from test titles', () => {
  expect(storyIdsInTitle('[US-3] [US-12] booking › conflict')).toEqual(['US-3', 'US-12'])
})

it('rejects agent replies with unknown ops', () => {
  expect(AgentReplySchema.safeParse({ reply: '', proposals: [{ id: 'p', title: '', rationale: '', ops: [{ type: 'rm.rf' }] }], conflicts: [] }).success).toBe(false)
})
