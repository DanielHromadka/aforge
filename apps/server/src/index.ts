import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { applyOps, type ChatMessage, type Project, type Stage } from '@aforge/shared'
import { consult, detectProviders } from './agents.js'
import { isBuilding, renderSpec, startBuild, stopBuild } from './build.js'
import { buildContext, CONSULTANT_SYSTEM, INTENTS, type Focus } from './context.js'
import { subscribe } from './events.js'
import { importFigma } from './figma.js'
import { previewStatus, startPreview, stopPreview } from './preview.js'
import { createProject, listProjects, loadChat, loadProject, saveChat, saveProject } from './store.js'
import { runTests } from './tests.js'
import { commit, diffOf, ensureRepo, fileTree, history, readText, removeFile, safePath, writeText } from './workspace.js'

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 20 * 1024 * 1024 })

app.setErrorHandler((err, _req, reply) => {
  reply.status((err as { statusCode?: number }).statusCode ?? 400).send({ error: err instanceof Error ? err.message : String(err) })
})

type P = { Params: { id: string } }

app.get('/api/providers', () => detectProviders())

app.get('/api/projects', () => listProjects())

app.post<{ Body: { name: string; description?: string } }>('/api/projects', async (req) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) throw new Error('Zadejte název projektu')
  const project = await createProject(name, String(req.body.description ?? ''))
  await ensureRepo(project.id)
  return project
})

app.get<P>('/api/projects/:id', (req) => loadProject(req.params.id))

/** The client sends the whole model; the server owns ids and timestamps only. */
app.put<P & { Body: Project }>('/api/projects/:id', async (req) => {
  const current = await loadProject(req.params.id)
  return saveProject({ ...req.body, id: current.id, createdAt: current.createdAt })
})

// ---- live events (SSE) ---------------------------------------------------------------------

app.get<P>('/api/projects/:id/events', (req, reply) => {
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  reply.raw.write(': connected\n\n')
  const off = subscribe(req.params.id, (e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`))
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000)
  req.raw.on('close', () => {
    clearInterval(ping)
    off()
  })
  return reply
})

// ---- agent ---------------------------------------------------------------------------------

app.get<P>('/api/projects/:id/chat', (req) => loadChat(req.params.id))

app.post<P & { Body: { text?: string; intent?: string; focus: Focus } }>('/api/projects/:id/chat', async (req) => {
  const { id } = req.params
  const project = await loadProject(id)
  const chat = await loadChat(id)
  const stage: Stage = req.body.focus?.stage ?? 'stories'
  const intentText = req.body.intent ? INTENTS[req.body.intent] : undefined
  if (req.body.intent && !intentText) throw new Error('Neznámý požadavek')
  const text = String(req.body.text ?? '').trim() || intentText
  if (!text) throw new Error('Prázdná zpráva')
  const userMsg: ChatMessage = { id: randomUUID(), role: 'user', text, stage, proposals: [], conflicts: [], createdAt: new Date().toISOString() }
  const context = await buildContext(project, req.body.focus ?? { stage }, chat)
  const reply = await consult(CONSULTANT_SYSTEM, `${context}\n\n<user_request stage="${stage}">\n${text}\n</user_request>`)
  const agentMsg: ChatMessage = {
    id: randomUUID(),
    role: 'agent',
    text: reply.reply,
    stage,
    proposals: reply.proposals.map((p) => ({ ...p, id: `${p.id}-${randomUUID().slice(0, 4)}`, status: 'pending' as const })),
    conflicts: reply.conflicts,
    createdAt: new Date().toISOString(),
  }
  await saveChat(id, [...chat, userMsg, agentMsg])
  return [userMsg, agentMsg]
})

app.post<{ Params: { id: string; msg: string; pid: string; action: string } }>(
  '/api/projects/:id/chat/:msg/proposals/:pid/:action',
  async (req) => {
    const { id, msg, pid, action } = req.params
    if (action !== 'accept' && action !== 'reject') throw new Error('Neznámá akce')
    const chat = await loadChat(id)
    const proposal = chat.find((m) => m.id === msg)?.proposals.find((p) => p.id === pid)
    if (!proposal) throw new Error('Návrh nenalezen')
    if (proposal.status !== 'pending') throw new Error('Návrh už byl vyřízen')
    let project = await loadProject(id)
    if (action === 'accept') {
      project = await saveProject(applyOps(project, proposal.ops))
      const fileOps = proposal.ops.filter((o) => o.type === 'file.write' || o.type === 'file.delete')
      for (const op of fileOps) {
        if (op.type === 'file.write') await writeText(id, op.path, op.content)
        else if (op.type === 'file.delete') await removeFile(id, op.path)
      }
      if (fileOps.length) await commit(id, `aForge agent: ${proposal.title}`)
    }
    proposal.status = action === 'accept' ? 'accepted' : 'rejected'
    await saveChat(id, chat)
    return { project, chat }
  },
)

app.delete<P>('/api/projects/:id/chat', async (req) => {
  await saveChat(req.params.id, [])
  return []
})

// ---- workspace -----------------------------------------------------------------------------

app.get<P>('/api/projects/:id/files', (req) => fileTree(req.params.id))

app.get<P & { Querystring: { path: string } }>('/api/projects/:id/file', async (req) => ({
  path: req.query.path,
  content: await readText(req.params.id, req.query.path),
}))

app.put<P & { Body: { path: string; content: string } }>('/api/projects/:id/file', async (req) => {
  await writeText(req.params.id, req.body.path, req.body.content)
  return { ok: true }
})

app.post<P & { Body: { message?: string } }>('/api/projects/:id/commit', async (req) => ({
  hash: await commit(req.params.id, req.body?.message || 'Ruční úpravy v editoru'),
}))

app.get<P>('/api/projects/:id/history', (req) => history(req.params.id))

app.get<{ Params: { id: string; hash: string } }>('/api/projects/:id/history/:hash', async (req) => ({
  diff: await diffOf(req.params.id, req.params.hash),
}))

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

app.get<P & { Querystring: { path: string } }>('/api/projects/:id/raw', (req, reply) => {
  const full = safePath(req.params.id, req.query.path)
  const type = MIME[extname(full).toLowerCase()]
  if (!type || !existsSync(full)) return reply.status(404).send({ error: 'Nenalezeno' })
  return reply.type(type).send(createReadStream(full))
})

// ---- build, preview, tests -----------------------------------------------------------------

app.post<P & { Body: { mode?: 'full' | 'incremental' } }>('/api/projects/:id/build', async (req) => {
  await startBuild(req.params.id, req.body?.mode === 'incremental' ? 'incremental' : 'full')
  return { ok: true }
})
app.post<P>('/api/projects/:id/build/stop', (req) => {
  stopBuild(req.params.id)
  return { ok: true }
})
app.get<P>('/api/projects/:id/build', (req) => ({ running: isBuilding(req.params.id) }))
app.get<P>('/api/projects/:id/spec', async (req) => ({ spec: renderSpec(await loadProject(req.params.id), 'incremental') }))

app.get<P>('/api/projects/:id/preview', (req) => previewStatus(req.params.id))
app.post<P>('/api/projects/:id/preview/start', (req) => {
  void startPreview(req.params.id)
  return { ok: true }
})
app.post<P>('/api/projects/:id/preview/stop', async (req) => {
  await stopPreview(req.params.id)
  return { ok: true }
})

app.post<P>('/api/projects/:id/tests', async (req) => {
  await runTests(req.params.id)
  return { ok: true }
})

app.post<P & { Body: { url: string; token: string } }>('/api/projects/:id/figma', async (req) => {
  const screens = await importFigma(req.body.url, req.body.token)
  const project = await loadProject(req.params.id)
  const ids = new Set(screens.map((s) => s.id))
  return saveProject({ ...project, screens: [...project.screens.filter((s) => !ids.has(s.id)), ...screens] })
})

// ---- static web app in production ----------------------------------------------------------

const WEB_DIST = resolve(import.meta.dirname, '../../web/dist')
if (existsSync(WEB_DIST)) {
  app.get('/*', (req, reply) => {
    const rel = decodeURIComponent(req.url.split('?')[0]!).replace(/^\/+/, '')
    const full = resolve(WEB_DIST, rel)
    const file = full.startsWith(WEB_DIST) && rel && existsSync(full) && extname(full) ? full : join(WEB_DIST, 'index.html')
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
    return reply.type(types[extname(file)] ?? 'application/octet-stream').send(createReadStream(file))
  })
}

const port = Number(process.env.PORT ?? 4310)
await app.listen({ port, host: '127.0.0.1' })
console.log(`aForge server http://localhost:${port}`)
