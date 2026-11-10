import { expect, it } from 'vitest'
import type { Issue } from '@aforge/shared'
import { mergeIssues } from './store.js'

const issue = (id: string, status: Issue['status'], updatedAt: string): Issue => ({ id, type: 'task', storyId: 'RZ-1', title: id, description: '', layer: 'fe', repoId: 'main', status, source: 'breakdown', files: [], createdAt: '', updatedAt })

it('keeps what agents changed on the server when an older client copy is saved', () => {
  const server = [issue('RZ-2', 'review', '2026-10-18T10:05'), issue('RZ-3', 'todo', '2026-10-18T10:00'), issue('RZ-9', 'todo', '2026-10-18T10:06')]
  const client = [issue('RZ-2', 'running', '2026-10-18T10:01'), issue('RZ-3', 'done', '2026-10-18T10:07'), issue('RZ-10', 'todo', '2026-10-18T10:08')]
  expect(mergeIssues(server, client).map((i) => [i.id, i.status])).toEqual([['RZ-2', 'review'], ['RZ-3', 'done'], ['RZ-9', 'todo'], ['RZ-10', 'todo']])
})
