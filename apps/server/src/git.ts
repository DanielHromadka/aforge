// Pure parsers of git output for the Git view in the Code stage (ported from aFinder's shared/git.ts).
// Fields are separated by \x1f and records by \x1e so subjects with tabs or newlines cannot break them.

export type GitState = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitChange {
  path: string
  /** Original path of a rename or copy. */
  from?: string
  state: GitState
}

export interface GraphCommit {
  hash: string
  short: string
  parents: string[]
  subject: string
  author: string
  /** Commit time, ms since the epoch. */
  time: number
  /** Decorations: "HEAD -> main", "origin/main", "tag: v1.0". */
  refs: string[]
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  time: number
  message: string
  /** Changes against the first parent (everything for a root commit). */
  files: GitChange[]
}

export interface WorkStatus {
  branch: string | null
  files: GitChange[]
}

export const GRAPH_FORMAT = '%H%x1f%P%x1f%h%x1f%s%x1f%an%x1f%at%x1f%D%x1e'
export const DETAILS_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B'

const records = (out: string) => out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean)

/** Parses `git log --format=GRAPH_FORMAT`. */
export const parseGraphLog = (out: string): GraphCommit[] =>
  records(out).map((rec) => {
    const [hash = '', parents = '', short = '', subject = '', author = '', at = '0', refs = ''] = rec.split('\x1f')
    return { hash, short, parents: parents ? parents.split(' ') : [], subject, author, time: Number(at) * 1000, refs: refs ? refs.split(', ').filter(Boolean) : [] }
  })

/** Parses `git show -s --format=DETAILS_FORMAT` (the body may itself contain anything but \x1f). */
export const parseDetails = (out: string, files: GitChange[]): CommitDetails => {
  const [hash = '', parents = '', author = '', email = '', at = '0', ...message] = out.split('\x1f')
  return { hash: hash.trim(), parents: parents ? parents.split(' ') : [], author, email, time: Number(at) * 1000, message: message.join('\x1f').trim(), files }
}

/** Parses `git diff --name-status -z` / `diff-tree`: status, path and, for renames and copies, the new path. */
export const parseNameStatus = (out: string): GitChange[] => {
  const parts = out.split('\0').filter((p) => p !== '')
  const files: GitChange[] = []
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++]!
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[i++]!
      files.push({ path: parts[i++]!, from, state: 'renamed' })
    } else files.push({ path: parts[i++]!, state: code[0] === 'A' ? 'added' : code[0] === 'D' ? 'deleted' : 'modified' })
  }
  return files
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

const stateOf = (xy: string): GitState =>
  xy === '??' ? 'untracked'
  : CONFLICT.has(xy) ? 'conflict'
  : xy.includes('R') || xy.includes('C') ? 'renamed'
  : xy.includes('A') ? 'added'
  : xy.includes('D') ? 'deleted'
  : 'modified'

/** Parses `git status --porcelain=v1 -z -b -uall`; with -z a rename lists the new path, then the old one. */
export const parseWorkStatus = (out: string): WorkStatus => {
  const result: WorkStatus = { branch: null, files: [] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.startsWith('## ')) {
      const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.\S+)?(?: \[.+\])?$/.exec(part.slice(3))
      if (m) result.branch = m[1] === 'HEAD (no branch)' ? null : m[1]!
      continue
    }
    if (part.length < 4) continue
    const xy = part.slice(0, 2)
    const change: GitChange = { path: part.slice(3), state: stateOf(xy) }
    if (xy.includes('R') || xy.includes('C')) change.from = parts[++i]
    if (xy !== '!!') result.files.push(change)
  }
  return result
}

/** A relative path from the client that may be handed to git after a revision or `--`. */
export const isRepoPath = (p: unknown): p is string =>
  typeof p === 'string' && p.length > 0 && p.length < 4096 && !p.startsWith('/') && !p.startsWith('-') && !p.includes('\0') && !p.split(/[\\/]/).includes('..')

export const isHash = (h: unknown): h is string => typeof h === 'string' && /^[0-9a-f]{4,64}$/i.test(h)
