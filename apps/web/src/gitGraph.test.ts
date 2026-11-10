import { describe, expect, it } from 'vitest'
import { formatRelative, layoutGraph, refBadges, withWorkTree, WORKTREE, type GraphCommit } from './gitGraph'

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, short: hash, parents, subject: hash, author: 'a', time: 0, refs: [] })

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.width)).toEqual([1, 1, 1])
    expect(rows[1]!.joins).toEqual([0])
    expect(rows[2]!.parents).toEqual([])
  })

  it('opens a lane for a merged branch and joins it at the fork point', () => {
    // m merges f into the line d → b; f branched off b.
    const [m, f, d, b, a] = layoutGraph([c('m', 'd', 'f'), c('f', 'b'), c('d', 'b'), c('b', 'a'), c('a')])
    expect(m!.parents).toEqual([0, 1])
    expect(f!.lane).toBe(1)
    expect(f!.through).toEqual([0])
    expect(d!.lane).toBe(0)
    expect(d!.through).toEqual([1])
    expect(b!.lane).toBe(0)
    expect(b!.joins).toEqual([0, 1])
    expect(b!.width).toBe(2)
    expect(a!.width).toBe(1)
  })

  it('gives unrelated branch tips their own lanes', () => {
    const rows = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')])
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0])
    expect(rows[2]!.joins).toEqual([0, 1])
  })

  it('lets a second parent join a lane already waiting for it', () => {
    const rows = layoutGraph([c('t', 'a'), c('m', 'b', 'a'), c('b', 'a'), c('a')])
    expect(rows[1]!.parents).toEqual([1, 0])
  })
})

describe('withWorkTree', () => {
  it('adds a row above HEAD only when the tree is dirty', () => {
    const log = [{ ...c('x', 'b'), refs: ['feature'] }, { ...c('b', 'a'), refs: ['HEAD -> main'] }, c('a')]
    expect(withWorkTree(log, { branch: 'main', files: [] })).toBe(log)
    const rows = layoutGraph(withWorkTree(log, { branch: 'main', files: [{ path: 'a', state: 'modified' }, { path: 'b', state: 'added' }] }, 0))
    expect(rows[0]!.commit).toMatchObject({ hash: WORKTREE, parents: ['b'], subject: 'Pracovní změny (2 soubory)' })
    // HEAD continues the work tree's lane, the other tip moves aside.
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0])
  })
})

describe('refBadges', () => {
  it('splits HEAD, tags and remotes', () => {
    expect(refBadges(['HEAD -> main', 'origin/main', 'origin/HEAD', 'tag: v1'])).toEqual([
      { label: 'HEAD', kind: 'head' },
      { label: 'main', kind: 'local' },
      { label: 'origin/main', kind: 'remote' },
      { label: 'v1', kind: 'tag' },
    ])
  })
})

describe('formatRelative', () => {
  it('speaks Czech', () => {
    const now = 1_000_000_000_000
    expect(formatRelative(now - 5 * 60_000, now)).toBe('před 5 minutami')
    expect(formatRelative(now - 86_400_000, now)).toBe('včera')
  })
})
