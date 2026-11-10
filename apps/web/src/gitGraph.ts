// Lane layout of the commit graph (ported from aFinder's shared/git.ts) plus the small pure helpers of
// the Git view. The response types mirror apps/server/src/git.ts.

export type GitState = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'
export interface GitChange { path: string; from?: string; state: GitState }
export interface GraphCommit { hash: string; short: string; parents: string[]; subject: string; author: string; time: number; refs: string[] }
export interface CommitDetails { hash: string; parents: string[]; author: string; email: string; time: number; message: string; files: GitChange[] }
export interface WorkStatus { branch: string | null; files: GitChange[] }

/** Pseudo hash of the "Pracovní změny" row above HEAD. */
export const WORKTREE = 'worktree'

/** One row of the graph: where the dot sits and which lines pass, join and leave it. */
export interface GraphRow {
  commit: GraphCommit
  lane: number
  /** Lanes passing the row untouched. */
  through: number[]
  /** Lanes ending in the dot from above (children of this commit). */
  joins: number[]
  /** Lanes leaving the dot downwards, one per parent. */
  parents: number[]
  /** Lanes in use at this row. */
  width: number
}

/**
 * Lanes for `git log --topo-order`, like `git log --graph`: each lane waits for one commit; a commit takes
 * the leftmost lane waiting for it, its first parent continues there, further parents get a free lane (or
 * join a lane already waiting for them). Lanes never move sideways, so lines stay straight except where
 * they join or leave a dot.
 */
export const layoutGraph = (commits: GraphCommit[]): GraphRow[] => {
  const lanes: (string | null)[] = []
  const free = () => {
    const i = lanes.indexOf(null)
    return i >= 0 ? i : lanes.push(null) - 1
  }
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash)
    const joins: number[] = []
    lanes.forEach((h, i) => h === commit.hash && joins.push(i))
    if (lane < 0) lane = free()
    const through = lanes.flatMap((h, i) => (h !== null && h !== commit.hash ? [i] : []))
    for (const i of joins) lanes[i] = null
    const parents: number[] = []
    commit.parents.forEach((parent, n) => {
      // The first parent always continues the commit's lane (both lanes then join where it appears);
      // a merged parent joins a lane already waiting for it instead of opening another.
      const waiting = n === 0 ? -1 : lanes.indexOf(parent)
      if (waiting >= 0) return void parents.push(waiting)
      const target = n === 0 ? lane : free()
      lanes[target] = parent
      parents.push(target)
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    return { commit, lane, through, joins, parents, width: Math.max(lanes.length, lane + 1, ...through.map((i) => i + 1), ...joins.map((i) => i + 1)) }
  })
}

/** The commit HEAD points at, from the decorations of `git log --all`. */
export const headOf = (commits: GraphCommit[]) => commits.find((c) => c.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD -> ')))

/** Puts a pseudo commit for uncommitted changes on top, as a child of HEAD, so it gets HEAD's lane. */
export const withWorkTree = (commits: GraphCommit[], status: WorkStatus | null, now = Date.now()): GraphCommit[] => {
  if (!status?.files.length) return commits
  const head = headOf(commits)
  const n = status.files.length
  const subject = `Pracovní změny (${n} ${n === 1 ? 'soubor' : n < 5 ? 'soubory' : 'souborů'})`
  return [{ hash: WORKTREE, short: '', parents: head ? [head.hash] : [], subject, author: '', time: now, refs: [] }, ...commits]
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

/** "HEAD -> main" → HEAD + main, "tag: v1" → a tag; names with a slash count as remote branches. */
export const refBadges = (refs: string[]): { label: string; kind: RefKind }[] =>
  refs.flatMap((r): { label: string; kind: RefKind }[] => {
    if (r.startsWith('HEAD -> ')) return [{ label: 'HEAD', kind: 'head' }, { label: r.slice(8), kind: 'local' }]
    if (r === 'HEAD') return [{ label: 'HEAD', kind: 'head' }]
    if (r.startsWith('tag: ')) return [{ label: r.slice(5), kind: 'tag' }]
    if (r.endsWith('/HEAD')) return []
    return [{ label: r, kind: r.includes('/') ? 'remote' : 'local' }]
  })

const rtf = new Intl.RelativeTimeFormat('cs', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]]

/** "před 5 minutami", "včera", "před 3 měsíci". */
export const formatRelative = (time: number, now = Date.now()) => {
  let v = (time - now) / 1000
  for (const [unit, size] of STEPS) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit)
    v /= size
  }
  return ''
}

export const STATE_LETTER: Record<GitState, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }
export const STATE_LABEL: Record<GitState, string> = { added: 'Přidán', modified: 'Změněn', deleted: 'Smazán', renamed: 'Přejmenován', untracked: 'Nesledován', conflict: 'Konflikt' }
