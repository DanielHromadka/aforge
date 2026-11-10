// Advanced view: the generated workspace as a Finder-like tree with Monaco to read and edit, or the Git
// view with the commit graph of builds and accepted agent changes.
import { useCallback, useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { FileEntry } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { reposOf } from '@aforge/shared'
import { useStudio } from '../studio'
import { darkMode, languageOf } from '../monaco'
import { GitView } from './GitView'

const TreeRows = ({ entries, depth, open, toggle, current, select }: {
  entries: FileEntry[]
  depth: number
  open: Set<string>
  toggle: (p: string) => void
  current?: string
  select: (p: string) => void
}) => (
  <>
    {entries.map((e) => (
      <div key={e.path}>
        <div
          className={`tree-row ${current === e.path ? 'current' : ''}`}
          style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => (e.type === 'dir' ? toggle(e.path) : select(e.path))}
        >
          <span className={`chev ${open.has(e.path) ? 'open' : ''}`}>{e.type === 'dir' ? '▶' : ''}</span>
          <span style={{ color: e.type === 'dir' ? 'var(--accent)' : 'var(--label-2)', display: 'flex' }}>{e.type === 'dir' ? <Icon.folder /> : <Icon.file />}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.path.split('/').pop()}</span>
        </div>
        {e.type === 'dir' && open.has(e.path) && <TreeRows entries={e.children ?? []} depth={depth + 1} open={open} toggle={toggle} current={current} select={select} />}
      </div>
    ))}
  </>
)

export const CodeStage = () => {
  const s = useStudio()
  const pid = s.project.id
  const repos = reposOf(s.project)
  const [repo, setRepo] = useState(() => repos[0]!.id)
  const q = `repo=${encodeURIComponent(repo)}`
  const [tree, setTree] = useState<FileEntry[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [content, setContent] = useState<string>('')
  const [saved, setSaved] = useState<string>('')
  const [mode, setMode] = useState<'files' | 'git'>('files')
  const [nonce, setNonce] = useState(0)
  const path = s.focus.filePath

  const refresh = useCallback(async () => {
    setTree(await api<FileEntry[]>(`/projects/${pid}/files?${q}`))
    setNonce((n) => n + 1)
  }, [pid, q])

  useEffect(() => {
    void refresh()
  }, [refresh, s.building])

  useEffect(() => {
    if (!path) return
    api<{ content: string }>(`/projects/${pid}/file?path=${encodeURIComponent(path)}&${q}`)
      .then((r) => {
        setContent(r.content)
        setSaved(r.content)
      })
      .catch((e: Error) => s.toast(e.message, true))
  }, [path, pid, q, s.toast])

  const dirty = content !== saved

  const save = useCallback(async () => {
    if (s.readOnly || !path || !dirty) return
    await api(`/projects/${pid}/file?${q}`, { method: 'PUT', body: { path, content } })
    setSaved(content)
  }, [path, dirty, pid, q, content, s.readOnly])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const theme = darkMode() ? 'vs-dark' : 'vs'

  return (
    <>
      <div className="pane-bar">
        <h2>Kód</h2>
        {repos.length > 1 && <select className="field" style={{ width: 'auto' }} aria-label="Repozitář" value={repo} onChange={(e) => { setRepo(e.target.value); s.setFocus({ ...s.focus, filePath: undefined }) }}>
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>}
        <div className="segmented">
          <button className={mode === 'files' ? 'active' : ''} onClick={() => setMode('files')}>Soubory</button>
          <button className={mode === 'git' ? 'active' : ''} onClick={() => setMode('git')}>Git</button>
        </div>
        {mode === 'files' && <span className="muted mono">{path ?? 'Vyberte soubor'}</span>}
        {dirty && <span className="chip orange">Neuloženo</span>}
        <span className="spacer" />
        <button className="tool-btn" onClick={() => void refresh()} title="Obnovit">
          <Icon.refresh />
        </button>
        {mode === 'files' && (
          <button className="btn" disabled={s.readOnly || !dirty} onClick={() => void save()}>
            Uložit ⌘S
          </button>
        )}
        <button
          className="btn"
          disabled={s.readOnly}
          onClick={async () => {
            const r = await api<{ hash: string | null }>(`/projects/${pid}/commit?${q}`, { body: {} })
            s.toast(r.hash ? `Commit ${r.hash}` : 'Žádné změny ke commitu')
            void refresh()
          }}
        >
          Commit
        </button>
        {mode === 'files' && <button className="btn" disabled={s.readOnly || !path} onClick={() => void s.askAgent({ text: `Projdi soubor ${path}: odpovídá stories a konvencím projektu? Navrhni případné opravy.` })}>
          <Icon.sparkles /> Revize agentem
        </button>}
      </div>
      {mode === 'git' ? <GitView pid={pid} repo={repo} nonce={nonce} toast={s.toast} /> : (
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', flex: 1, minHeight: 0 }}>
        <div className="tree">
          {tree.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>
              Repozitář je zatím prázdný.
            </div>
          ) : (
            <TreeRows
              entries={tree}
              depth={0}
              open={open}
              current={path}
              toggle={(p) => setOpen((o) => (o.has(p) ? new Set([...o].filter((x) => x !== p)) : new Set([...o, p])))}
              select={(p) => s.setFocus({ ...s.focus, filePath: p })}
            />
          )}
        </div>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          {path ? (
            <Editor
              theme={theme}
              path={`${pid}/${repo}/${path}`}
              language={languageOf(path)}
              value={content}
              onChange={(v) => setContent(v ?? '')}
              options={{ readOnly: s.readOnly, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }}
            />
          ) : (
            <div className="empty">Vyberte soubor ve stromu vlevo.</div>
          )}
        </div>
      </div>
      )}
    </>
  )
}
