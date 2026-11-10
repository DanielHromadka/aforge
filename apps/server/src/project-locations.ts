// Execution ids keep every existing job map and route scoped to one session or frozen snapshot.
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProjectHistory, SessionContext } from '@aforge/shared'

export const DATA_DIR = resolve(process.env.AFORGE_DATA ?? join(import.meta.dirname, '../../../data'))
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
const PROJECTS = join(DATA_DIR, 'projects')
const initialDates = new Map<string, string>()
export const locationOf = (id: string) => {
  const parts = id.split('--')
  if (!/^[a-z0-9-]{1,100}$/.test(id) || parts.length > 3 || parts.some((p) => !p || p.length > 64)) throw new Error('Neplatné id projektu nebo session')
  const [projectId, sessionId, snapshotId] = parts as [string, string | undefined, string | undefined]
  if (sessionId && !/^(initial|[a-f0-9]{12})$/.test(sessionId)) throw new Error('Neplatné id session')
  if (snapshotId && !/^[a-f0-9]{12}$/.test(snapshotId)) throw new Error('Neplatné id snapshotu')
  const root = join(PROJECTS, projectId)
  const dir = snapshotId ? join(root, 'snapshots', `${sessionId}-${snapshotId}`) : sessionId ? join(root, 'sessions', sessionId) : root
  return { projectId, root, dir, sessionId, snapshotId }
}
export const projectDir = (id: string) => locationOf(id).dir
export const workspaceDir = (id: string) => join(projectDir(id), 'workspace')
/** A project repository: `main` is the workspace, the others live in repos/<id>. */
export const repoDir = (id: string, repo = 'main') => {
  if (repo === 'main') return workspaceDir(id)
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(repo)) throw new Error('Neplatné id repozitáře')
  return join(projectDir(id), 'repos', repo)
}
export const historyFile = (id: string) => join(locationOf(id).root, 'sessions.json')
export const historyOf = (id: string): ProjectHistory => {
  const { projectId, root } = locationOf(id)
  if (existsSync(historyFile(id))) return JSON.parse(readFileSync(historyFile(id), 'utf8')) as ProjectHistory
  // Figma models can be large. Their creation date is immutable, so journals need not reparse them per line.
  if (!initialDates.has(root)) initialDates.set(root, JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')).createdAt)
  return { projectId, sessions: [{ id: projectId, name: 'Session 1', createdAt: initialDates.get(root)! }], snapshots: [] }
}
export const sessionContext = (id: string): SessionContext => {
  const loc = locationOf(id)
  const history = historyOf(id)
  const snapshot = loc.snapshotId ? history.snapshots.find((s) => s.id === id) : undefined
  const session = history.sessions.find((s) => s.id === (snapshot?.sessionId ?? id))
  if (!session || (loc.snapshotId && !snapshot)) throw Object.assign(new Error('Session nebo snapshot neexistuje'), { statusCode: 404 })
  return { ...session, projectId: loc.projectId, ...(snapshot ? { snapshot } : {}) }
}
export const assertWritable = (id: string) => {
  const context = sessionContext(id)
  if (context.snapshot || context.archivedAt) throw Object.assign(new Error('Archivovaná session a snapshot jsou pouze pro čtení.'), { statusCode: 403 })
}
