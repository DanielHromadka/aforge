import { describe, expect, it } from 'vitest'
import { newProject, nextKeys, normalizeProject, storyIdsInTitle, storyStage, workflowOf, type Issue, type Story } from './index.js'

const story: Story = { id: 'RZ-1', title: 'Rezervace', asA: 'zaměstnanec', iWant: 'rezervovat', soThat: 'mám kde jednat', acceptance: [], priority: 'must', status: 'ready', screenIds: [] }
const task = (patch: Partial<Issue>): Issue => ({ id: 'RZ-2', type: 'task', storyId: 'RZ-1', title: 'T', description: '', layer: 'fe', repoId: 'main', status: 'todo', source: 'breakdown', files: [], createdAt: '', updatedAt: '', ...patch })

describe('issues', () => {
  it('numbers epics, stories and issues in one sequence per project key', () => {
    const p = { ...newProject('rz', 'Rezervace zasedaček'), stories: [story], issues: [task({ id: 'RZ-7' })] }
    expect(nextKeys(p, 2)).toEqual(['RZ-8', 'RZ-9'])
  })
  it('keeps the US prefix of older projects and upgrades their Enterprise workflow with its prompts', () => {
    const old = { ...newProject('x', 'Směny'), key: undefined, stories: [{ ...story, id: 'US-4' }], prompts: { stories: 'Jen čtení' }, workflow: undefined }
    const p = normalizeProject(old)
    expect(p.key).toBe('US')
    expect(nextKeys(p)).toEqual(['US-5'])
    expect(p.repos).toEqual([{ id: 'main', name: 'x', platform: 'web' }])
    const legacy = { ...p, workflow: { preset: 'enterprise' as const, retained: [], steps: ['design', 'stories', 'build', 'code', 'preview', 'tests'].map((k) => ({ id: k, kind: k as 'design', label: k, prompt: k === 'tests' ? 'Chromium' : '' })) } }
    const upgraded = workflowOf(legacy)
    expect(upgraded.steps.map((s) => s.kind)).toEqual(['overview', 'design', 'stories', 'split', 'build', 'preview', 'tests', 'wiki'])
    expect(upgraded.steps.find((s) => s.kind === 'tests')?.prompt).toBe('Chromium')
  })
  it('reads any project key from test titles', () => {
    expect(storyIdsInTitle('[RZ-3] rezervace [US-12] a [x-1]')).toEqual(['RZ-3', 'US-12'])
  })
  it('places a story on the board by its tasks, bugs and tests', () => {
    const p = (issues: Issue[]) => ({ issues })
    expect(storyStage(p([]), story)).toBe('story')
    expect(storyStage(p([task({ status: 'proposed' })]), story)).toBe('split')
    expect(storyStage(p([task({ status: 'running' })]), story)).toBe('build')
    expect(storyStage(p([task({ status: 'done' })]), story)).toBe('preview')
    expect(storyStage(p([task({ status: 'done' }), task({ id: 'RZ-3', type: 'bug', status: 'todo' })]), { ...story, status: 'verified' })).toBe('tests')
    expect(storyStage(p([task({ status: 'done' })]), { ...story, status: 'verified' })).toBe('done')
  })
})

describe('roles', () => {
  it('gives other work in a client repository to the FE developer and the contract to the architect', async () => {
    const { roleOfIssue } = await import('./index.js')
    const p = { id: 'x', repos: [{ id: 'main', name: 'web', platform: 'web' as const }, { id: 'api', name: 'api', platform: 'backend' as const }] }
    expect(roleOfIssue(p, { layer: 'other', repoId: 'main' })).toBe('fe')
    expect(roleOfIssue(p, { layer: 'other', repoId: 'api' })).toBe('be')
    expect(roleOfIssue(p, { layer: 'api', repoId: 'api' })).toBe('architect')
    expect(roleOfIssue(p, { layer: 'test', repoId: 'main' })).toBe('tester')
  })
})
