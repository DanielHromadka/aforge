import { expect, it } from 'vitest'
import { newProject, type Issue, type TestCase } from '@aforge/shared'
import { syncTestBugs } from './tests.js'

const fe: Issue = { id: 'RZ-2', type: 'task', storyId: 'RZ-1', title: 'Mřížka', description: '', layer: 'fe', repoId: 'web', status: 'done', source: 'breakdown', files: [], createdAt: '', updatedAt: '' }
const run = (status: TestCase['status']): TestCase => ({ title: 'kalendar.spec.ts › [RZ-1] skryje jména', storyIds: ['RZ-1'], status, durationMs: 1, error: 'expected hidden', screenshots: [] })

it('files one bug per failing test in the repository of the story and closes it when the test passes', () => {
  const p = { ...newProject('rz', 'Rezervace zasedaček'), issues: [fe] }
  const once = syncTestBugs(p, [run('failed')])
  const bug = once.find((i) => i.type === 'bug')!
  expect(bug).toMatchObject({ id: 'RZ-3', storyId: 'RZ-1', repoId: 'web', layer: 'fe', status: 'todo', title: 'kalendar.spec.ts › skryje jména' })
  expect(syncTestBugs({ ...p, issues: once }, [run('failed')]).filter((i) => i.type === 'bug')).toHaveLength(1)
  expect(syncTestBugs({ ...p, issues: once }, [run('passed')]).find((i) => i.id === 'RZ-3')?.status).toBe('done')
})
