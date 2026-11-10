// Git view of the Code stage, modelled on aFinder's GitGraphDialog: the commit graph of all branches with
// the work tree on top, a commit's message and files, and the file diff in Monaco's diff editor.
import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { api } from '../api'
import { darkMode, languageOf } from '../monaco'
import {
  formatRelative, layoutGraph, refBadges, STATE_LABEL, STATE_LETTER, withWorkTree, WORKTREE,
  type CommitDetails, type GitChange, type GraphCommit, type GraphRow, type WorkStatus,
} from '../gitGraph'

const ROW = 26
const LANE = 14
/** Wider graphs are clipped rather than squeezing the subjects. */
const MAX_LANES = 16
const LANE_COLORS = 8
const color = (lane: number) => `var(--git-lane-${lane % LANE_COLORS})`
const x = (lane: number) => LANE / 2 + 1 + lane * LANE

interface FileDiff { original: string; modified: string; binary: boolean; tooLarge: boolean }

/** Lines and the dot of one row; curves where a lane joins or leaves the dot. */
const GraphCell = ({ row, width }: { row: GraphRow; width: number }) => {
  const { lane } = row
  const mid = ROW / 2
  const work = row.commit.hash === WORKTREE
  const merge = row.commit.parents.length > 1
  return (
    <svg className="git-cell" width={width * LANE + 2} height={ROW} aria-hidden>
      {row.through.map((i) => <line key={`t${i}`} x1={x(i)} y1={0} x2={x(i)} y2={ROW} style={{ stroke: color(i) }} />)}
      {row.joins.map((i) => (
        <path key={`j${i}`} d={`M${x(i)} 0 C${x(i)} ${mid * 0.7} ${x(lane)} ${mid * 0.4} ${x(lane)} ${mid}`} style={{ stroke: color(i) }} />
      ))}
      {row.parents.map((i) => (
        <path key={`p${i}`} d={`M${x(lane)} ${mid} C${x(lane)} ${mid * 1.6} ${x(i)} ${mid * 1.3} ${x(i)} ${ROW}`} style={{ stroke: color(i) }} strokeDasharray={work ? '2 2' : undefined} />
      ))}
      <circle
        cx={x(lane)} cy={mid} r={merge ? 3.5 : 4}
        className={work || merge ? 'hollow' : undefined}
        style={{ stroke: color(lane), fill: work || merge ? undefined : color(lane) }}
        strokeDasharray={work ? '2 1.5' : undefined}
      />
    </svg>
  )
}

const FileRow = ({ f, active, onClick }: { f: GitChange; active: boolean; onClick: () => void }) => {
  const slash = f.path.lastIndexOf('/')
  return (
    <div className={`git-file ${f.state} ${active ? 'current' : ''}`} title={f.from ? `${f.from} → ${f.path}` : f.path} onClick={onClick}>
      <span className="git-file-name">{f.path.slice(slash + 1)}</span>
      <span className="git-file-dir">{slash > 0 ? f.path.slice(0, slash) : ''}</span>
      <span className="git-state" title={STATE_LABEL[f.state]}>{STATE_LETTER[f.state]}</span>
    </div>
  )
}

export const GitView = ({ pid, repo = 'main', nonce, toast }: { pid: string; repo?: string; nonce: number; toast: (text: string, error?: boolean) => void }) => {
  const [data, setData] = useState<{ commits: GraphCommit[]; status: WorkStatus } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [file, setFile] = useState<GitChange | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    api<{ commits: GraphCommit[]; status: WorkStatus }>(`/projects/${pid}/git/graph?repo=${encodeURIComponent(repo)}`).then(
      (d) => live && setData(d),
      (e: Error) => live && (toast(e.message, true), setData({ commits: [], status: { branch: null, files: [] } })),
    )
    return () => {
      live = false
    }
  }, [pid, repo, nonce, toast])

  const rows = useMemo(() => layoutGraph(withWorkTree(data?.commits ?? [], data?.status ?? null)), [data])
  const lanes = Math.min(MAX_LANES, Math.max(1, ...rows.map((r) => r.width)))

  // A refresh keeps the selection while that commit (or a dirty work tree) is still listed.
  useEffect(() => {
    if (selected && data && !rows.some((r) => r.commit.hash === selected)) setSelected(null)
  }, [rows, data, selected])

  useEffect(() => {
    setDetails(null)
    setFile(null)
    if (!selected) return
    if (selected === WORKTREE) {
      setDetails({ hash: WORKTREE, parents: [], author: '', email: '', time: Date.now(), message: 'Necommitnuté změny v pracovním adresáři', files: data?.status.files ?? [] })
      return
    }
    let live = true
    api<CommitDetails>(`/projects/${pid}/git/commit/${selected}?repo=${encodeURIComponent(repo)}`).then((d) => live && setDetails(d), (e: Error) => live && toast(e.message, true))
    return () => {
      live = false
    }
    // `data` changes on every refresh, which also reloads the details (and the work tree's file list).
  }, [pid, repo, selected, data, toast])

  useEffect(() => {
    setDiff(null)
    if (!file || !details) return
    const q = new URLSearchParams({ path: file.path })
    if (details.hash !== WORKTREE) q.set('hash', details.hash)
    if (file.from) q.set('from', file.from)
    let live = true
    api<FileDiff>(`/projects/${pid}/git/diff?${q}&repo=${encodeURIComponent(repo)}`).then((d) => live && setDiff(d), (e: Error) => live && toast(e.message, true))
    return () => {
      live = false
    }
  }, [pid, repo, file, details, toast])

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.findIndex((r) => r.commit.hash === selected)
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    setSelected(next.commit.hash)
    list.current?.querySelector(`[data-hash="${next.commit.hash}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const short = (h: string) => data?.commits.find((c) => c.hash === h)?.short ?? h.slice(0, 7)

  return (
    <div className={`git-view ${selected ? 'with-details' : ''}`}>
      <div className="git-list" ref={list} tabIndex={0} onKeyDown={move}>
        <div className="git-head" style={{ gridTemplateColumns: `${Math.max(lanes * LANE + 2, 36)}px minmax(0, 1fr) 140px 120px 70px` }}>
          <div>Graf</div>
          <div>Popis</div>
          <div>Autor</div>
          <div>Kdy</div>
          <div>Commit</div>
        </div>
        {data && rows.length === 0 && <div className="empty">Repozitář zatím nemá žádný commit.</div>}
        {!data && <div className="empty">Načítám historii…</div>}
        {rows.map((row) => {
          const c = row.commit
          const work = c.hash === WORKTREE
          return (
            <div
              key={c.hash}
              data-hash={c.hash}
              className={`git-row ${c.hash === selected ? 'selected' : ''} ${work ? 'work' : ''}`}
              style={{ gridTemplateColumns: `${Math.max(lanes * LANE + 2, 36)}px minmax(0, 1fr) 140px 120px 70px` }}
              title={work ? undefined : `${c.hash}\n${c.author}`}
              onClick={() => setSelected(c.hash)}
            >
              <span className="git-lanes"><GraphCell row={row} width={Math.max(lanes, row.width)} /></span>
              <span className="git-subject">
                {refBadges(c.refs).map((b) => <span key={`${b.kind}:${b.label}`} className={`git-ref ${b.kind}`}>{b.label}</span>)}
                {c.subject}
              </span>
              <span className="git-author">{c.author}</span>
              <span className="git-when" title={work ? undefined : new Date(c.time).toLocaleString('cs')}>{work ? '' : formatRelative(c.time)}</span>
              <span className="git-hash">{c.short}</span>
            </div>
          )
        })}
      </div>
      {selected && (
        <div className="git-details">
          <div className="git-side">
            {!details ? (
              <div className="muted" style={{ padding: 12 }}>Načítám…</div>
            ) : (
              <>
                <div className="git-meta">
                  <pre className="git-message">{details.message}</pre>
                  {details.hash !== WORKTREE && (
                    <>
                      <div className="muted">{details.author} &lt;{details.email}&gt; · {new Date(details.time).toLocaleString('cs')}</div>
                      <div className="git-hashes">
                        <button className="btn mono" title="Zkopírovat hash" onClick={() => void navigator.clipboard.writeText(details.hash).then(() => toast('Hash zkopírován'))}>
                          {details.hash.slice(0, 12)} ⧉
                        </button>
                        {details.parents.length > 0 && (
                          <span className="muted">
                            {details.parents.length > 1 ? 'Rodiče' : 'Rodič'}:{' '}
                            {details.parents.map((p) => <a key={p} className="mono" onClick={() => setSelected(p)}>{short(p)} </a>)}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="git-files-head">
                  Změněné soubory <span className="chip gray">{details.files.length}</span>
                </div>
                <div className="git-files">
                  {details.files.map((f) => <FileRow key={f.path} f={f} active={file?.path === f.path} onClick={() => setFile(f)} />)}
                </div>
              </>
            )}
          </div>
          <div className="git-diff">
            {!file ? (
              <div className="empty">Vyberte soubor a zobrazí se jeho změny.</div>
            ) : !diff ? (
              <div className="empty">Načítám diff…</div>
            ) : diff.binary || diff.tooLarge ? (
              <div className="empty">{diff.binary ? 'Binární soubor – rozdíl nelze zobrazit.' : 'Soubor je příliš velký na zobrazení rozdílu.'}</div>
            ) : (
              <DiffEditor
                keepCurrentOriginalModel
                keepCurrentModifiedModel
                key={`${details?.hash}:${file.path}`}
                theme={darkMode() ? 'vs-dark' : 'vs'}
                language={languageOf(file.path)}
                original={diff.original}
                modified={diff.modified}
                options={{ readOnly: true, originalEditable: false, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true, renderOverviewRuler: false }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
