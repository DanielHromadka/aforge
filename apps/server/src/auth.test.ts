import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, it, vi } from 'vitest'
import type { AppUser } from '@aforge/shared'

let auth: typeof import('./auth.js')
const user = (id: string, admin = false): AppUser => ({ id, username: id, name: id, admin, lastLoginAt: '' })

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aforge-auth-test-'))
  vi.stubEnv('AFORGE_DATA', dir)
  for (const id of ['open', 'team']) {
    await mkdir(join(dir, 'projects', id), { recursive: true })
    await writeFile(join(dir, 'projects', id, 'project.json'), JSON.stringify({ createdAt: '' }))
  }
  auth = await import('./auth.js')
  await auth.setMember('team', 'ann', 'owner')
  await auth.setMember('team', 'bob', 'viewer')
})

it('denies access to projects without members and restricts the others to their members', () => {
  expect(auth.roleOf(user('bob'), 'open')).toBeUndefined()
  expect(auth.roleOf(user('bob'), 'team')).toBe('viewer')
  expect(auth.roleOf(user('bob'), 'team--initial')).toBe('viewer')
  expect(auth.roleOf(user('eve'), 'team')).toBeUndefined()
  expect(auth.roleOf(user('eve', true), 'team')).toBe('owner')
})

it('keeps at least one owner', async () => {
  await expect(auth.setMember('team', 'ann', 'editor')).rejects.toThrow('vlastníka')
  await auth.setMember('team', 'bob', 'owner')
  await auth.setMember('team', 'ann', null)
  expect(auth.membersOf('team')).toEqual({ bob: 'owner' })
})
