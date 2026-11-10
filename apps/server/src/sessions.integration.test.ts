import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { workflowPreset, workflowOf, type Project, type ProjectHistory } from '@aforge/shared'

let app: FastifyInstance
let dir: string
let source: Project
let snapshot: Project
let other: Project
let registry: typeof import('./agent-runs.js').agentRuns
const request = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', id: string, path = '', body?: unknown) => {
  const res = await app.inject({ method, url: `/api/projects/${id}${path}`, ...(body !== undefined ? { payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })
  return { status: res.statusCode, body: res.json() }
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aforge-sessions-test-'))
  vi.stubEnv('AFORGE_DATA', dir); vi.stubEnv('AFORGE_AUTH', 'off'); vi.stubEnv('PORT', '0'); vi.stubEnv('AFORGE_RELAY', undefined)
  app = (await import('./index.js')).app
  registry = (await import('./agent-runs.js')).agentRuns
  source = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Sessions test', description: 'Původní zadání' } })).json<Project>()
  const now = new Date().toISOString()
  source = (await request('PUT', source.id, '', {
    ...source,
    prompts: { design: 'Design prompt', stories: 'Stories prompt', blocks: 'Blocks prompt', plan: 'Implementation prompt', code: 'Code prompt', preview: 'Preview prompt', tests: 'Tests prompt' },
    screens: [{ id: 'screen', name: 'Landing', width: 800, height: 600, figmaId: '1:2', image: 'design.png', elements: [] }],
    stories: [{ id: 'US-1', title: 'Read data', asA: 'user', iWant: 'read data', soThat: 'I know', priority: 'must', status: 'verified', acceptance: ['Given data, When opened, Then visible'], screenIds: ['screen'] }],
    architecture: { generatedAt: now, stack: { frontend: 'React', backend: 'Node', database: 'memory', reason: 'Test' }, summary: 'Test architecture', diagrams: [] },
    buildPlan: { generatedAt: now, prompt: '# Implementace\nUložený text', changes: [{ path: 'app.ts', action: 'create', reason: 'Test implementation' }] },
    testReport: { startedAt: now, finishedAt: now, ok: true, cases: [{ title: '[US-1] read data', storyIds: ['US-1'], status: 'passed', durationMs: 10, screenshots: ['.aforge/test-output/result.png'] }], log: 'Tests passed' },
    walkthroughs: [{ id: 'wt-test', route: '/', section: 'main', storyIds: ['US-1'], instructions: 'Open page', script: 'e2e/walkthroughs/test.spec.ts', status: 'recorded', video: 'wt-test.webm', createdAt: now, updatedAt: now }],
  })).body
  await request('PUT', source.id, '/file', { path: 'app.ts', content: 'export const value = 1' })
  const root = join(dir, 'projects', source.id)
  await mkdir(join(root, 'figma')); await writeFile(join(root, 'figma/design.png'), 'design bytes')
  await mkdir(join(root, 'workspace/.aforge/test-output'), { recursive: true }); await writeFile(join(root, 'workspace/.aforge/test-output/result.png'), 'screenshot bytes')
  await mkdir(join(root, 'walkthroughs')); await writeFile(join(root, 'walkthroughs/wt-test.webm'), 'video bytes')
  await (await import('./store.js')).saveChat(source.id, [{ id: 'chat-1', role: 'user', text: 'Uložená konverzace', stage: 'stories', proposals: [], conflicts: [], createdAt: now }])
  ;(await import('./events.js')).publish(source.id, 'build', 'done', 'Build completed')
}, 15000)
afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); if (dir) await rm(dir, { recursive: true, force: true }) })

describe('sessions and immutable snapshots through the HTTP API', () => {
  it('treats a legacy project as its initial session without moving its workspace', async () => {
    const history = (await request('GET', source.id, '/sessions')).body as ProjectHistory
    expect(history.sessions).toMatchObject([{ id: source.id, name: 'Session 1' }])
    expect(source.session?.projectId).toBe(source.id)
    expect(JSON.parse(await readFile(join(dir, 'projects', source.id, 'project.json'), 'utf8')).session).toBeUndefined()
  })
  it('creates independent clean sessions while another session has an active agent', async () => {
    const running = registry.start({ projectId: source.id, projectName: source.name, step: 'Build' }, 'codex', 'local')
    try {
      const blocked = await request('POST', source.id, '/snapshots', { name: 'Busy snapshot' })
      expect(blocked.status).toBe(409)
      const sessions = await Promise.all(['Next change', 'Parallel preparation'].map((name) => request('POST', source.id, '/sessions', { name })))
      expect(sessions.map((s) => s.status)).toEqual([200, 200])
      other = sessions[0]!.body
      expect(other.id).not.toBe(source.id)
      expect(other.session?.projectId).toBe(source.id)
      expect(other).toMatchObject({ description: '', stories: [], screens: [], prompts: {}, annotations: [] })
      expect(other.buildPlan).toBeUndefined(); expect(other.testReport).toBeUndefined()
      await request('PUT', other.id, '/file', { path: 'app.ts', content: 'separate workspace' })
      expect((await request('GET', source.id, '/file?path=app.ts')).body.content).toBe('export const value = 1')
      expect((await request('GET', other.id, '/chat')).body).toEqual([])
    } finally { registry.finish(running, 'done') }
  })
  it('validates and persists workflows while keeping parallel sessions independent', async () => {
    const workflow = workflowPreset('developer', workflowOf(source))
    workflow.steps[0]!.prompt = 'Implement a calendar'
    workflow.steps.splice(1, 0, { id: 'custom-review', kind: 'prompt', label: 'Accessibility', prompt: '' })
    source = (await request('PUT', source.id, '', { ...source, workflow })).body
    expect((await request('GET', source.id)).body.workflow).toEqual(workflow)
    expect((await request('GET', other.id)).body.workflow.preset).toBe('enterprise')
    expect((await request('PUT', source.id, '', { ...source, workflow: { ...workflow, steps: [] } })).status).toBe(400)
    expect((await request('GET', source.id)).body.workflow).toEqual(workflow)
  })
  it('captures prompts, stories, code, chat, design images, test results, videos and logs', async () => {
    const res = await request('POST', source.id, '/snapshots', { name: 'Before changes' })
    expect(res.status).toBe(200)
    snapshot = res.body
    expect(snapshot.session?.snapshot).toMatchObject({ sessionId: source.id, name: 'Before changes' })
    expect(snapshot.prompts).toEqual(source.prompts)
    expect(snapshot.workflow).toEqual(source.workflow)
    expect(snapshot.stories).toEqual(source.stories)
    expect(snapshot.architecture).toEqual(source.architecture)
    expect(snapshot.buildPlan).toEqual(source.buildPlan)
    expect(snapshot.testReport).toEqual(source.testReport)
    expect((await request('GET', snapshot.id, '/chat')).body[0].text).toBe('Uložená konverzace')
    expect((await request('GET', snapshot.id, '/session-record')).body.events.some((e: { text: string }) => e.text === 'Build completed')).toBe(true)
    expect((await app.inject(`/api/projects/${snapshot.id}/figma/design.png`)).body).toBe('design bytes')
    expect((await app.inject(`/api/projects/${snapshot.id}/raw?path=.aforge/test-output/result.png`)).body).toBe('screenshot bytes')
    expect((await app.inject(`/api/projects/${snapshot.id}/walkthroughs/wt-test.webm`)).body).toBe('video bytes')
    await request('PUT', source.id, '/file', { path: 'app.ts', content: 'export const value = 2' })
    await request('PUT', source.id, '', { ...source, description: 'Changed brief', prompts: {}, workflow: workflowPreset('vibe', workflowOf(source)) })
    expect((await request('GET', snapshot.id, '/file?path=app.ts')).body.content).toBe('export const value = 1')
    expect((await request('GET', snapshot.id)).body.description).toBe('Původní zadání')
    expect((await request('GET', snapshot.id)).body.workflow).toEqual(snapshot.workflow)
  })
  it('rejects all mutations and execution routes for snapshots, even with forged metadata', async () => {
    const routes: ['POST' | 'PUT' | 'DELETE', string, unknown][] = [
      ['PUT', '', { ...snapshot, session: undefined }], ['PUT', '/file', { path: 'app.ts', content: 'forged' }],
      ['POST', '/commit', {}], ['POST', '/build', {}], ['POST', '/build/stop', {}], ['POST', '/chat', { text: 'hello', focus: { stage: 'stories' } }], ['DELETE', '/chat', {}],
      ['POST', '/preview/start', {}], ['POST', '/preview/stop', {}], ['POST', '/tests', {}], ['POST', '/generate/stories', {}],
      ['POST', '/pipeline', {}], ['POST', '/pipeline/cancel', {}], ['POST', '/figma', {}], ['POST', '/walkthroughs', {}],
    ]
    for (const [method, path, body] of routes) expect((await request(method, snapshot.id, path, body)).status, path || 'model').toBe(403)
  })
  it('rejects concurrent writes while a source session is reserved for snapshot or archive', async () => {
    const { exclusiveSession, enterMutation } = await import('./session-gate.js')
    const release = enterMutation(source.id)
    try { expect((await request('POST', source.id, '/snapshots', {})).status).toBe(409) } finally { release() }
    let unlock!: () => void
    const reserved = exclusiveSession(source.id, () => new Promise<void>((done) => { unlock = done }))
    try { expect((await request('PUT', source.id, '/file', { path: 'app.ts', content: 'racing' })).status).toBe(409) } finally { unlock(); await reserved }
  })
  it('does not create a partial or mutable snapshot through symbolic links', async () => {
    const link = join(dir, 'projects', source.id, 'workspace/linked.ts')
    await symlink('app.ts', link)
    const before = (await request('GET', source.id, '/sessions')).body.snapshots.length
    try { expect((await request('POST', source.id, '/snapshots', {})).status).toBe(400) } finally { await rm(link) }
    expect((await request('GET', source.id, '/sessions')).body.snapshots).toHaveLength(before)
    expect((await readdir(join(dir, 'projects', source.id, 'snapshots'))).some((name) => name.endsWith('.tmp'))).toBe(false)
  })
  it('archives a session permanently in the UI/API while another remains editable, and can start fresh work', async () => {
    expect((await request('POST', source.id, '/archive', {})).status).toBe(200)
    expect((await request('PUT', source.id, '', source)).status).toBe(403)
    expect((await request('POST', source.id, '/preview/start', {})).status).toBe(403)
    expect((await request('GET', source.id)).body.session.archivedAt).toBeTruthy()
    expect((await request('PUT', other.id, '/file', { path: 'app.ts', content: 'still editable' })).status).toBe(200)
    const next = await request('POST', source.id, '/sessions', { name: 'After archive' })
    expect(next.status).toBe(200); expect(next.body.description).toBe('')
    expect((await request('GET', source.id, '/sessions')).body.sessions).toHaveLength(4)
  })
})
