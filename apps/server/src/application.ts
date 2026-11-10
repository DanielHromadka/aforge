import Fastify from 'fastify'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { decideStoryReview, reposOf, type Project, type ReviewGroupInput } from '@aforge/shared'
import { detectProviders } from './agents.js'
import { claimProject, registerAuth, roleOf, userOf } from './auth.js'
import { askConsultant, decideProposal } from './chat.js'
import { hub } from './hub.js'
import { agentRuns, saveMetrics } from './agent-runs.js'
import { assertWritable, locationOf } from './project-locations.js'
import { enterMutation } from './session-gate.js'
import { archiveSession, createSession, createSnapshot, sessionHistory, sessionRecord } from './sessions.js'
import { recordEvent } from './session-journal.js'
import { cancelPipeline, loadPipeline, startPipeline } from './pipeline.js'
import { hasApp, isBuilding, renderSpec, startBuild, stopBuild } from './build.js'
import { INTENTS, type Focus } from './context.js'
import { publish, subscribe } from './events.js'
import { syncFigma } from './figma.js'
import { fetchJira, jiraBase, mergeJira } from './jira.js'
import { generate, GENERATE_STEPS, generationStep, isGenerating, type GenerateStep } from './generate.js'
import { previewStatus, startPreview, stopPreview } from './preview.js'
import { createProject, listProjects, loadChat, loadProject, mergeIssues, mutateProject, projectDir, saveChat, saveProject } from './store.js'
import { runTests, testsRunning } from './tests.js'
import { createWalkthrough, generateStoryTests, generateWalkthrough, isPlanningTests, recordWalkthrough, recoverWalkthroughs, runTestItems, testWalkthrough, videoDir } from './walkthrough.js'
import { isVideoFile, parseRange } from './walkthrough-lib.js'
import { commit, commitDetails, diffOf, ensureRepo, fileDiff, fileTree, graphLog, history, issueCommits, rangeDiff, readText, safePath, workStatus, writeText } from './workspace.js'
import { acceptIssue, approveBreakdown, recoverIssues, rejectBreakdown, returnIssue, startIssue, startStory, writeContract } from './tasks.js'
import { repoDir } from './project-locations.js'
import { deleteProjectItem, editProjectItem, ItemKindSchema } from './items.js'
import { assignEvent, revertEvent, runIde, runInline } from './ide.js'
import { planningInbox, readPlanningEntry, resolvePlanningEntry, savePlanning } from './planning.js'
import { z } from 'zod'
import multipart from '@fastify/multipart'
import { production, validateProduction, limits } from './config.js'
import { registerOperations, assertDiskCapacity, operational } from './operations.js'
import { mediaUrl } from './media.js'
import { startPreviewGateway, issuePreviewAccess } from './preview-access.js'
import { previewPort, stopAllPreviews } from './preview.js'
import { shutdownProcesses } from '@aforge/runner'
import { ATTACHMENT_LIMIT, attachmentPath, uploadAttachment } from './attachments.js'
import { DescriptionKindSchema, saveDescription } from './descriptions.js'

validateProduction()
export const app = Fastify({ logger: { level: production ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0], remoteAddress: req.ip }) } }, trustProxy: ['127.0.0.1', '::1'], requestTimeout: 60_000, bodyLimit: 20 * 1024 * 1024 })
await registerOperations(app)
await app.register(multipart, { limits: { fileSize: ATTACHMENT_LIMIT, files: 1, fields: 0, parts: 1 }, throwFileSizeLimit: true })

app.setErrorHandler((err, req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? 400
  if (status >= 500) req.log.error({ err }, 'Request failed')
  reply.status(status).send({ error: production && status >= 500 ? 'Operace selhala. Zkuste to později.' : err instanceof Error ? err.message : String(err), requestId: req.id })
})

// Sign-in and project roles run before everything else that touches a project.
registerAuth(app)

// Mutating routes reserve the exact execution id, not the whole parent project.
const mutations = new WeakMap<object, () => void>()
const lifecycle = new Set(['/api/projects/:id/sessions', '/api/projects/:id/snapshots', '/api/projects/:id/archive'])
app.addHook('preHandler', async (req) => {
  const id = (req.params as { id?: string }).id
  if (!id || req.method === 'GET' || req.method === 'HEAD' || lifecycle.has(req.routeOptions.url ?? '')) return
  assertWritable(id)
  await assertDiskCapacity(locationOf(id).root)
  mutations.set(req, enterMutation(id))
})
app.addHook('onResponse', async (req, reply) => {
  mutations.get(req)?.()
  const id = (req.params as { id?: string }).id
  if (id && req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400) {
    const route = req.routeOptions.url?.replace('/api/projects/:id', '') ?? ''
    const labels: Record<string, string> = {
      'PUT ': 'Uloženy podklady a texty session', 'POST /build': 'Spuštěn build',
      'POST /build/stop': 'Zastaven build', 'POST /preview/start': 'Spuštěn nebo restartován náhled',
      'POST /preview/stop': 'Zastaven náhled', 'POST /tests': 'Spuštěny testy',
      'POST /commit': 'Vytvořen commit kódu', 'POST /figma': 'Synchronizován design z Figmy', 'POST /jira': 'Importovány epics a stories z Jiry',
      'POST /chat': 'Uložena konzultace s agentem', 'DELETE /chat': 'Vymazána konverzace',
      'POST /sessions': 'Založena nová pracovní session', 'POST /snapshots': 'Uložen snapshot',
      'POST /pipeline': 'Spuštěna pipeline', 'POST /pipeline/cancel': 'Požadováno ukončení pipeline',
      'POST /issues/:iid/run': 'Spuštěn task', 'POST /issues/:iid/accept': 'Přijat výsledek tasku', 'POST /issues/:iid/return': 'Task vrácen k přepracování',
      'POST /stories/:sid/implement': 'Spuštěna implementace story', 'POST /stories/:sid/breakdown/approve': 'Schválen rozpad story',
      'POST /contract/approve': 'Schválen API kontrakt', 'POST /tests/generate': 'Spuštěno psaní testů ke stories', 'POST /tests/run': 'Spuštěny vybrané testy', 'POST /wiki/:page/decide': 'Rozhodnuto o změně wiki',
      'POST /ide/run': 'Zadán požadavek v IDE', 'POST /ide/inline': 'Spuštěna úprava kódu z editoru', 'POST /ide/trace/:eid/revert': 'Vrácen záznam Zapisovatele', 'POST /ide/trace/:eid/assign': 'Zařazen požadavek z IDE',
    }
    const path = (req.body as { path?: unknown } | null)?.path
    const text = route === '/file' && typeof path === 'string' ? `Upraven soubor: ${path.slice(0, 200)}` : labels[`${req.method} ${route}`] ?? 'Dokončena akce v session'
    recordEvent(id, { channel: 'session', kind: 'action', text, at: new Date().toISOString() })
  }
})
app.addHook('onError', async (req) => { mutations.get(req)?.() })

type P = { Params: { id: string } }

app.get<P>('/api/projects/:id/sessions', (req) => sessionHistory(req.params.id))
app.get<P>('/api/projects/:id/session-record', (req) => sessionRecord(req.params.id))
app.post<P & { Body: { name?: string } }>('/api/projects/:id/sessions', (req) => createSession(req.params.id, req.body?.name))
app.post<P & { Body: { name?: string } }>('/api/projects/:id/snapshots', (req) => createSnapshot(req.params.id, req.body?.name))
app.post<P>('/api/projects/:id/archive', (req) => archiveSession(req.params.id))

app.get('/api/providers', () => detectProviders())

app.get('/api/projects', async (req) => (await listProjects()).flatMap((p) => {
  const role = roleOf(req.user!, p.id)
  const agents = agentRuns.totalsOf(p.id)
  return role ? [{ ...p, role, ...(p.stats ? { stats: { ...p.stats, agentRuns: agents.runs, costUsd: agents.costUsd } } : {}) }] : []
}))

app.post<{ Body: { name: string; description?: string } }>('/api/projects', async (req) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) throw new Error('Zadejte název projektu')
  await assertDiskCapacity()
  if ((await listProjects()).length >= limits.projects) throw Object.assign(new Error('Byl dosažen limit projektů.'), { statusCode: 429 })
  const project = await createProject(name, String(req.body.description ?? ''))
  await ensureRepo(project.id)
  await claimProject(project.id, req.user!)
  return { ...project, role: 'owner' }
})

app.get<P>('/api/projects/:id', async (req) => ({ ...(await loadProject(req.params.id)), role: roleOf(req.user!, req.params.id) }))

/** The client sends the whole model; the server owns ids and timestamps only. */
app.put<P & { Body: Project }>('/api/projects/:id', (req) =>
  // Walkthroughs, the contract and the wiki are changed by server jobs only, and agents change tasks while the
  // user edits: a stale client copy must not undo any of that.
  mutateProject(req.params.id, (current) => {
    if ((req.body.storyRevision ?? 0) !== (current.storyRevision ?? 0)) throw Object.assign(new Error('Backlog byl reorganizován v jiném okně. Obnovte stránku před další úpravou.'), { statusCode: 409 })
    return {
    ...req.body, id: current.id, createdAt: current.createdAt, session: current.session, walkthroughs: current.walkthroughs,
    storyReviews: current.storyReviews, storyArchive: current.storyArchive, storyRevision: current.storyRevision, deletedKeys: current.deletedKeys, planning: current.planning,
    attachments: current.attachments, descriptionHistory: current.descriptionHistory, jira: current.jira,
    epics: req.body.epics?.map((e) => { const old = current.epics?.find((old) => old.id === e.id); return old ? { ...e, description: old.description } : e }),
    stories: req.body.stories.map((s) => { const old = current.stories.find((old) => old.id === s.id); return old ? { ...s, description: old.description } : s }),
    contract: current.contract, wiki: current.wiki, trace: current.trace, issues: mergeIssues(current.issues, req.body.issues),
    // The topic is the Scribe's; the client only changes the switches.
    ide: req.body.ide ? { record: req.body.ide.record === 'review' ? 'review' : 'auto', wiki: req.body.ide.wiki === 'review' ? 'review' : 'auto', voice: req.body.ide.voice === true, topic: current.ide?.topic } : current.ide,
  }}))

// ---- live events (SSE) ---------------------------------------------------------------------

const eventStreams = new Map<string, number>()
app.get<P>('/api/projects/:id/events', (req, reply) => {
  const key = req.user!.id
  if ((eventStreams.get(key) ?? 0) >= 10 || [...eventStreams.values()].reduce((a, b) => a + b, 0) >= 200) return reply.code(429).send({ error: 'Příliš mnoho otevřených spojení.' })
  eventStreams.set(key, (eventStreams.get(key) ?? 0) + 1)
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  reply.raw.write(': connected\n\n')
  const off = subscribe(req.params.id, (e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`))
  const opened = Date.now()
  const ping = setInterval(() => {
    const user = userOf(req)
    if (!user || !roleOf(user, req.params.id) || Date.now() - opened > 15 * 60_000) { reply.raw.end(); return }
    reply.raw.write(': ping\n\n')
  }, 20_000)
  req.raw.on('close', () => {
    clearInterval(ping)
    const left = (eventStreams.get(key) ?? 1) - 1; if (left) eventStreams.set(key, left); else eventStreams.delete(key)
    off()
  })
  return reply
})

// ---- agent ---------------------------------------------------------------------------------

app.get<P>('/api/projects/:id/chat', (req) => loadChat(req.params.id))

app.post<P & { Body: { text?: string; intent?: string; focus: Focus } }>('/api/projects/:id/chat', async (req) => {
  const intentText = req.body.intent ? INTENTS[req.body.intent] : undefined
  if (req.body.intent && !intentText) throw new Error('Neznámý požadavek')
  const text = String(req.body.text ?? '').trim() || intentText
  if (!text) throw new Error('Prázdná zpráva')
  return askConsultant(req.params.id, text, { ...req.body.focus, stage: req.body.focus?.stage ?? 'stories' })
})

app.post<{ Params: { id: string; msg: string; pid: string; action: string } }>('/api/projects/:id/chat/:msg/proposals/:pid/:action', (req) => {
  const { id, msg, pid, action } = req.params
  if (action !== 'accept' && action !== 'reject') throw new Error('Neznámá akce')
  return decideProposal(id, msg, pid, action === 'accept')
})

app.delete<P>('/api/projects/:id/chat', async (req) => {
  await saveChat(req.params.id, [])
  return []
})

// ---- workspace -----------------------------------------------------------------------------

// Every code route takes ?repo=<id>; without it, the main repository (the workspace).
type R = { Querystring: { repo?: string } }
const repoOf = async (id: string, repo?: string) => {
  if (!repo || repo === 'main') return undefined
  if (!reposOf(await loadProject(id)).some((r) => r.id === repo)) throw new Error('Repozitář nenalezen')
  return repo
}
/** A repository other than the workspace is created on first use. */
const openRepo = async (id: string, repo?: string) => {
  const r = await repoOf(id, repo)
  if (r && !existsSync(repoDir(id, r))) await ensureRepo(id, r)
  return r
}

app.get<P & R>('/api/projects/:id/files', async (req) => fileTree(req.params.id, await openRepo(req.params.id, req.query.repo)))

app.get<P & { Querystring: { path: string; repo?: string } }>('/api/projects/:id/file', async (req) => ({
  path: req.query.path,
  content: await readText(req.params.id, req.query.path, await repoOf(req.params.id, req.query.repo)),
}))

app.put<P & R & { Body: { path: string; content: string } }>('/api/projects/:id/file', async (req) => {
  await writeText(req.params.id, req.body.path, req.body.content, await repoOf(req.params.id, req.query.repo))
  return { ok: true }
})

app.post<P & R & { Body: { message?: string } }>('/api/projects/:id/commit', async (req) => ({
  hash: await commit(req.params.id, req.body?.message || 'Ruční úpravy v editoru', await repoOf(req.params.id, req.query.repo)),
}))

app.get<P & R>('/api/projects/:id/history', async (req) => history(req.params.id, await repoOf(req.params.id, req.query.repo)))

app.get<{ Params: { id: string; hash: string } } & R>('/api/projects/:id/history/:hash', async (req) => ({
  diff: await diffOf(req.params.id, req.params.hash, await repoOf(req.params.id, req.query.repo)),
}))

// Git view: the commit graph with the work tree state, one commit's files, and both sides of a file diff.
app.get<P & { Querystring: { limit?: string; repo?: string } }>('/api/projects/:id/git/graph', async (req) => {
  const repo = await openRepo(req.params.id, req.query.repo)
  const [commits, status] = await Promise.all([graphLog(req.params.id, Number(req.query.limit ?? 500), repo), workStatus(req.params.id, repo)])
  return { commits, status }
})

app.get<{ Params: { id: string; hash: string } } & R>('/api/projects/:id/git/commit/:hash', async (req) => commitDetails(req.params.id, req.params.hash, await repoOf(req.params.id, req.query.repo)))

app.get<P & { Querystring: { path: string; hash?: string; from?: string; repo?: string } }>('/api/projects/:id/git/diff', async (req) =>
  fileDiff(req.params.id, req.query.path, req.query.hash || undefined, req.query.from || undefined, await repoOf(req.params.id, req.query.repo)))

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

app.get<P & { Querystring: { path: string } }>('/api/projects/:id/raw', (req, reply) => {
  const full = safePath(req.params.id, req.query.path)
  const type = MIME[extname(full).toLowerCase()]
  if (!type || !existsSync(full)) return reply.status(404).send({ error: 'Nenalezeno' })
  return reply.type(type).send(createReadStream(full))
})

// ---- build, preview, tests -----------------------------------------------------------------

app.post<P & { Body: { repo?: string } }>('/api/projects/:id/build/stop', (req) => {
  stopBuild(req.params.id, req.body?.repo)
  return { ok: true }
})
app.get<P>('/api/projects/:id/build', (req) => ({ running: isBuilding(req.params.id) }))
app.get<P>('/api/projects/:id/spec', async (req) => ({ spec: renderSpec(await loadProject(req.params.id), 'incremental') }))

app.get<P>('/api/projects/:id/preview', (req) => previewStatus(req.params.id))
app.post<P>('/api/projects/:id/preview/start', (req) => {
  void startPreview(req.params.id).catch((error: Error) => publish(req.params.id, 'preview', 'error', error.message))
  return { ok: true }
})
app.post<P>('/api/projects/:id/preview/stop', async (req) => {
  await stopPreview(req.params.id)
  return { ok: true }
})

app.get<P>('/api/projects/:id/tests', (req) => ({ running: testsRunning(req.params.id) }))

const storyKeys = (body: unknown) => (Array.isArray((body as { storyIds?: unknown })?.storyIds) ? ((body as { storyIds: unknown[] }).storyIds.filter((x): x is string => typeof x === 'string')) : [])
app.post<P>('/api/projects/:id/tests', async (req) => {
  void (await runTests(req.params.id, storyKeys(req.body))).done.catch(() => {})
  return { ok: true }
})
app.post<P>('/api/projects/:id/tests/generate', (req) => {
  const storyIds = storyKeys(req.body)
  if (!storyIds.length) throw new Error('Vyberte stories, ke kterým se mají testy napsat.')
  void generateStoryTests(req.params.id, storyIds).catch(() => {})
  return { ok: true }
})
/** Runs the chosen tests (walkthrough ids) one after another, each with its video. */
app.post<P & { Body: { ids?: unknown } }>('/api/projects/:id/tests/run', (req) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x): x is string => typeof x === 'string' && /^wt-[a-z0-9-]{1,40}$/.test(x)) : []
  if (!ids.length) throw new Error('Vyberte testy ke spuštění.')
  void runTestItems(req.params.id, ids).catch(() => {})
  return { ok: true }
})

/** Without a mode the build is a full one into an empty workspace and incremental into an existing app. */
app.post<P & { Body: { mode?: 'full' | 'incremental'; stepId?: string } }>('/api/projects/:id/build', async (req) => {
  const mode = req.body?.mode ?? ((await hasApp(req.params.id)) ? 'incremental' : 'full')
  if (req.body?.stepId && !(await loadProject(req.params.id)).workflow?.steps.some((s) => s.id === req.body.stepId)) throw new Error('Krok workflow nenalezen')
  startBuild(req.params.id, mode, undefined, req.body?.stepId)
  return { ok: true, mode }
})

app.get<P>('/api/projects/:id/generate', (req) => ({ running: isGenerating(req.params.id), step: generationStep(req.params.id) }))

app.post<{ Params: { id: string; step: string }; Body: { storyIds?: string[] } }>('/api/projects/:id/generate/:step', (req) => {
  if (!(GENERATE_STEPS as readonly string[]).includes(req.params.step)) throw new Error('Neznámý krok')
  const storyIds = Array.isArray(req.body?.storyIds) ? req.body.storyIds.filter((x): x is string => typeof x === 'string') : undefined
  return generate(req.params.id, req.params.step as GenerateStep, storyIds)
})

// ---- tasks, bugs, breakdown, contract, wiki ------------------------------------------------

type ItemParams = { Params: { id: string; kind: string; item: string } }
app.post<ItemParams & { Body: unknown }>('/api/projects/:id/items/:kind/:item/description', (req) =>
  saveDescription(req.params.id, DescriptionKindSchema.parse(req.params.kind), req.params.item, req.body, req.user!.name))
app.post<ItemParams>('/api/projects/:id/items/:kind/:item/attachments', async (req) => {
  const kind = ItemKindSchema.parse(req.params.kind)
  let file: { name: string; data: Buffer } | undefined
  for await (const part of req.parts()) {
    if (part.type !== 'file') throw new Error('Vyberte jeden soubor.')
    const data = await part.toBuffer()
    if (part.file.truncated) throw new Error('Příloha je větší než 20 MB.')
    file = { name: part.filename, data }
  }
  if (!file) throw new Error('Vyberte soubor.')
  return uploadAttachment(req.params.id, kind, req.params.item, file.name, file.data, req.user!.id)
})
app.get<{ Params: { id: string; aid: string } }>('/api/projects/:id/attachments/:aid', async (req, reply) => {
  const p = await loadProject(req.params.id)
  const a = p.attachments?.find((a) => a.id === req.params.aid)
  if (!a) return reply.status(404).send({ error: 'Příloha neexistuje.' })
  const inline = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.mime)
  const disposition = inline ? 'inline' : `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(a.name)}`
  const remote = await mediaUrl(`attachments/${p.id}/${a.storageName}`, attachmentPath(p.id, a), a.mime, disposition)
  if (remote) return reply.redirect(remote)
  return reply.type(a.mime).header('content-disposition', disposition)
    .header('x-content-type-options', 'nosniff').header('content-security-policy', "sandbox; default-src 'none'")
    .header('cache-control', 'private, max-age=3600').send(createReadStream(attachmentPath(p.id, a)))
})
app.get('/api/planning/notifications', (req) => planningInbox(req.user!))
app.post<ItemParams & { Body: unknown }>('/api/projects/:id/items/:kind/:item/planning', (req) =>
  savePlanning(req.params.id, ItemKindSchema.parse(req.params.kind), req.params.item, req.body, req.user!.id))
app.post<ItemParams & { Body: unknown }>('/api/projects/:id/items/:kind/:item/planning/resolve', (req) => {
  const body = z.object({ entryId: z.string(), expectedVersion: z.number().int().nonnegative(), resolved: z.boolean() }).parse(req.body)
  return resolvePlanningEntry(req.params.id, ItemKindSchema.parse(req.params.kind), req.params.item, body.entryId, body.expectedVersion, body.resolved, req.user!.id)
})
app.post<P & { Body: unknown }>('/api/projects/:id/planning/read', (req) => {
  const body = z.object({ kind: ItemKindSchema, itemId: z.string(), entryId: z.string(), dueAt: z.string().datetime({ offset: true }) }).parse(req.body)
  return readPlanningEntry(req.params.id, body.kind, body.itemId, body.entryId, body.dueAt, req.user!.id)
})
app.post<ItemParams & { Body: { title: string } }>('/api/projects/:id/items/:kind/:item/delete', (req) =>
  deleteProjectItem(req.params.id, ItemKindSchema.parse(req.params.kind), req.params.item, req.body?.title))
app.post<ItemParams & { Body: unknown }>('/api/projects/:id/items/:kind/:item/edit', (req) =>
  editProjectItem(req.params.id, ItemKindSchema.parse(req.params.kind), req.params.item, req.body))

app.post<{ Params: { id: string; review: string; group: string }; Body: { accept: boolean; edited?: ReviewGroupInput } }>(
  '/api/projects/:id/story-reviews/:review/:group/decide', async (req) => {
    if (typeof req.body?.accept !== 'boolean') throw new Error('Chybí rozhodnutí o návrhu.')
    const project = await mutateProject(req.params.id, (p) => {
      if (req.body.accept && (isBuilding(p.id) || testsRunning(p.id) || isPlanningTests(p.id) || isGenerating(p.id) || agentRuns.hasActive(p.id))) throw new Error('Počkejte na dokončení agentů a testů a poté návrh znovu zkontrolujte.')
      return decideStoryReview(p, req.params.review, req.params.group, req.body.accept, req.body.edited)
    })
    publish(req.params.id, 'project', 'changed', '')
    return project
  },
)

type I = { Params: { id: string; iid: string } }
type S = { Params: { id: string; sid: string } }
app.post<I>('/api/projects/:id/issues/:iid/run', (req) => { startIssue(req.params.id, req.params.iid); return { ok: true } })
app.get<I & { Querystring: { path: string } }>('/api/projects/:id/issues/:iid/diff', async (req) => {
  const issue = (await loadProject(req.params.id)).issues?.find((i) => i.id === req.params.iid)
  if (!issue) throw Object.assign(new Error('Task nenalezen'), { statusCode: 404 })
  const repo = await repoOf(req.params.id, issue.repoId)
  const commits = issue.commits ?? (await issueCommits(req.params.id, issue.id, repo))
  if (!commits) throw new Error('Změny tasku v historii repozitáře nejsou.')
  return rangeDiff(req.params.id, req.query.path, commits.base, commits.head, repo)
})
app.post<I>('/api/projects/:id/issues/:iid/accept', (req) => acceptIssue(req.params.id, req.params.iid))
app.post<I & { Body: { feedback?: string } }>('/api/projects/:id/issues/:iid/return', async (req) => {
  await returnIssue(req.params.id, req.params.iid, String(req.body?.feedback ?? ''))
  return { ok: true }
})
app.post<S>('/api/projects/:id/stories/:sid/implement', async (req) => { await startStory(req.params.id, req.params.sid); return { ok: true } })
app.post<S>('/api/projects/:id/stories/:sid/breakdown/approve', (req) => approveBreakdown(req.params.id, req.params.sid))
app.post<S>('/api/projects/:id/stories/:sid/breakdown/reject', (req) => rejectBreakdown(req.params.id, req.params.sid))
app.post<P>('/api/projects/:id/breakdown/approve', (req) => approveBreakdown(req.params.id))
app.post<P>('/api/projects/:id/contract/approve', async (req) => { await writeContract(req.params.id); return loadProject(req.params.id) })

app.post<{ Params: { id: string; page: string }; Body: { accept?: boolean } }>('/api/projects/:id/wiki/:page/decide', (req) => mutateProject(req.params.id, (project) => {
  const now = new Date().toISOString()
  const wiki = (project.wiki ?? []).map((w) => {
    if (w.id !== req.params.page || !w.draft) return w
    if (!req.body?.accept) return { ...w, draft: undefined }
    return { ...w, title: w.draft.title, body: w.draft.body, sources: w.draft.sources, updatedAt: now, draft: undefined, history: [...(w.body ? [{ body: w.body, at: w.updatedAt }] : []), ...w.history].slice(0, 30) }
  })
  return { ...project, wiki }
}))

// ---- agentic IDE --------------------------------------------------------------------------

type T = { Params: { id: string; eid: string } }
app.post<P>('/api/projects/:id/ide/run', (req) => runIde(req.params.id, req.body))
app.post<P>('/api/projects/:id/ide/inline', (req) => runInline(req.params.id, req.body))
app.post<T>('/api/projects/:id/ide/trace/:eid/revert', (req) => revertEvent(req.params.id, req.params.eid))
app.post<T>('/api/projects/:id/ide/trace/:eid/assign', (req) => assignEvent(req.params.id, req.params.eid, req.body))

// ---- walkthroughs (recorded click-throughs) ------------------------------------------------

type W = { Params: { id: string; wid: string } }

app.post<P & { Body: { route?: string; section?: string; storyIds?: string[]; instructions?: string; title?: string } }>('/api/projects/:id/walkthroughs', (req) =>
  createWalkthrough(req.params.id, req.body ?? {}),
)
app.post<W>('/api/projects/:id/walkthroughs/:wid/generate', async (req) => {
  void (await generateWalkthrough(req.params.id, req.params.wid)).done.catch(() => {})
  return { ok: true }
})
app.post<W>('/api/projects/:id/walkthroughs/:wid/test', async (req) => {
  void (await testWalkthrough(req.params.id, req.params.wid)).done.catch(() => {})
  return { ok: true }
})
app.post<W>('/api/projects/:id/walkthroughs/:wid/record', async (req) => {
  void (await recordWalkthrough(req.params.id, req.params.wid)).done.catch(() => {})
  return { ok: true }
})
app.delete<W & { Body: { title?: string } }>('/api/projects/:id/walkthroughs/:wid', (req) =>
  deleteProjectItem(req.params.id, 'test', req.params.wid, req.body?.title))

/** The recording; byte ranges make seeking in <video> work. */
app.get<{ Params: { id: string; file: string } }>('/api/projects/:id/walkthroughs/:file', async (req, reply) => {
  if (!isVideoFile(req.params.file)) throw new Error('Neplatný soubor')
  const full = join(videoDir(req.params.id), req.params.file)
  if (!existsSync(full)) return reply.status(404).send({ error: 'Video zatím není nahrané' })
  const remote = await mediaUrl(`recordings/${req.params.id}/${req.params.file}/${statSync(full).mtimeMs.toString(36)}`, full, 'video/webm')
  if (remote) return reply.redirect(remote)
  const size = statSync(full).size
  reply.type('video/webm').header('accept-ranges', 'bytes').header('cache-control', 'no-cache')
  const header = req.headers.range
  if (!header) return reply.header('content-length', size).send(createReadStream(full))
  const range = parseRange(header, size)
  if (!range) return reply.status(416).header('content-range', `bytes */${size}`).send()
  return reply
    .status(206)
    .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
    .header('content-length', range.end - range.start + 1)
    .send(createReadStream(full, range))
})

// ---- distributed agents --------------------------------------------------------------------

app.get('/api/hub', (req) => {
  const status = hub.status()
  // Runs name their projects; others see only the ones they can open.
  return req.user!.admin ? status : { ...status, runs: status.runs.filter((r) => { try { return !!roleOf(req.user!, r.rootProjectId ?? r.projectId) } catch { return false } }) }
})
app.put('/api/hub/model-metrics', (req) => { saveMetrics(req.body); return hub.status() })

app.put<{ Body: { relay?: string; mode?: 'local' | 'remote' } }>('/api/hub', (req) => {
  const mode = req.body?.mode
  if (mode !== undefined && mode !== 'local' && mode !== 'remote') throw new Error('Neznámý režim')
  hub.configure({ relay: req.body?.relay, mode })
  return hub.status()
})

app.post<{ Body: { name?: string } }>('/api/hub/workers', (req) => ({ token: hub.enroll(String(req.body?.name ?? '')) }))

app.delete<{ Params: { wid: string } }>('/api/hub/workers/:wid', (req) => {
  hub.revoke(req.params.wid)
  return hub.status()
})

app.get<P>('/api/projects/:id/pipeline', async (req) => (await loadPipeline(req.params.id)) ?? {})

app.post<P & { Body: { goal?: string; autoApply?: boolean } }>('/api/projects/:id/pipeline', async (req) => {
  const goal = String(req.body?.goal ?? '').trim() || 'Dotáhni aplikaci podle stories do funkčního a otestovaného stavu.'
  return startPipeline(req.params.id, goal, Boolean(req.body?.autoApply))
})

app.post<P>('/api/projects/:id/pipeline/cancel', (req) => {
  cancelPipeline(req.params.id)
  return { ok: true }
})

/** Pulls the design from Figma; the link is remembered, the token falls back to FIGMA_TOKEN. */
app.post<P & { Body: { url?: string; token?: string } }>('/api/projects/:id/figma', async (req) => {
  const project = await loadProject(req.params.id)
  const url = req.body?.url?.trim() || project.figma?.url
  const token = req.body?.token?.trim() || process.env.FIGMA_TOKEN
  if (!url) throw new Error('Zadejte odkaz na soubor ve Figmě')
  if (!token) throw new Error('Chybí osobní token Figmy (nebo proměnná FIGMA_TOKEN na serveru)')
  const { project: synced, ...counts } = await syncFigma(project, url, token)
  return { ...counts, project: await saveProject(synced) }
})

/** Imports epics and stories by JQL; the address, JQL and e-mail are remembered, the token falls back to JIRA_TOKEN. */
app.post<P & { Body: { url?: string; email?: string; token?: string; jql?: string } }>('/api/projects/:id/jira', async (req) => {
  const saved = (await loadProject(req.params.id)).jira
  const url = req.body?.url?.trim() || saved?.url
  const email = (req.body?.email ?? saved?.email ?? process.env.JIRA_EMAIL ?? '').trim() || undefined
  const token = req.body?.token?.trim() || process.env.JIRA_TOKEN
  const jql = req.body?.jql?.trim() || saved?.jql
  if (!url) throw new Error('Zadejte adresu Jiry')
  if (!jql) throw new Error('Zadejte JQL dotaz, např. project = ABC AND issuetype in (Epic, Story)')
  if (!token) throw new Error('Chybí API token Jiry (nebo proměnná JIRA_TOKEN na serveru)')
  const items = await fetchJira({ url, email, token }, jql)
  const base = (await jiraBase(url)).href
  let counts = { added: 0, updated: 0, skipped: 0 }
  const project = await mutateProject(req.params.id, (current) => {
    const { project, ...c } = mergeJira(current, items, { url, jql, email }, base)
    counts = c
    return project
  })
  return { ...counts, found: items.length, project }
})

app.get<{ Params: { id: string; file: string } }>('/api/projects/:id/figma/:file', (req, reply) => {
  if (!/^[\w-]+\.png$/.test(req.params.file)) throw new Error('Neplatný soubor')
  const full = join(projectDir(req.params.id), 'figma', req.params.file)
  if (!existsSync(full)) return reply.status(404).send({ error: 'Obrázek rámce zatím není stažený' })
  return reply.type('image/png').header('cache-control', 'no-cache').send(createReadStream(full))
})

// ---- static web app in production ----------------------------------------------------------

const WEB_DIST = resolve(import.meta.dirname, '../../web/dist')
if (existsSync(WEB_DIST)) {
  app.get('/*', (req, reply) => {
    const rel = decodeURIComponent(req.url.split('?')[0]!).replace(/^\/+/, '')
    const full = resolve(WEB_DIST, rel)
    if (req.url.startsWith('/api/') || req.url.startsWith('/health/')) return reply.code(404).send({ error: 'Nenalezeno.' })
    const file = full.startsWith(WEB_DIST + '/') && rel && existsSync(full) && statSync(full).isFile() && extname(full) ? full : join(WEB_DIST, 'index.html')
    reply.header('cache-control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
    return reply.type(types[extname(file)] ?? 'application/octet-stream').send(createReadStream(file))
  })
}

app.get<P>('/api/projects/:id/preview/access', (req) => issuePreviewAccess(req, req.params.id))
app.get<P>('/api/projects/:id/preview/open', (req, reply) => reply.redirect(issuePreviewAccess(req, req.params.id).url))
const gateway = await startPreviewGateway(previewPort)
app.addHook('onClose', async () => { hub.stop(); gateway?.closeAllConnections(); gateway?.close(); await stopAllPreviews(); await shutdownProcesses() })
const port = Number(process.env.PORT ?? 4310)
await app.listen({ port, host: '127.0.0.1' })
hub.start()
void recoverWalkthroughs().catch((e) => console.warn('Průchody:', e))
void recoverIssues().catch((e) => console.warn('Tasky:', e))
console.log(`Reactor server http://localhost:${port}`)

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true; operational.closing = true
  const deadline = setTimeout(() => process.exit(1), 25_000); deadline.unref()
  await shutdownProcesses()
  await app.close()
  clearTimeout(deadline)
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())
