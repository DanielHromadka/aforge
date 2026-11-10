// The generated application's working tree. Every path from the client goes through `safePath`, so
// nothing outside the project's workspace can be read or written.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FileEntry } from '@aforge/shared'
import { run } from '@aforge/runner'
import { assertWritable, repoDir } from './project-locations.js'
import { DETAILS_FORMAT, GRAPH_FORMAT, isHash, isRepoPath, parseDetails, parseGraphLog, parseNameStatus, parseWorkStatus } from './git.js'

const HIDDEN = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', '.vite', 'playwright-report', 'test-output'])

export const safePath = (projectId: string, rel: string, repo?: string): string => {
  const root = repoDir(projectId, repo)
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error('Cesta mimo pracovní adresář')
  if (relative(root, full).split(sep).includes('.git')) throw new Error('Metadata Git nelze upravovat přes editor.')
  // Check every existing ancestor: lexical checks alone allow a symlink into another project.
  const base = existsSync(root) ? realpathSync(root) : root
  let current = root
  for (const part of relative(root, full).split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolické odkazy nejsou v editoru povolené.')
      const actual = realpathSync(current)
      if (actual !== base && !actual.startsWith(base + sep)) throw new Error('Cesta mimo pracovní adresář.')
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  }
  return full
}

export const fileTree = async (projectId: string, repo?: string): Promise<FileEntry[]> => {
  const root = repoDir(projectId, repo)
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

export const readText = async (projectId: string, rel: string, repo?: string): Promise<string> => {
  const full = safePath(projectId, rel, repo)
  if ((await stat(full)).size > 2_000_000) throw new Error('Soubor je větší než 2 MB')
  return readFile(full, 'utf8')
}

export const writeText = async (projectId: string, rel: string, content: string, repo?: string) => {
  assertWritable(projectId)
  const full = safePath(projectId, rel, repo)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

export const removeFile = (projectId: string, rel: string, repo?: string) => { assertWritable(projectId); return rm(safePath(projectId, rel, repo), { force: true }) }

const git = (projectId: string, args: string[], repo?: string) => run('git', args, { cwd: repoDir(projectId, repo), env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })

export const ensureRepo = async (projectId: string, repo?: string) => {
  assertWritable(projectId)
  const dir = repoDir(projectId, repo)
  await mkdir(dir, { recursive: true })
  if (existsSync(join(dir, '.git'))) return
  await git(projectId, ['init', '-q', '-b', 'main'], repo)
  await writeText(projectId, '.gitignore', 'node_modules/\nbin/\nobj/\ndist/\n.aforge/test-output/\n.aforge/test-results.json\n', repo)
  await commit(projectId, 'Reactor: init workspace', repo)
}

export const commit = async (projectId: string, message: string, repo?: string): Promise<string | null> => {
  assertWritable(projectId)
  await git(projectId, ['add', '-A'], repo)
  const res = await git(projectId, [
    '-c', 'user.name=Reactor',
    '-c', 'user.email=aforge@localhost',
    'commit', '-q', '-m', message,
  ], repo)
  if (res.code !== 0) return null
  return (await git(projectId, ['rev-parse', '--short', 'HEAD'], repo)).stdout.trim()
}

export const headHash = async (projectId: string, repo?: string) => (await git(projectId, ['rev-parse', 'HEAD'], repo)).stdout.trim()

/** Files changed between two commits, with line counts, for a task's review. */
export const changedFiles = async (projectId: string, from: string, repo?: string) => {
  if (!isHash(from)) return []
  const res = await git(projectId, ['-c', 'core.quotepath=off', 'diff', '--numstat', from, 'HEAD', '--', '.', ':(exclude)AFORGE_SPEC.md', ':(exclude).aforge'], repo)
  return res.stdout.split('\n').filter(Boolean).map((line) => {
    const [added = '0', removed = '0', ...path] = line.split('\t')
    return { path: path.join('\t'), added: Number(added) || 0, removed: Number(removed) || 0 }
  })
}

export const history = async (projectId: string, repo?: string) => {
  const res = await git(projectId, ['log', '--pretty=format:%h\t%cI\t%s', '-n', '50'], repo)
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, subject] = line.split('\t')
      return { hash: hash!, date: date!, subject: subject ?? '' }
    })
}

export const diffOf = async (projectId: string, hash: string, repo?: string) => {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new Error('Neplatný commit')
  return (await git(projectId, ['show', '--stat', '--patch', '--no-color', hash], repo)).stdout
}

// ---- Git view: graph, commit details, work tree, file diffs ----------------------------------

/** The newest commits of all refs in topo order, so children always precede parents for the lanes. */
export const graphLog = async (projectId: string, limit = 500, repo?: string) => {
  const n = String(Math.min(5000, Math.max(1, Math.floor(limit) || 500)))
  // A repository without commits has nothing to show; git then fails and the list is empty.
  const res = await git(projectId, ['--no-optional-locks', 'log', '--all', '--topo-order', '-n', n, `--format=${GRAPH_FORMAT}`, '--'], repo)
  return res.code === 0 ? parseGraphLog(res.stdout) : []
}

export const workStatus = async (projectId: string, repo?: string) =>
  parseWorkStatus((await git(projectId, ['--no-optional-locks', '-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-z', '-b', '-uall'], repo)).stdout)

export const commitDetails = async (projectId: string, hash: string, repo?: string) => {
  if (!isHash(hash)) throw new Error('Neplatný commit')
  const head = await git(projectId, ['--no-optional-locks', 'show', '-s', `--format=${DETAILS_FORMAT}`, hash], repo)
  if (head.code !== 0) throw new Error('Commit nenalezen')
  const parents = head.stdout.split('\x1f')[1]?.split(' ').filter(Boolean) ?? []
  // Merges against their first parent, as most history views do; a root commit against nothing.
  const files = await git(projectId, parents[0]
    ? ['-c', 'core.quotepath=off', '--no-optional-locks', 'diff', '--name-status', '-z', '-M', parents[0], hash]
    : ['-c', 'core.quotepath=off', '--no-optional-locks', 'diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '-z', '-M', hash], repo)
  return parseDetails(head.stdout, parseNameStatus(files.stdout))
}

const MAX_DIFF = 2_000_000

/** Both versions of one file: a commit against its first parent, or (no hash) HEAD against the work tree. */
export const fileDiff = async (projectId: string, path: string, hash?: string, from?: string, repo?: string) => {
  if (!isRepoPath(path) || (from !== undefined && !isRepoPath(from))) throw new Error('Neplatná cesta')
  if (hash !== undefined && !isHash(hash)) throw new Error('Neplatný commit')
  const show = async (spec: string) => {
    const r = await git(projectId, ['--no-optional-locks', 'show', spec], repo)
    return r.code === 0 ? r.stdout : null
  }
  const old = from ?? path
  let sides: [string | null, string | null]
  if (hash) {
    const parent = (await git(projectId, ['rev-list', '--parents', '-n', '1', hash], repo)).stdout.trim().split(' ')[1]
    sides = await Promise.all([parent ? show(`${parent}:${old}`) : null, show(`${hash}:${path}`)])
  } else sides = await Promise.all([show(`HEAD:${old}`), readFile(safePath(projectId, path, repo), 'utf8').catch(() => null)])
  const tooLarge = sides.some((s) => s !== null && s.length > MAX_DIFF)
  const binary = !tooLarge && sides.some((s) => s !== null && s.slice(0, 8000).includes('\0'))
  const text = (s: string | null) => (s && !tooLarge && !binary ? s : '')
  return { original: text(sides[0]), modified: text(sides[1]), binary, tooLarge }
}

/** Both versions of one file between two commits: what a task's run changed in it. */
export const rangeDiff = async (projectId: string, path: string, from: string, to: string, repo?: string) => {
  if (!isRepoPath(path) || !isHash(from) || !isHash(to)) throw new Error('Neplatná cesta nebo commit')
  const show = async (spec: string) => {
    const r = await git(projectId, ['--no-optional-locks', 'show', spec], repo)
    return r.code === 0 ? r.stdout : null
  }
  const sides = await Promise.all([show(`${from}:${path}`), show(`${to}:${path}`)])
  const tooLarge = sides.some((x) => x !== null && x.length > MAX_DIFF)
  const binary = !tooLarge && sides.some((x) => x !== null && x.slice(0, 8000).includes('\0'))
  const text = (x: string | null) => (x && !tooLarge && !binary ? x : '')
  return { original: text(sides[0]), modified: text(sides[1]), binary, tooLarge }
}

/** The run of a task found in the history, for tasks finished before their commits were recorded. */
export const issueCommits = async (projectId: string, issueId: string, repo?: string) => {
  const log = await git(projectId, ['log', '--format=%H%x1f%s', '-n', '400'], repo)
  const rows = log.stdout.split('\n').filter(Boolean).map((l) => l.split('\x1f') as [string, string])
  const head = rows.find(([, subject]) => subject.startsWith(`${issueId} `))
  // Runs from before the rename have the old product name in the subject.
  const spec = rows.find(([, subject]) => subject === `Reactor: specifikace pro ${issueId}` || subject === `aForge: specifikace pro ${issueId}`)
  return head && spec ? { base: spec[0], head: head[0] } : undefined
}
