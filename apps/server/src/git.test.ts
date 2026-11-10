import { describe, expect, it } from 'vitest'
import { isHash, isRepoPath, parseDetails, parseGraphLog, parseNameStatus, parseWorkStatus } from './git.js'

describe('parseGraphLog', () => {
  it('reads parents and decorations', () => {
    const [first, root] = parseGraphLog('aaa\x1fbbb ccc\x1fa\x1fMerge\x1fAda\x1f10\x1fHEAD -> main, origin/main, tag: v1\x1e\nbbb\x1f\x1fb\x1fInit\x1fAda\x1f5\x1f\x1e')
    expect(first!.parents).toEqual(['bbb', 'ccc'])
    expect(first!.refs).toEqual(['HEAD -> main', 'origin/main', 'tag: v1'])
    expect(first!.time).toBe(10000)
    expect(root!.parents).toEqual([])
    expect(root!.refs).toEqual([])
  })
  it('returns nothing for an empty repository', () => expect(parseGraphLog('')).toEqual([]))
})

describe('parseDetails', () => {
  it('keeps the whole message', () => {
    const d = parseDetails('abc\x1fp1 p2\x1fAda\x1fada@x\x1f7\x1fSubject\n\nBody\n', [])
    expect(d).toEqual({ hash: 'abc', parents: ['p1', 'p2'], author: 'Ada', email: 'ada@x', time: 7000, message: 'Subject\n\nBody', files: [] })
  })
})

describe('parseNameStatus', () => {
  it('reads plain changes and renames', () => {
    expect(parseNameStatus('M\0a.txt\0R087\0old name.txt\0new name.txt\0A\0dir/b.ts\0D\0c\0')).toEqual([
      { path: 'a.txt', state: 'modified' },
      { path: 'new name.txt', from: 'old name.txt', state: 'renamed' },
      { path: 'dir/b.ts', state: 'added' },
      { path: 'c', state: 'deleted' },
    ])
  })
})

describe('parseWorkStatus', () => {
  it('reads the branch, changes, renames and untracked files', () => {
    const s = parseWorkStatus('## main...origin/main [ahead 1]\0 M src/a.ts\0R  new.ts\0old.ts\0?? notes.md\0D  gone.ts\0UU c.ts\0')
    expect(s.branch).toBe('main')
    expect(s.files).toEqual([
      { path: 'src/a.ts', state: 'modified' },
      { path: 'new.ts', from: 'old.ts', state: 'renamed' },
      { path: 'notes.md', state: 'untracked' },
      { path: 'gone.ts', state: 'deleted' },
      { path: 'c.ts', state: 'conflict' },
    ])
  })
  it('handles a fresh repository and a detached HEAD', () => {
    expect(parseWorkStatus('## No commits yet on main\0')).toEqual({ branch: 'main', files: [] })
    expect(parseWorkStatus('## HEAD (no branch)\0').branch).toBeNull()
  })
})

describe('guards', () => {
  it('rejects paths and hashes git could misread', () => {
    expect(isRepoPath('src/a.ts')).toBe(true)
    expect(['', '/etc/passwd', '../x', 'a/../../b', '--output=x'].some(isRepoPath)).toBe(false)
    expect(isHash('abc1234')).toBe(true)
    expect(isHash('HEAD~1')).toBe(false)
  })
})
