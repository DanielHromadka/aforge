// Projects live on disk: data/projects/<id>/project.json (the model), chat.json (the agent thread)
// and workspace/ (the generated application, a git repository).
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, projectDir, workspaceDir, sessionContext, assertWritable, historyOf } from './project-locations.js'
export { DATA_DIR, projectDir, workspaceDir } from './project-locations.js'
import { randomUUID } from 'node:crypto'
import { captureDescriptionHistory, newProject, normalizeProject, WorkflowSchema, type ChatMessage, type Issue, type Project, type ProjectSummary } from '@aforge/shared'

const PROJECTS = join(DATA_DIR, 'projects')

/** Writes through a temporary file so a crash never leaves half a JSON document behind. */
export const writeJson = async (file: string, value: unknown) => {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}

export const listProjects = async (): Promise<ProjectSummary[]> => {
  if (!existsSync(PROJECTS)) return []
  const out: ProjectSummary[] = []
  for (const id of await readdir(PROJECTS)) {
    try {
      const p = await loadProject(id)
      const issues = p.issues ?? []
      out.push({
        id: p.id, name: p.name, description: p.description, updatedAt: p.updatedAt,
        stats: {
          epics: (p.epics ?? []).length, stories: p.stories.length,
          tasks: issues.filter((i) => i.type !== 'bug').length, bugs: issues.filter((i) => i.type === 'bug').length,
          tests: { passed: p.testReport?.cases.filter((c) => c.status === 'passed').length ?? 0, total: p.testReport?.cases.length ?? 0 },
          agentRuns: 0, costUsd: 0,
        },
      })
    } catch {
      // A folder without a readable project.json is not a project.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const listWorkingSessions = async () => (await listProjects()).flatMap((p) => historyOf(p.id).sessions.filter((s) => !s.archivedAt))

export const loadProject = async (id: string): Promise<Project> => {
  const raw = JSON.parse(await readFile(join(projectDir(id), 'project.json'), 'utf8')) as Project
  return { ...normalizeProject(raw), id, session: sessionContext(id) }
}

const persistProject = async (project: Project, author: string, protectedChanges: boolean): Promise<Project> => {
  assertWritable(project.id)
  if (project.workflow) project = { ...project, workflow: WorkflowSchema.parse(project.workflow) }
  const { session: _session, role: _role, ...model } = project
  let previous: Project | undefined
  try { previous = JSON.parse(await readFile(join(projectDir(project.id), 'project.json'), 'utf8')) as Project } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  const at = new Date().toISOString()
  // Older direct job saves must not undo human-only data or a newer description edit.
  const stale = !!previous && previous.updatedAt !== project.updatedAt
  const protectedModel = previous && !protectedChanges ? { ...model, planning: previous.planning, attachments: previous.attachments } : model
  const fresh = stale ? { ...protectedModel,
    stories: model.stories.map((s) => { const old = previous!.stories.find((old) => old.id === s.id); return old ? { ...s, description: old.description } : s }),
    epics: model.epics?.map((e) => { const old = previous!.epics?.find((old) => old.id === e.id); return old ? { ...e, description: old.description } : e }),
  } : protectedModel
  const next = captureDescriptionHistory(previous, { ...fresh, updatedAt: at }, author, at)
  await writeJson(join(projectDir(project.id), 'project.json'), next)
  return { ...next, session: sessionContext(project.id) }
}

// Read-modify-write of one project goes through a queue, so agents finishing at the same moment never
// overwrite each other's changes.
const queues = new Map<string, Promise<unknown>>()
const serializeProject = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const next = (queues.get(id) ?? Promise.resolve()).then(fn)
  queues.set(id, next.catch(() => {}))
  return next
}
export const saveProject = (project: Project, author = 'Aplikace'): Promise<Project> =>
  serializeProject(project.id, () => persistProject(project, author, false))
export const mutateProject = (id: string, fn: (p: Project) => Project | Promise<Project>, author?: string): Promise<Project> => {
  return serializeProject(id, async () => persistProject(await fn(await loadProject(id)), author ?? 'Aplikace', true))
}

/** Issues edited in two places: per key the newer change wins; issues only one side knows are kept. */
export const mergeIssues = (server: Issue[] = [], client: Issue[] = []): Issue[] => {
  const byId = new Map(server.map((i) => [i.id, i]))
  for (const i of client) {
    const old = byId.get(i.id)
    if (!old || i.updatedAt > old.updatedAt) byId.set(i.id, i)
  }
  return [...byId.values()]
}

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'projekt'

export const createProject = async (name: string, description: string): Promise<Project> => {
  let id = slug(name)
  if (existsSync(projectDir(id))) id = `${id}-${randomUUID().slice(0, 6)}`
  await mkdir(workspaceDir(id), { recursive: true })
  await writeJson(join(projectDir(id), 'project.json'), newProject(id, name, description))
  return loadProject(id)
}

export const loadChat = async (id: string): Promise<ChatMessage[]> => {
  try {
    return JSON.parse(await readFile(join(projectDir(id), 'chat.json'), 'utf8')) as ChatMessage[]
  } catch {
    return []
  }
}

export const saveChat = (id: string, chat: ChatMessage[]) => { assertWritable(id); return writeJson(join(projectDir(id), 'chat.json'), chat) }
