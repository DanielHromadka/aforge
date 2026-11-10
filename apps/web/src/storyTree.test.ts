import { describe, expect, it } from 'vitest'
import { newProject, type Issue, type Story } from '@aforge/shared'
import { buildStoryTree, type StoryTreeNode } from './storyTree'

describe('project navigation tree', () => {
  it('nests epic, story, task and subtask; retains loose and cyclic legacy issues exactly once', () => {
    const story: Story = { id: 'P-2', epicId: 'P-1', title: 'Story', asA: '', iWant: '', soThat: '', acceptance: [], priority: 'must', status: 'draft', screenIds: [] }
    const issue = (id: string, parentId?: string, storyId?: string): Issue => ({ id, parentId, storyId, type: 'task', title: id, description: '', layer: 'fe', repoId: 'main', status: 'todo', source: 'manual', files: [], createdAt: '', updatedAt: '' })
    const tree = buildStoryTree({ ...newProject('tree', 'Tree'), epics: [{ id: 'P-1', title: 'Epic', description: '', screenIds: [] }], stories: [story], issues: [issue('P-3', undefined, 'P-2'), issue('P-4', 'P-3'), issue('P-5'), issue('P-6', 'P-7'), issue('P-7', 'P-6')] })
    expect(tree[0]!.children[0]!.children[0]!.children[0]!.id).toBe('P-4')
    const flatten = (nodes: StoryTreeNode[]): string[] => nodes.flatMap((n) => [n.id, ...flatten(n.children)])
    const ids = flatten(tree)
    for (const id of ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7']) expect(ids.filter((i) => i === id)).toHaveLength(1)
  })
})
