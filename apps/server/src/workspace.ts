// The generated application's working tree. Every path from the client goes through `safePath`, so
// nothing outside the project's workspace can be read or written.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FileEntry } from '@aforge/shared'
import { run } from '@aforge/runner'
import { workspaceDir } from './store.js'

const HIDDEN = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', '.vite', 'playwright-report', 'test-output'])

export const safePath = (projectId: string, rel: string): string => {
  const root = workspaceDir(projectId)
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error('Cesta mimo pracovní adresář')
  return full
}

export const fileTree = async (projectId: string): Promise<FileEntry[]> => {
  const root = workspaceDir(projectId)
  const walk = async (dir: string, depth: number): Promise<FileEntry[]> => {
    if (depth > 12) return []
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const out: FileEntry[] = []
    for (const e of entries) {
      if (HIDDEN.has(e.name) || e.name === '.DS_Store') continue
      const full = join(dir, e.name)
      const path = relative(root, full).split(sep).join('/')
      if (e.isDirectory()) out.push({ path, type: 'dir', children: await walk(full, depth + 1) })
      else out.push({ path, type: 'file' })
    }
    return out.sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === 'dir' ? -1 : 1))
  }
  return walk(root, 0)
}

export const flatPaths = (tree: FileEntry[]): string[] =>
  tree.flatMap((e) => (e.type === 'dir' ? flatPaths(e.children ?? []) : [e.path]))

export const readText = async (projectId: string, rel: string): Promise<string> => {
  const full = safePath(projectId, rel)
  if ((await stat(full)).size > 2_000_000) throw new Error('Soubor je větší než 2 MB')
  return readFile(full, 'utf8')
}

export const writeText = async (projectId: string, rel: string, content: string) => {
  const full = safePath(projectId, rel)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

export const removeFile = (projectId: string, rel: string) => rm(safePath(projectId, rel), { force: true })

const git = (projectId: string, args: string[]) => run('git', args, { cwd: workspaceDir(projectId) })

export const ensureRepo = async (projectId: string) => {
  const dir = workspaceDir(projectId)
  await mkdir(dir, { recursive: true })
  if (existsSync(join(dir, '.git'))) return
  await git(projectId, ['init', '-q', '-b', 'main'])
  await writeText(projectId, '.gitignore', 'node_modules/\nbin/\nobj/\ndist/\n.aforge/test-output/\n.aforge/test-results.json\n')
  await commit(projectId, 'aForge: init workspace')
}

export const commit = async (projectId: string, message: string): Promise<string | null> => {
  await git(projectId, ['add', '-A'])
  const res = await git(projectId, [
    '-c', 'user.name=aForge',
    '-c', 'user.email=aforge@localhost',
    'commit', '-q', '-m', message,
  ])
  if (res.code !== 0) return null
  return (await git(projectId, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
}

export const history = async (projectId: string) => {
  const res = await git(projectId, ['log', '--pretty=format:%h\t%cI\t%s', '-n', '50'])
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, subject] = line.split('\t')
      return { hash: hash!, date: date!, subject: subject ?? '' }
    })
}

export const diffOf = async (projectId: string, hash: string) => {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new Error('Neplatný commit')
  return (await git(projectId, ['show', '--stat', '--patch', '--no-color', hash])).stdout
}
