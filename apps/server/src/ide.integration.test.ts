import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { workflowPreset, workflowOf, type Backlog, type ChatMessage, type IdePlan, type Project } from '@aforge/shared'

vi.mock('./agents.js', async (original) => ({ ...await original<typeof import('./agents.js')>(), structured: vi.fn() }))
vi.mock('./tasks.js', async (original) => ({ ...await original<typeof import('./tasks.js')>(), startIssues: vi.fn(async () => {}) }))
let app: FastifyInstance
let dir: string
let project: Project
const request = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) => app.inject({ method, url: `/api/projects/${project.id}${path}`, ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }) })
const get = async () => (await request('GET', '')).json<Project>()
const draft = { title: 'Slevové kódy', asA: 'zákazník', iWant: 'zadat slevový kód', soThat: 'zaplatím méně', acceptance: ['Given platný kód When ho zadám Then cena klesne'], priority: 'must' as const }
const backlog = (b: Partial<Backlog>): Backlog => ({ decision: 'new', storyId: '', candidates: [], addCriteria: [], epicId: '', epic: { title: '', description: '' }, story: draft, ...b })
const plan = (b: Partial<Backlog>, tasks: IdePlan['tasks'] = [{ repoId: 'main', layer: 'fe', title: 'Pole pro kód', description: 'Přidat pole' }]): IdePlan => ({ reply: 'Rozděluji na běhy.', backlog: backlog(b), tasks, contract: '' })
const run = async (p: IdePlan, text = 'Přidej slevové kódy') => {
  const { structured } = await import('./agents.js')
  vi.mocked(structured).mockResolvedValueOnce(p)
  const res = await request('POST', '/ide/run', { text })
  expect(res.statusCode, res.body).toBe(200)
  return res.json<{ messages: ChatMessage[]; issueIds: string[] }>()
}
const setIde = async (ide: Partial<NonNullable<Project['ide']>>) => {
  const p = await get()
  expect((await request('PUT', '', { ...p, ide: { record: 'auto', wiki: 'auto', voice: false, ...ide } })).statusCode).toBe(200)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reactor-ide-'))
  vi.stubEnv('AFORGE_DATA', dir); vi.stubEnv('AFORGE_AUTH', 'off'); vi.stubEnv('PORT', '0'); vi.stubEnv('AFORGE_RELAY', undefined)
  app = (await import('./index.js')).app
  project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'IDE test' } })).json<Project>()
  project = (await request('PUT', '', { ...project, key: 'ID', workflow: workflowPreset('ide', workflowOf(project)) })).json<Project>()
}, 15000)
afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); if (dir) await rm(dir, { recursive: true, force: true }) })
beforeEach(() => vi.clearAllMocks())

describe('agentic IDE', () => {
  it('plans tasks per repository and writes the backlog as revertible records', async () => {
    const { startIssues } = await import('./tasks.js')
    const out = await run(plan({ epicId: 'new', epic: { title: 'Košík', description: 'Nákup' } }, [
      { repoId: 'main', layer: 'fe', title: 'Pole pro kód', description: 'Přidat pole' },
      { repoId: 'neexistuje', layer: 'be', title: 'Validace', description: 'Endpoint' },
      { repoId: 'main', layer: 'api', title: 'Kontrakt', description: 'nikdy jako task' },
    ]))
    const p = await get()
    expect(p.epics?.map((e) => e.id)).toEqual(['ID-1'])
    expect(p.stories).toMatchObject([{ id: 'ID-2', epicId: 'ID-1', status: 'ready', acceptance: draft.acceptance }])
    expect(out.issueIds).toEqual(['ID-3', 'ID-4'])
    expect(p.issues).toMatchObject([{ id: 'ID-3', storyId: 'ID-2', source: 'ide', status: 'todo', repoId: 'main' }, { id: 'ID-4', repoId: 'main', layer: 'be' }])
    expect(p.issues?.every((i) => i.promptId === p.trace![0]!.promptId)).toBe(true)
    expect(p.trace?.map((e) => e.kind)).toEqual(['prompt', 'epic', 'story', 'task', 'task'])
    expect(p.trace?.[0]).toMatchObject({ title: 'Přidej slevové kódy', detail: 'Nové téma → nová story v epicu Košík', auto: true })
    expect(p.ide?.topic).toBe('ID-2')
    expect(vi.mocked(startIssues)).toHaveBeenCalledWith(project.id, ['ID-3', 'ID-4'])
    expect(out.messages.map((m) => [m.role, m.stage])).toEqual([['user', 'ide'], ['agent', 'ide']])
    expect(out.messages[1]!.issueIds).toEqual(['ID-3', 'ID-4'])
  })

  it('extends the topic story, and reverting restores it; a client cannot forge the trace or the topic', async () => {
    await run(plan({ decision: 'existing', storyId: 'ID-2', addCriteria: ['Given kód When je použitý Then nejde znovu', draft.acceptance[0]!] }, []), 'Kód jen jednou')
    let p = await get()
    expect(p.stories[0]!.acceptance).toHaveLength(2)
    const criterion = p.trace!.find((e) => e.kind === 'criterion')!
    expect(criterion.detail).toMatch(/^\+1 kritérium/)
    expect((await request('PUT', '', { ...p, trace: [], ide: { record: 'auto', wiki: 'auto', voice: true, topic: 'ID-999' } })).statusCode).toBe(200)
    p = await get()
    expect(p.trace?.length).toBeGreaterThan(0)
    expect(p.ide).toMatchObject({ voice: true, topic: 'ID-2' })
    expect((await request('POST', `/ide/trace/${criterion.id}/revert`)).statusCode).toBe(200)
    p = await get()
    expect(p.stories[0]!.acceptance).toEqual(draft.acceptance)
    expect((await request('POST', `/ide/trace/${criterion.id}/revert`)).statusCode).toBe(400)
  })

  it('reverting a created story unlinks its work and keeps the key reserved', async () => {
    const story = (await get()).trace!.find((e) => e.kind === 'story')!
    expect((await request('POST', `/ide/trace/${story.id}/revert`)).statusCode).toBe(200)
    const p = await get()
    expect(p.stories.map((s) => s.id)).not.toContain('ID-2')
    expect(p.issues?.find((i) => i.id === 'ID-3')?.storyId).toBeUndefined()
    expect(p.deletedKeys).toContain('ID-2')
    expect(p.ide?.topic).toBeUndefined()
  })

  it('in review mode proposes the story in the thread and links the work once it is accepted', async () => {
    await setIde({ record: 'review' })
    const out = await run(plan({}), 'Věrnostní body')
    let p = await get()
    const before = p.stories.length
    const task = p.issues!.find((i) => i.id === out.issueIds[0])!
    expect(task.storyId).toBeUndefined()
    const proposal = out.messages[1]!.proposals[0]!
    const storyOp = proposal.ops.find((o) => o.type === 'story.upsert')
    expect(storyOp?.type === 'story.upsert' && storyOp.story.id).not.toBe(task.id)
    expect(p.trace!.at(-2)).toMatchObject({ kind: 'proposal', auto: false })
    expect((await request('POST', `/chat/${out.messages[1]!.id}/proposals/${proposal.id}/accept`)).statusCode).toBe(200)
    p = await get()
    expect(p.stories).toHaveLength(before + 1)
    expect(p.issues!.find((i) => i.id === task.id)?.storyId).toBe(storyOp?.type === 'story.upsert' ? storyOp.story.id : '')
    await setIde({ record: 'auto' })
  })

  it('never guesses: an unsure prompt waits unsorted until the user sorts it', async () => {
    const story = (await get()).stories[0]!.id
    const out = await run(plan({ decision: 'unsure', candidates: [story, 'ID-404'] }), 'Zrychli načítání')
    let p = await get()
    const unsorted = p.trace!.find((e) => e.kind === 'unsorted' && !e.resolved)!
    expect(unsorted).toMatchObject({ auto: false, candidates: [story] })
    expect((await request('POST', `/ide/trace/${unsorted.id}/assign`, { target: 'ID-404' })).statusCode).toBe(400)
    expect((await request('POST', `/ide/trace/${unsorted.id}/assign`, { target: 'new' })).statusCode).toBe(200)
    p = await get()
    const created = p.stories.at(-1)!
    expect(created.title).toBe(draft.title)
    expect(p.issues!.find((i) => i.id === out.issueIds[0])?.storyId).toBe(created.id)
    expect(p.trace!.find((e) => e.id === unsorted.id)).toMatchObject({ resolved: true, ref: created.id })
    expect((await request('POST', `/ide/trace/${unsorted.id}/assign`, { target: 'ignore' })).statusCode).toBe(400)
  })

  it('the Documenter writes the wiki with a version that can be reverted', async () => {
    const { structured } = await import('./agents.js')
    vi.mocked(structured).mockResolvedValueOnce({ pages: [{ id: 'about', title: 'O aplikaci', body: 'Eshop', changes: ['Nová stránka'], sources: [] }] })
    const { writeWiki } = await import('./ide.js')
    await writeWiki(project.id)
    let p = await get()
    expect(p.wiki).toMatchObject([{ id: 'about', body: 'Eshop' }])
    const e = p.trace!.find((x) => x.kind === 'wiki')!
    expect(e).toMatchObject({ auto: true, ref: 'about' })
    expect((await request('POST', `/ide/trace/${e.id}/revert`)).statusCode).toBe(200)
    p = await get()
    expect(p.wiki).toEqual([])
  })

  it('in wiki review mode leaves the draft for the Wiki step', async () => {
    await setIde({ wiki: 'review' })
    const { structured } = await import('./agents.js')
    vi.mocked(structured).mockResolvedValueOnce({ pages: [{ id: 'about', title: 'O aplikaci', body: 'Eshop', changes: ['Nová stránka'], sources: [] }] })
    const { writeWiki } = await import('./ide.js')
    await writeWiki(project.id)
    const p = await get()
    expect(p.wiki?.[0]).toMatchObject({ body: '', draft: { body: 'Eshop' } })
    expect(p.trace!.at(-1)).toMatchObject({ kind: 'wiki', auto: false })
    expect(p.trace!.at(-1)?.revert).toBeUndefined()
  })
})
