import { cp, mkdir, readFile, rename, rm, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { newProject, type AgentRun, type PreviewStatus, type ProjectHistory, type SessionEntry, type SnapshotEntry } from '@aforge/shared'
import { historyFile, historyOf, locationOf, projectDir, sessionContext, assertWritable } from './project-locations.js'
import { loadProject, writeJson } from './store.js'
import { agentRuns } from './agent-runs.js'
import { isBuilding } from './build.js'
import { isGenerating } from './generate.js'
import { isPipelineRunning } from './pipeline.js'
import { testsRunning } from './tests.js'
import { previewStatus, stopPreview } from './preview.js'
import { ensureRepo } from './workspace.js'
import { publish } from './events.js'
import { readJournal } from './session-journal.js'
import { exclusiveSession } from './session-gate.js'
import type { HubEvent } from './events.js'

export interface SessionRecord {
  capturedAt: string
  preview: PreviewStatus
  runs: AgentRun[]
  events: HubEvent[]
}
const serials = new Map<string, Promise<unknown>>()
const serial = <T>(id: string, job: () => Promise<T>): Promise<T> => {
  const root = locationOf(id).projectId
  const next = (serials.get(root) ?? Promise.resolve()).then(job, job)
  serials.set(root, next.catch(() => {}))
  return next
}
const title = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > 120) throw new Error('Název smí mít nejvýše 120 znaků')
  return text || fallback
}
export const busySession = (id: string): string | undefined => {
  if (isBuilding(id)) return 'Běží build nebo generování průchodu'
  if (isGenerating(id)) return 'Agent připravuje podklady'
  if (isPipelineRunning(id)) return 'Běží pipeline'
  if (testsRunning(id)) return 'Běží testy'
  if (previewStatus(id).state === 'starting') return 'Spouští se náhled'
  if (agentRuns.hasActive(id)) return 'Běží AI agent'
  return undefined
}
const assertIdle = async (id: string) => {
  const project = await loadProject(id)
  const busy = busySession(id) ?? (project.walkthroughs?.some((w) => w.status === 'generating' || w.status === 'recording') ? 'Běží průchod aplikací' : undefined)
  if (busy) throw Object.assign(new Error(`${busy}. Snapshot nebo archivaci lze dokončit po skončení práce.`), { statusCode: 409 })
}
export const sessionHistory = (id: string) => {
  const history = historyOf(id)
  return { ...history, sessions: history.sessions.map((s) => ({ ...s, activity: busySession(s.id) ?? (previewStatus(s.id).state === 'running' ? 'Náhled běží' : undefined) })) }
}
const capture = async (id: string): Promise<SessionRecord> => {
  const { url: _url, ...preview } = previewStatus(id)
  const events = await readJournal(id)
  if (!preview.log) preview.log = events.filter((e) => e.channel === 'preview' && e.kind === 'log').map((e) => e.text).join('\n')
  return { capturedAt: new Date().toISOString(), preview, runs: agentRuns.list().filter((r) => r.projectId === id), events }
}
export const sessionRecord = async (id: string): Promise<SessionRecord> => {
  const context = sessionContext(id)
  if (!context.snapshot && !context.archivedAt) return capture(id)
  try { return JSON.parse(await readFile(join(projectDir(id), 'session-record.json'), 'utf8')) as SessionRecord }
  catch { return { capturedAt: context.snapshot?.createdAt ?? context.archivedAt!, preview: { state: 'idle', log: '' }, runs: [], events: await readJournal(id) } }
}

export const createSession = (id: string, name: unknown) => serial(id, async () => {
  const history = historyOf(id)
  const root = await loadProject(history.projectId)
  const key = randomUUID().replaceAll('-', '').slice(0, 12)
  const entry: SessionEntry = { id: `${history.projectId}--${key}`, name: title(name, `Session ${history.sessions.length + 1}`), createdAt: new Date().toISOString() }
  const dir = projectDir(entry.id)
  try {
    await mkdir(join(dir, 'workspace'), { recursive: true })
    const project = newProject(entry.id, root.name)
    project.stack.agent = root.stack.agent
    if (root.workflow) project.workflow = { ...root.workflow, steps: root.workflow.steps.map((s) => ({ ...s, prompt: '' })), retained: [] }
    await writeJson(join(dir, 'project.json'), project)
    history.sessions.push(entry)
    await writeJson(historyFile(id), history)
    await ensureRepo(entry.id)
  } catch (e) {
    // Keep a registered session if only git initialization failed; its model is still usable.
    if (!historyOf(id).sessions.some((s) => s.id === entry.id)) await rm(dir, { recursive: true, force: true })
    throw e
  }
  publish(entry.id, 'session', 'created', `Vytvořena session: ${entry.name}`)
  return loadProject(entry.id)
})

const COPY = ['project.json', 'chat.json', 'pipeline.json', 'events.jsonl', 'workspace', 'repos', 'figma', 'walkthroughs', 'attachments']
const SKIP = new Set(['node_modules', 'bin', 'obj', '.vite', '.DS_Store'])
export const copySessionData = async (source: string, target: string) => {
  for (const item of COPY) {
    const from = join(source, item)
    if (!existsSync(from)) continue
    await cp(from, join(target, item), {
      recursive: true,
      filter: async (path) => {
        if (SKIP.has(basename(path))) return false
        const info = await lstat(path)
        if (info.isSymbolicLink()) throw new Error('Snapshot nelze vytvořit: zdroj obsahuje symbolický odkaz. Použijte samostatné soubory.')
        if ((basename(path) === '.git' && !info.isDirectory()) || (path.endsWith('/objects/info/alternates') && info.size > 0)) throw new Error('Snapshot vyžaduje samostatný Git repozitář bez odkazů na externí metadata nebo objekty.')
        return true
      },
    })
  }
}
export const createSnapshot = (id: string, name: unknown) => exclusiveSession(id, () => serial(id, async () => {
  const context = sessionContext(id)
  if (context.snapshot) throw new Error('Snapshot už je neměnný; nový snapshot vytvořte z pracovní session.')
  await assertIdle(id)
  const record = context.archivedAt ? await sessionRecord(id) : await capture(id)
  const history = historyOf(id)
  const part = locationOf(id).sessionId ?? 'initial'
  const key = randomUUID().replaceAll('-', '').slice(0, 12)
  const snapshot: SnapshotEntry = { id: `${history.projectId}--${part}--${key}`, sessionId: id, name: title(name, `Snapshot ${history.snapshots.length + 1}`), createdAt: new Date().toISOString() }
  const target = projectDir(snapshot.id)
  const staging = `${target}.tmp`
  await mkdir(staging, { recursive: true })
  try {
    await copySessionData(projectDir(id), staging)
    await writeJson(join(staging, 'session-record.json'), record)
    await rename(staging, target)
    history.snapshots.unshift(snapshot)
    await writeJson(historyFile(id), history)
  } catch (e) {
    await rm(staging, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
    throw e
  }
  publish(id, 'session', 'snapshot', `Uložen snapshot: ${snapshot.name}`)
  return loadProject(snapshot.id)
}))
export const archiveSession = (id: string) => exclusiveSession(id, () => serial(id, async () => {
  assertWritable(id)
  await assertIdle(id)
  const record = await capture(id)
  if (previewStatus(id).state === 'running') await stopPreview(id)
  await writeJson(join(projectDir(id), 'session-record.json'), record)
  const history: ProjectHistory = historyOf(id)
  history.sessions = history.sessions.map((s) => s.id === id ? { ...s, archivedAt: record.capturedAt } : s)
  await writeJson(historyFile(id), history)
  publish(id, 'session', 'archived', 'Session archivována')
  return loadProject(id)
}))
