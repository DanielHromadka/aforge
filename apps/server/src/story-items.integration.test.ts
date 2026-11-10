import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { Project, Story, Walkthrough } from '@aforge/shared'

vi.mock('./agents.js', async (original) => ({ ...await original<typeof import('./agents.js')>(), structured: vi.fn() }))
let app: FastifyInstance
let dir: string
let project: Project
const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown) => app.inject({ method, url: `/api/projects/${project.id}${path}`, ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }) })
const get = async () => (await request('GET', '')).json<Project>()
const story = (id: string): Story => ({ id, title: id, asA: 'uživatel', iWant: 'úkoly', soThat: 'mám přehled', acceptance: ['A'], priority: 'must', status: 'draft', screenIds: [] })
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reactor-story-items-'))
  vi.stubEnv('AFORGE_DATA', dir); vi.stubEnv('AFORGE_AUTH', 'off'); vi.stubEnv('PORT', '0'); vi.stubEnv('AFORGE_RELAY', undefined)
  app = (await import('./index.js')).app
  project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Story items test' } })).json<Project>()
  project = (await request('PUT', '', { ...project, key: 'SI', stories: [story('SI-1'), story('SI-2')] })).json<Project>()
}, 15000)
afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); if (dir) await rm(dir, { recursive: true, force: true }) })

describe('story review and item API', () => {
  it('stores analysis without changing backlog, accepts it atomically and prevents stale clients undoing it', async () => {
    const { structured } = await import('./agents.js')
    vi.mocked(structured).mockResolvedValueOnce({ summary: 'Stejný cíl', groups: [{ kind: 'merge', title: 'Sloučit', rationale: 'Duplicita', sourceIds: ['SI-1', 'SI-2'], stories: [{ title: 'Správa úkolů', asA: 'uživatel', iWant: 'úkoly', soThat: 'mám přehled', acceptance: ['A'], priority: 'must', screenIds: [], epicId: '' }], coverage: ['SI-1', 'SI-2'].map((sourceId) => ({ sourceId, criterion: 0, target: 0, targetCriterion: 0, note: 'Duplicita' })) }] })
    const generated = await request('POST', '/generate/reorganize', { storyIds: ['SI-1', 'SI-2'] })
    expect(generated.statusCode).toBe(200)
    expect((await get()).stories).toEqual(project.stories)
    const pending = await get()
    const review = pending.storyReviews![0]!
    const accepted = await request('POST', `/story-reviews/${review.id}/${review.groups[0]!.id}/decide`, { accept: true })
    expect(accepted.statusCode).toBe(200)
    const current = await get()
    expect(current.stories.map((s) => s.id)).toEqual(['SI-3'])
    expect(current.storyArchive).toHaveLength(2)
    expect((await request('PUT', '', pending)).statusCode).toBe(409)
    expect((await get()).stories).toEqual(current.stories)
    // Client autosave cannot forge review decisions or erase history.
    expect((await request('PUT', '', { ...current, storyReviews: [], storyArchive: [] })).statusCode).toBe(200)
    expect((await get()).storyArchive).toHaveLength(2)
  })
  it('checks the typed title on both deletion routes, removes test files and rejects stale resurrection', async () => {
    const w = (await request('POST', '/walkthroughs', { title: 'Můj test', route: '/', section: 'main', storyIds: ['SI-3'] })).json<Walkthrough>()
    const root = join(dir, 'projects', project.id)
    await mkdir(join(root, 'workspace/e2e/walkthroughs'), { recursive: true })
    await writeFile(join(root, 'workspace', w.script), 'test script')
    const before = await get()
    expect((await request('DELETE', `/walkthroughs/${w.id}`, { title: 'můj test' })).statusCode).toBe(400)
    expect(existsSync(join(root, 'workspace', w.script))).toBe(true)
    expect((await request('POST', `/items/test/${w.id}/delete`, { title: 'Můj test' })).statusCode).toBe(200)
    expect((await get()).walkthroughs).toEqual([])
    expect(existsSync(join(root, 'workspace', w.script))).toBe(false)
    expect((await request('PUT', '', before)).statusCode).toBe(409)
  })
  it('edits task content without allowing state or identity injection and preserves edits on a newer autosave', async () => {
    let p = await get()
    const now = new Date().toISOString()
    p = (await request('PUT', '', { ...p, issues: [{ id: 'SI-4', storyId: 'SI-3', title: 'Task', description: '', layer: 'fe', repoId: 'main', type: 'task', status: 'todo', source: 'manual', files: [], createdAt: now, updatedAt: now }] })).json<Project>()
    const edited = await request('POST', '/items/issue/SI-4/edit', { id: 'hack', status: 'done', title: 'Upravený task', description: 'Podrobné zadání', layer: 'fe', repoId: 'main' })
    expect(edited.statusCode).toBe(200)
    expect((await get()).issues![0]).toMatchObject({ id: 'SI-4', status: 'todo', title: 'Upravený task', description: 'Podrobné zadání' })
    await request('PUT', '', p)
    expect((await get()).issues![0]!.title).toBe('Upravený task')
  })
  it('invalidates the old test script after scenario edits, and rejects mutation during active jobs and in snapshots', async () => {
    const w = (await request('POST', '/walkthroughs', { title: 'Scénář', route: '/', section: 'main', storyIds: ['SI-3'] })).json<Walkthrough>()
    const script = join(dir, 'projects', project.id, 'workspace', w.script)
    await writeFile(script, 'old scenario')
    const edit = { title: 'Nový scénář', route: '/tasks', section: 'main', instructions: 'Kliknout' }
    expect((await request('POST', `/items/test/${w.id}/edit`, edit)).statusCode).toBe(200)
    expect((await get()).walkthroughs![0]).toMatchObject({ ...edit, status: 'draft' })
    expect(existsSync(script)).toBe(false)
    const { agentRuns } = await import('./agent-runs.js')
    const run = agentRuns.start({ projectId: project.id, projectName: project.name, step: 'Test' }, 'codex', 'local')
    try { expect((await request('POST', `/items/test/${w.id}/delete`, { title: 'Nový scénář' })).statusCode).toBe(400) } finally { agentRuns.finish(run, 'done') }
    const snapshot = (await request('POST', '/snapshots', { name: 'Frozen' })).json<Project>()
    const blocked = await app.inject({ method: 'POST', url: `/api/projects/${snapshot.id}/items/story/SI-3/delete`, payload: { title: 'Správa úkolů' } })
    expect(blocked.statusCode).toBe(403)
    const persisted = JSON.parse(await readFile(join(dir, 'projects', project.id, 'project.json'), 'utf8')) as Project
    expect(persisted.storyArchive).toHaveLength(2)
  })
})
