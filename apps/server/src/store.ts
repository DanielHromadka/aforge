// Projects live on disk: data/projects/<id>/project.json (the model), chat.json (the agent thread)
// and workspace/ (the generated application, a git repository).
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { newProject, type ChatMessage, type Project, type ProjectSummary } from '@aforge/shared'

export const DATA_DIR = resolve(process.env.AFORGE_DATA ?? join(import.meta.dirname, '../../../data'))
const PROJECTS = join(DATA_DIR, 'projects')

const ID_RE = /^[a-z0-9-]{1,64}$/

export const projectDir = (id: string): string => {
  if (!ID_RE.test(id)) throw new Error('Neplatné id projektu')
  return join(PROJECTS, id)
}

export const workspaceDir = (id: string): string => join(projectDir(id), 'workspace')

/** Writes through a temporary file so a crash never leaves half a JSON document behind. */
const writeJson = async (file: string, value: unknown) => {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}

export const listProjects = async (): Promise<ProjectSummary[]> => {
  if (!existsSync(PROJECTS)) return []
  const out: ProjectSummary[] = []
  for (const id of await readdir(PROJECTS)) {
    try {
      const p = await loadProject(id)
      out.push({ id: p.id, name: p.name, description: p.description, updatedAt: p.updatedAt })
    } catch {
      // A folder without a readable project.json is not a project.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const loadProject = async (id: string): Promise<Project> =>
  JSON.parse(await readFile(join(projectDir(id), 'project.json'), 'utf8')) as Project

export const saveProject = async (project: Project): Promise<Project> => {
  const next = { ...project, updatedAt: new Date().toISOString() }
  await writeJson(join(projectDir(project.id), 'project.json'), next)
  return next
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
  return saveProject(newProject(id, name, description))
}

export const loadChat = async (id: string): Promise<ChatMessage[]> => {
  try {
    return JSON.parse(await readFile(join(projectDir(id), 'chat.json'), 'utf8')) as ChatMessage[]
  } catch {
    return []
  }
}

export const saveChat = (id: string, chat: ChatMessage[]) => writeJson(join(projectDir(id), 'chat.json'), chat)
