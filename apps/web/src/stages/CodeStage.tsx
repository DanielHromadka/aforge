// Advanced view: the generated workspace as a Finder-like tree, Monaco to read and edit, and the git
// history of builds and accepted agent changes.
import { useCallback, useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { FileEntry } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { darkMode, languageOf } from '../monaco'

interface Commit {
  hash: string
  date: string
  subject: string
}

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
  const [tree, setTree] = useState<FileEntry[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [content, setContent] = useState<string>('')
  const [saved, setSaved] = useState<string>('')
  const [history, setHistory] = useState<Commit[]>([])
  const [diff, setDiff] = useState<{ hash: string; text: string } | null>(null)
  const path = s.focus.filePath

  const refresh = useCallback(async () => {
    setTree(await api<FileEntry[]>(`/projects/${pid}/files`))
    setHistory(await api<Commit[]>(`/projects/${pid}/history`))
  }, [pid])

  useEffect(() => {
    void refresh()
  }, [refresh, s.building])

  useEffect(() => {
    if (!path) return
    setDiff(null)
    api<{ content: string }>(`/projects/${pid}/file?path=${encodeURIComponent(path)}`)
      .then((r) => {
        setContent(r.content)
        setSaved(r.content)
      })
      .catch((e: Error) => s.toast(e.message, true))
  }, [path, pid, s.toast])

  const dirty = content !== saved

  const save = useCallback(async () => {
    if (!path || !dirty) return
    await api(`/projects/${pid}/file`, { method: 'PUT', body: { path, content } })
    setSaved(content)
  }, [path, dirty, pid, content])

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
        <span className="muted mono">{diff ? `commit ${diff.hash}` : (path ?? 'Vyberte soubor')}</span>
        {dirty && <span className="chip orange">Neuloženo</span>}
        <span className="spacer" />
        <button className="tool-btn" onClick={() => void refresh()} title="Obnovit">
          <Icon.refresh />
        </button>
        <button className="btn" disabled={!dirty} onClick={() => void save()}>
          Uložit ⌘S
        </button>
        <button
          className="btn"
          onClick={async () => {
            const r = await api<{ hash: string | null }>(`/projects/${pid}/commit`, { body: {} })
            s.toast(r.hash ? `Commit ${r.hash}` : 'Žádné změny ke commitu')
            void refresh()
          }}
        >
          Commit
        </button>
        <button className="btn" disabled={!path} onClick={() => void s.askAgent({ text: `Projdi soubor ${path}: odpovídá stories a konvencím projektu? Navrhni případné opravy.` })}>
          <Icon.sparkles /> Revize agentem
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', flex: 1, minHeight: 0 }}>
        <div className="tree">
          {tree.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>
              Pracovní adresář je prázdný. Spusťte Build.
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
          {diff ? (
            <Editor theme={theme} language="plaintext" value={diff.text} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
          ) : path ? (
            <Editor
              theme={theme}
              path={path}
              language={languageOf(path)}
              value={content}
              onChange={(v) => setContent(v ?? '')}
              options={{ minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }}
            />
          ) : (
            <div className="empty">Vyberte soubor ve stromu vlevo.</div>
          )}
        </div>
        <div className="inspector" style={{ padding: 8 }}>
          <h3 style={{ padding: '0 4px' }}>Historie</h3>
          {history.map((c) => (
            <div
              key={c.hash}
              className={`tree-row ${diff?.hash === c.hash ? 'current' : ''}`}
              style={{ height: 'auto', padding: '4px 6px', display: 'block', whiteSpace: 'normal' }}
              onClick={async () => setDiff({ hash: c.hash, text: (await api<{ diff: string }>(`/projects/${pid}/history/${c.hash}`)).diff })}
            >
              <div style={{ fontWeight: 500 }}>{c.subject}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                <span className="mono">{c.hash}</span> · {new Date(c.date).toLocaleString('cs')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
