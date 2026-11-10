import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AppUser, Project, ProjectAttachment, Story } from '@aforge/shared'

let app: FastifyInstance
let dir: string
let p: Project
const story: Story = { id: 'PM-2', epicId: 'PM-1', title: 'Přehled', asA: 'uživatel', iWant: 'přehled', soThat: 'vím', acceptance: [], screenIds: [], status: 'draft', priority: 'must' }
const request = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => app.inject({ method, url: `/api/projects/${p.id}${path}`, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const get = async () => (await request('GET', '')).json<Project>()
const user = (id: string): AppUser => ({ id, username: id, name: id, admin: false, lastLoginAt: '' })
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reactor-planning-content-'))
  vi.stubEnv('AFORGE_DATA', dir); vi.stubEnv('AFORGE_AUTH', 'off'); vi.stubEnv('PORT', '0'); vi.stubEnv('AFORGE_RELAY', undefined)
  app = (await import('./index.js')).app
  p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Planning content test' } })).json<Project>()
  p = (await request('PUT', '', { ...p, key: 'PM', stories: [story], epics: [{ id: 'PM-1', title: 'Epic', description: 'Původní epic', screenIds: [] }] })).json<Project>()
}, 15000)
afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); if (dir) await rm(dir, { recursive: true, force: true }) })

describe('planning, content and attachments API', () => {
  it('stores management data with optimistic versions, per-user reads, and no model state changes', async () => {
    const before = await get()
    const body = { expectedVersion: 0, estimateMinutes: 150, entries: [{ id: 'alert', text: 'MANAGEMENT_SENTINEL_PRIVATE', level: 'constraint', remindAt: '2020-01-01T08:00:00Z', deadlineAt: '2099-01-01T00:00:00Z' }] }
    const saved = await request('POST', '/items/story/PM-2/planning', body)
    expect(saved.statusCode).toBe(200)
    expect(saved.json<Project>().stories).toEqual(before.stories)
    expect((await request('POST', '/items/story/PM-2/planning', body)).statusCode).toBe(409)
    const inbox = (await app.inject({ method: 'GET', url: '/api/planning/notifications' })).json()
    expect(inbox.notices[0]).toMatchObject({ itemId: 'PM-2', read: false, overdue: false })
    expect((await request('POST', '/planning/read', { kind: 'story', itemId: 'PM-2', entryId: 'alert', dueAt: inbox.notices[0].dueAt })).statusCode).toBe(200)
    const { planningInbox } = await import('./planning.js')
    expect((await planningInbox({ ...user('local'), admin: true })).notices[0]!.read).toBe(true)
    expect((await planningInbox({ ...user('bob'), admin: true })).notices[0]!.read).toBe(false)
    const fresh = await get()
    const forged = await request('PUT', '', { ...fresh, planning: {} })
    expect(forged.json<Project>().planning!['story:PM-2']!.estimateMinutes).toBe(150)
  })
  it('records authored description versions, rejects concurrent overwrites, and restores by appending', async () => {
    expect((await request('POST', '/items/story/PM-2/description', { expectedVersion: 0, text: '# Detail\n\n**Důležité** <u>zadání</u>' })).statusCode).toBe(200)
    const first = await get()
    const history = first.descriptionHistory!['story:PM-2']!
    expect(history.map((r) => r.text)).toEqual(['', '# Detail\n\n**Důležité** <u>zadání</u>'])
    expect(history[1]!.author).toBe('Lokální uživatel')
    expect((await request('POST', '/items/story/PM-2/description', { expectedVersion: 0, text: 'stale' })).statusCode).toBe(409)
    expect((await request('POST', '/items/story/PM-2/description', { expectedVersion: 2, text: '' })).statusCode).toBe(200)
    expect((await get()).descriptionHistory!['story:PM-2']).toHaveLength(3)
    const current = await get()
    const autosave = await request('PUT', '', { ...current, stories: [{ ...story, description: 'forged' }], descriptionHistory: {}, attachments: [] })
    expect(autosave.json<Project>().stories[0]!.description).toBe('')
    expect(autosave.json<Project>().descriptionHistory!['story:PM-2']).toHaveLength(3)
  })
  it('uploads and downloads immutable images/files, stages them into every repo, and snapshots retain bytes', async () => {
    const boundary = 'fixture-boundary'
    const bytes = Buffer.from('Příloha zadání pro další fáze.')
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="zadani.txt"\r\nContent-Type: text/plain\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)])
    const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/items/story/PM-2/attachments`, payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } })
    expect(res.statusCode).toBe(200)
    const a = res.json<ProjectAttachment>()
    expect(a).toMatchObject({ name: 'zadani.txt', mime: 'text/plain', itemId: 'PM-2' })
    const downloaded = await request('GET', `/attachments/${a.id}`)
    expect(downloaded.body).toBe(bytes.toString())
    expect(downloaded.headers['content-disposition']).toContain('attachment;')
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff')
    const current = await get()
    const { stageAttachments } = await import('./attachments.js')
    await stageAttachments(current)
    await mkdir(join(dir, 'projects', p.id, 'repos/backend'), { recursive: true })
    await stageAttachments(current, 'backend')
    expect(await readFile(join(dir, 'projects', p.id, 'repos/backend/.aforge/attachments', a.storageName))).toEqual(bytes)
    const saved = await request('POST', '/items/story/PM-2/description', { expectedVersion: 3, text: `[Podklad](attachment:${a.id})` })
    expect(saved.statusCode).toBe(200)
    const snapshot = (await request('POST', '/snapshots', { name: 'Přílohy a management' })).json<Project>()
    const file = await app.inject({ method: 'GET', url: `/api/projects/${snapshot.id}/attachments/${a.id}` })
    expect(file.statusCode).toBe(200); expect(file.body).toBe(bytes.toString())
    const blocked = await app.inject({ method: 'POST', url: `/api/projects/${snapshot.id}/items/story/PM-2/description`, payload: { expectedVersion: 4, text: 'No' } })
    expect(blocked.statusCode).toBe(403)
    expect(snapshot.planning!['story:PM-2']!.estimateMinutes).toBe(150)
  })
  it('passes descriptions and attachment text to agents while excluding all human planning fields', async () => {
    const current = await get()
    const { buildContext } = await import('./context.js')
    const { renderSpec, renderTask } = await import('./build.js')
    const context = await buildContext(current, { stage: 'stories' }, [])
    expect(context).toContain('Příloha zadání pro další fáze.')
    expect(context).not.toContain('MANAGEMENT_SENTINEL_PRIVATE')
    const spec = renderSpec(current, 'incremental')
    expect(spec).toContain('Původní epic')
    expect(spec).toContain('.aforge/attachments/')
    expect(spec).not.toContain('attachment:')
    expect(spec).not.toContain('MANAGEMENT_SENTINEL_PRIVATE')
    const task = renderTask(current, { id: 'PM-3', storyId: 'PM-2', title: 'Task', description: '', layer: 'fe', repoId: 'main', type: 'task', status: 'todo', source: 'manual', files: [], createdAt: '', updatedAt: '' })
    expect(task).toContain('.aforge/attachments/')
    expect(task).not.toContain('MANAGEMENT_SENTINEL_PRIVATE')
    const { testScriptsPrompt, walkthroughPrompt } = await import('./walkthrough-lib.js')
    const test = { id: 'test', storyIds: ['PM-2'], title: 'Scénář', route: '/', section: 'main', instructions: '', script: 'e2e/walkthroughs/test.spec.ts', status: 'draft' as const, createdAt: '', updatedAt: '' }
    for (const prompt of [testScriptsPrompt([test], current), walkthroughPrompt(test, current)]) {
      expect(prompt).toContain('.aforge/attachments/')
      expect(prompt).not.toContain('MANAGEMENT_SENTINEL_PRIVATE')
    }
    const { planningInbox } = await import('./planning.js')
    const { setMember } = await import('./auth.js')
    await setMember(p.id, 'ann', 'owner')
    expect((await planningInbox(user('outsider'))).notices).toEqual([])
    expect((await planningInbox(user('ann'))).notices).toHaveLength(1)
  })
  it('keeps management data through stale direct job saves and preserves read receipts on unchanged content', async () => {
    const { saveProject } = await import('./store.js')
    const { savePlanning } = await import('./planning.js')
    const before = await get()
    const plan = before.planning!['story:PM-2']!
    await savePlanning(p.id, 'story', 'PM-2', { expectedVersion: plan.version, estimateMinutes: 180, entries: plan.entries }, 'local')
    await saveProject({ ...before, name: before.name })
    const fresh = await get()
    expect(fresh.planning!['story:PM-2']!.estimateMinutes).toBe(180)
    expect(fresh.planning!['story:PM-2']!.entries[0]!.readBy?.local).toBeTruthy()
    const current = fresh.planning!['story:PM-2']!
    await savePlanning(p.id, 'story', 'PM-2', { expectedVersion: current.version, estimateMinutes: 180, entries: current.entries.map((e) => ({ ...e, text: 'Nové upozornění' })) }, 'local')
    expect((await get()).planning!['story:PM-2']!.entries[0]!.readBy).toBeUndefined()
  })
  it('rejects oversized and multiple-file requests before storing any attachment; active HTML is download-only', async () => {
    const count = (await get()).attachments!.length
    const boundary = 'limits-boundary'
    const part = (name: string, body: Buffer) => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/html\r\n\r\n`), body, Buffer.from('\r\n')])
    const upload = (parts: Buffer[]) => app.inject({ method: 'POST', url: `/api/projects/${p.id}/items/story/PM-2/attachments`, payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } })
    expect((await upload([part('a.txt', Buffer.from('a')), part('b.txt', Buffer.from('b'))])).statusCode).toBeGreaterThanOrEqual(400)
    expect((await get()).attachments).toHaveLength(count)
    expect((await upload([part('large.bin', Buffer.alloc(20 * 1024 * 1024 + 1))])).statusCode).toBe(413)
    expect((await get()).attachments).toHaveLength(count)
    const html = await upload([part('../../unsafe.html', Buffer.from('<script>alert(1)</script>'))])
    expect(html.statusCode).toBe(200)
    const a = html.json<ProjectAttachment>()
    expect(a.name).toBe('unsafe.html')
    const download = await request('GET', `/attachments/${a.id}`)
    expect(download.headers['content-disposition']).toContain('attachment;')
    expect(download.headers['content-security-policy']).toContain('sandbox')
  })
})
