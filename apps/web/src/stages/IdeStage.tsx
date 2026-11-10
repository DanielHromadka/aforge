// Agentic IDE: an explorer over every repository, Monaco with the agents' diffs and ⌘K, a grid of the
// repositories' agents and a composer that plans work per repository. The Scribe writes the backlog and the
// wiki behind it; the trace in the status bar is the only place they show unless the user looks.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react'
import {
  ideSettingsOf, reposOf, roleOfIssue, ROLE_NAME, workflowOf, workflowPreset,
  type AgentRun, type ChatMessage, type FileEntry, type IdeSettings, type Issue, type Project, type Repo,
} from '@aforge/shared'
import { api, previewHref } from '../api'
import { useStudio, type LogLine } from '../studio'
import { navigate } from '../router'
import { darkMode, languageOf } from '../monaco'
import { Glyph, LAYER_UI, PLATFORM_UI, ROLE_UI, shapeOf, StatusIcon, Tile, TypeIcon } from '../components/Glyphs'
import { AgentMessage } from '../components/AgentPanel'
import { Markdown } from '../components/Markdown'
import { useHub } from '../components/Workers'
import { isLive } from '../components/AgentRuns'
import { projectRuns } from '../components/Work'
import { IdeTrace, autoCreated } from './IdeTrace'
import { IdeImmersive } from './IdeImmersive'

type Tab = { kind: 'file'; repo: string; path: string } | { kind: 'story'; id: string } | { kind: 'wiki'; id: string }
const tabKey = (t: Tab) => (t.kind === 'file' ? `f:${t.repo}:${t.path}` : `${t.kind}:${t.id}`)

/** The issue a repository's agent works on now, or the last one it touched. */
export const currentIssue = (p: Project, repo: string): Issue | undefined => {
  const own = (p.issues ?? []).filter((i) => i.repoId === repo && i.status !== 'proposed')
  return own.find((i) => i.status === 'running') ?? own.filter((i) => i.status === 'review').at(-1)
    ?? [...own].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1)
}

/** Shared actions of the IDE and the Ponor: run a prompt, accept work and rebuild the preview. */
export const useIde = () => {
  const s = useStudio()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState('')
  const run = useCallback(async (text: string, extra: { filePath?: string; repo?: string; element?: { selector: string; text: string; route: string } } = {}) => {
    if (s.readOnly || !(await s.flush())) return false
    setBusy(true); setPending(text)
    try {
      const r = await api<{ messages: ChatMessage[] }>(`/projects/${s.project.id}/ide/run`, { body: { text, ...extra } })
      s.setChat([...s.chat, ...r.messages])
      await s.reload()
      return true
    } catch (e) { s.toast((e as Error).message, true); return false }
    finally { setBusy(false); setPending('') }
  }, [s])
  const rebuild = useCallback(() => {
    if (s.preview.state === 'running' || s.preview.state === 'starting') void api(`/projects/${s.project.id}/preview/start`, { body: {} }).catch(() => {})
  }, [s.preview.state, s.project.id])
  const accept = useCallback(async (ids: string[]) => {
    let ok = true
    for (const id of ids) ok = (await s.act(`/issues/${id}/accept`)) && ok
    if (ok) rebuild()
    return ok
  }, [s, rebuild])
  return { busy, pending, run, accept, rebuild }
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }
const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition

/** Dictation through the browser; only offered when the project allows it (some browsers send audio to their vendor). */
export const useDictation = (enabled: boolean, onText: (text: string) => void) => {
  const [on, setOn] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const handler = useRef(onText)
  handler.current = onText
  const toggle = () => {
    if (on) { rec.current?.stop(); return }
    if (!Recognizer) return
    const r = new Recognizer()
    r.lang = 'cs-CZ'; r.continuous = true; r.interimResults = false
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) handler.current(e.results[i]![0]!.transcript.trim()) }
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r
    r.start(); setOn(true)
  }
  useEffect(() => () => rec.current?.stop(), [])
  return { available: enabled && !!Recognizer, on, toggle }
}

export const IdeStage = () => {
  const s = useStudio()
  const p = s.project
  const repos = reposOf(p)
  const settings = ideSettingsOf(p)
  const { hub } = useHub()
  const runs = hub ? projectRuns(hub.runs, p) : []
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string>('')
  const [explorer, setExplorer] = useState<'files' | 'work' | 'wiki'>('files')
  const [cols, setCols] = useState(() => Number(localStorage.getItem('aforge.ide.cols')) || Math.min(3, repos.length))
  const [traceOpen, setTraceOpen] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const open = useCallback((t: Tab) => {
    setTabs((list) => (list.some((x) => tabKey(x) === tabKey(t)) ? list : [...list, t]))
    setActive(tabKey(t))
    if (t.kind === 'file') s.setFocus({ ...s.focus, filePath: t.path, repo: t.repo })
  }, [s])
  const close = (key: string) => setTabs((list) => {
    const next = list.filter((x) => tabKey(x) !== key)
    if (key === active) setActive(next.at(-1) ? tabKey(next.at(-1)!) : '')
    return next
  })
  const current = tabs.find((t) => tabKey(t) === active)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey && e.key === 'Enter') { e.preventDefault(); setImmersive((x) => !x) }
      else if (e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); setTraceOpen((x) => !x) }
      else if (!e.shiftKey && e.key === 'l') { e.preventDefault(); composerRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setSettings = (patch: Partial<IdeSettings>) => s.update((x) => ({ ...x, ide: { ...ideSettingsOf(x), ...patch } }))

  return (
    <div className="ide">
      <div className="ide-body">
        <aside className="card-pane flush ide-explorer">
          <div className="ide-xtabs" role="tablist">
            {([['files', 'file', 'Soubory'], ['work', 'board', 'Práce'], ['wiki', 'wiki', 'Wiki']] as const).map(([k, g, label]) => (
              <button key={k} role="tab" aria-selected={explorer === k} className={explorer === k ? 'on' : ''} title={label} onClick={() => setExplorer(k)}><Glyph name={g} size={14} /><span>{label}</span></button>
            ))}
          </div>
          <div className="ide-explorer-body">
            {explorer === 'files' && repos.map((r) => <RepoTree key={r.id} repo={r} multi={repos.length > 1} current={current?.kind === 'file' ? current : undefined} onOpen={(path) => open({ kind: 'file', repo: r.id, path })} />)}
            {explorer === 'work' && <WorkTree onOpen={(id) => open({ kind: 'story', id })} />}
            {explorer === 'wiki' && <WikiList onOpen={(id) => open({ kind: 'wiki', id })} />}
          </div>
        </aside>

        <div className="ide-center">
          <section className="card-pane flush ide-editor">
            <div className="ide-etabs">
              {tabs.map((t) => (
                <span key={tabKey(t)} className={`ide-etab ${tabKey(t) === active ? 'on' : ''}`}>
                  <button className="ide-etab-open" onClick={() => setActive(tabKey(t))} title={t.kind === 'file' ? `${t.repo}/${t.path}` : t.id}>
                    {t.kind === 'file' ? <Glyph name="file" size={12} /> : t.kind === 'story' ? <TypeIcon type="story" size={13} /> : <Glyph name="wiki" size={12} />}
                    {t.kind === 'file' ? t.path.split('/').pop() : t.id}
                  </button>
                  <button className="ide-etab-x" aria-label="Zavřít" onClick={() => close(tabKey(t))}>×</button>
                </span>
              ))}
            </div>
            {!current ? <div className="empty">Otevřete soubor vlevo, nebo napište do composeru, co se má udělat.<p className="muted small">⌘L composer · ⌘K úprava výběru v editoru · ⌘⇧T Stopa · ⌘⇧↩ Ponor</p></div>
              : current.kind === 'file' ? <FileView key={active} repo={current.repo} path={current.path} />
              : current.kind === 'story' ? <StoryPeek id={current.id} onOpen={open} />
              : <WikiPeek id={current.id} />}
          </section>
          <AgentGrid repos={repos} runs={runs} cols={cols} setCols={(n) => { setCols(n); localStorage.setItem('aforge.ide.cols', String(n)) }} onOpenFile={(repo, path) => open({ kind: 'file', repo, path })} />
        </div>

        <Composer inputRef={composerRef} current={current} onOpen={open} />
      </div>

      <footer className="ide-status">
        <span><Glyph name="repo" size={13} />{repos.length} {repos.length === 1 ? 'repozitář' : repos.length < 5 ? 'repozitáře' : 'repozitářů'}</span>
        <span><span className={`dot ${s.preview.state === 'running' ? 'ok' : s.preview.state === 'starting' ? 'run' : s.preview.state === 'error' ? 'err' : ''}`} />Náhled {s.preview.state === 'running' ? 'běží · přestaví se po přijetí' : s.preview.state === 'starting' ? 'se spouští' : 'neběží'}</span>
        {p.testReport && <span><Glyph name="test" size={13} />Testy {p.testReport.cases.filter((c) => c.status === 'passed').length}/{p.testReport.cases.length}</span>}
        <span className="spacer" />
        <div className="menu-anchor">
          <button className={`tool-btn ${settingsOpen ? 'pressed' : ''}`} onClick={() => setSettingsOpen(!settingsOpen)} title="Nastavení IDE"><Glyph name="settings" size={14} /></button>
          {settingsOpen && <div className="popover ide-settings" onKeyDown={(e) => e.key === 'Escape' && setSettingsOpen(false)}>
            <h3>Zapisovatel</h3>
            <label><input type="radio" disabled={s.readOnly} checked={settings.record === 'auto'} onChange={() => setSettings({ record: 'auto' })} /> Zapisovat backlog sám (lze vrátit ve Stopě)</label>
            <label><input type="radio" disabled={s.readOnly} checked={settings.record === 'review'} onChange={() => setSettings({ record: 'review' })} /> Navrhovat ke schválení v konzultantovi</label>
            <h3>Wiki</h3>
            <label><input type="radio" disabled={s.readOnly} checked={settings.wiki === 'auto'} onChange={() => setSettings({ wiki: 'auto' })} /> Přijímat změny Dokumentaristy s verzí</label>
            <label><input type="radio" disabled={s.readOnly} checked={settings.wiki === 'review'} onChange={() => setSettings({ wiki: 'review' })} /> Nechat je ke schválení ve Wiki</label>
            <h3>Diktování</h3>
            <label><input type="checkbox" disabled={s.readOnly || !Recognizer} checked={settings.voice} onChange={(e) => setSettings({ voice: e.target.checked })} /> Povolit diktování v prohlížeči</label>
            <p className="muted small">{Recognizer ? 'Rozpoznávání řeči zajišťuje prohlížeč. Některé prohlížeče posílají zvuk svému poskytovateli; u projektů s citlivými daty ho nezapínejte.' : 'Tento prohlížeč diktování nepodporuje.'}</p>
          </div>}
        </div>
        <TracePill onClick={() => setTraceOpen(!traceOpen)} pressed={traceOpen} />
        <button className="btn small" onClick={() => setImmersive(true)} title="Ponor (⌘⇧↩)"><Glyph name="dive" size={13} />Ponor</button>
      </footer>

      {traceOpen && <IdeTrace onClose={() => setTraceOpen(false)} onOpen={(t) => { open(t); setTraceOpen(false) }} />}
      {immersive && <IdeImmersive onClose={() => setImmersive(false)} />}
    </div>
  )
}

const TracePill = ({ onClick, pressed }: { onClick: () => void; pressed: boolean }) => {
  const s = useStudio()
  const trace = s.project.trace ?? []
  const live = trace.filter((e) => !e.reverted)
  const stories = live.filter((e) => e.kind === 'story' || e.kind === 'criterion').length
  const tasks = live.filter((e) => e.kind === 'task').length
  const bugs = (s.project.issues ?? []).filter((i) => i.type === 'bug' && i.status !== 'done').length
  const wiki = live.filter((e) => e.kind === 'wiki').length
  const unsorted = live.filter((e) => e.kind === 'unsorted' && !e.resolved).length
  return (
    <button className={`ide-trace-pill ${pressed ? 'pressed' : ''}`} onClick={onClick} title="Stopa: co Zapisovatel zapsal (⌘⇧T)">
      <Glyph name="trace" size={13} />Stopa
      <span><TypeIcon type="story" size={13} />{stories}</span>
      <span><TypeIcon type="task" size={13} />{tasks}</span>
      <span><TypeIcon type="bug" size={13} />{bugs}</span>
      <span><Glyph name="wiki" size={12} />{wiki}</span>
      {unsorted > 0 && <span className="ide-unsorted" title="Nezařazené požadavky">{unsorted}</span>}
    </button>
  )
}

// ---- explorer ------------------------------------------------------------------------------

const RepoTree = ({ repo, multi, current, onOpen }: { repo: Repo; multi: boolean; current?: { repo: string; path: string }; onOpen: (path: string) => void }) => {
  const s = useStudio()
  const [tree, setTree] = useState<FileEntry[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState(false)
  const runState = (s.project.issues ?? []).filter((i) => i.repoId === repo.id).map((i) => i.status).join()
  useEffect(() => {
    let live = true
    api<FileEntry[]>(`/projects/${s.project.id}/files?repo=${encodeURIComponent(repo.id)}`).then((t) => live && setTree(t), () => {})
    return () => { live = false }
  }, [s.project.id, repo.id, runState])
  // Files the agent changed and the reviewer has not accepted yet.
  const changed = useMemo(() => new Map((s.project.issues ?? []).filter((i) => i.repoId === repo.id && i.status === 'review').flatMap((i) => i.files.map((f) => [f.path, f.removed && !f.added ? 'D' : 'M'] as const))), [s.project.issues, repo.id])
  const rows = (entries: FileEntry[], depth: number): ReactNode => entries.map((e) => (
    <div key={e.path}>
      <button className={`ide-row ${current?.repo === repo.id && current.path === e.path ? 'cur' : ''}`} style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => (e.type === 'dir' ? setOpen((o) => { const n = new Set(o); if (n.has(e.path)) n.delete(e.path); else n.add(e.path); return n }) : onOpen(e.path))}>
        <span className={`chev ${open.has(e.path) ? 'open' : ''}`}>{e.type === 'dir' ? '›' : ''}</span>
        <Glyph name={e.type === 'dir' ? 'box' : 'file'} size={13} />
        <span className="ell">{e.path.split('/').pop()}</span>
        {changed.has(e.path) && <span className="ide-mark">{changed.get(e.path)}</span>}
      </button>
      {e.type === 'dir' && open.has(e.path) && rows(e.children ?? [], depth + 1)}
    </div>
  ))
  return (
    <div className="ide-repo">
      {multi && <button className="ide-repo-head" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <Glyph name={PLATFORM_UI[repo.platform]} size={13} /><b className="ell">{repo.name}</b>{changed.size > 0 && <span className="ide-mark">{changed.size}</span>}
      </button>}
      {!collapsed && (tree.length ? rows(tree, 0) : <div className="muted small ide-pad">Prázdný repozitář</div>)}
    </div>
  )
}

const WorkTree = ({ onOpen }: { onOpen: (storyId: string) => void }) => {
  const s = useStudio()
  const p = s.project
  const auto = autoCreated(p)
  const groups = [...(p.epics ?? []).map((e) => ({ id: e.id, title: e.title })), { id: '', title: 'Bez epicu' }]
  if (!p.stories.length) return <div className="muted small ide-pad">Backlog je prázdný. Stories vzniknou z vašich požadavků v composeru.</div>
  return <>{groups.map((g) => {
    const stories = p.stories.filter((x) => (g.id ? x.epicId === g.id : !x.epicId || !(p.epics ?? []).some((e) => e.id === x.epicId)))
    if (!stories.length) return null
    return (
      <div key={g.id || 'none'} className="ide-repo">
        <div className="ide-repo-head static">{g.id && <TypeIcon type="epic" size={13} />}<b className="ell">{g.title}</b></div>
        {stories.map((x) => {
          const own = (p.issues ?? []).filter((i) => i.storyId === x.id)
          return (
            <button key={x.id} className="ide-row" onClick={() => onOpen(x.id)}>
              <TypeIcon type="story" size={13} /><span className="key">{x.id}</span><span className="ell">{x.title}</span>
              {auto.has(x.id) && <span className="auto-badge">AUTO</span>}
              {own.length > 0 && <span className="muted small num">{own.filter((i) => i.status === 'done').length}/{own.length}</span>}
            </button>
          )
        })}
      </div>
    )
  })}</>
}

const WikiList = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const s = useStudio()
  const pages = s.project.wiki ?? []
  if (!pages.length) return <div className="muted small ide-pad">Wiki zatím nemá stránky. Dokumentarista je napíše po přijetí práce na story.</div>
  return <>{pages.map((w) => (
    <button key={w.id} className="ide-row" onClick={() => onOpen(w.id)}>
      <Glyph name="wiki" size={13} /><span className="ell">{w.title || w.draft?.title || w.id}</span>{w.draft && <span className="auto-badge warn">NÁVRH</span>}
    </button>
  ))}</>
}

// ---- editor --------------------------------------------------------------------------------

type Diff = { original: string; modified: string; binary: boolean; tooLarge: boolean }

const FileView = ({ repo, path }: { repo: string; path: string }) => {
  const s = useStudio()
  const pid = s.project.id
  const q = `repo=${encodeURIComponent(repo)}`
  const [content, setContent] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [diff, setDiff] = useState<Diff | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [ask, setAsk] = useState<{ startLine: number; endLine: number; selection: string; top: number } | null>(null)
  const [instruction, setInstruction] = useState('')
  const [feedback, setFeedback] = useState('')
  const { accept } = useIde()
  const review = (s.project.issues ?? []).find((i) => i.repoId === repo && i.status === 'review' && i.files.some((f) => f.path === path))
  const file = review?.files.find((f) => f.path === path)
  const runningHere = (s.project.issues ?? []).some((i) => i.repoId === repo && i.status === 'running')

  useEffect(() => {
    let live = true
    api<{ content: string }>(`/projects/${pid}/file?path=${encodeURIComponent(path)}&${q}`).then((r) => { if (live) { setContent(r.content); setSaved(r.content) } }, (e: Error) => { if (live) { setContent(''); s.toast(e.message, true) } })
    return () => { live = false }
    // The agent may rewrite the file: reload when its run ends.
  }, [pid, path, q, runningHere, s.toast])
  useEffect(() => {
    setDiff(null)
    if (!review || !showDiff) return
    let live = true
    api<Diff>(`/projects/${pid}/issues/${review.id}/diff?path=${encodeURIComponent(path)}`).then((d) => live && setDiff(d), (e: Error) => { s.toast(e.message, true); setShowDiff(false) })
    return () => { live = false }
  }, [pid, review?.id, path, showDiff, s.toast]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = content !== null && content !== saved
  const save = useCallback(async () => {
    if (s.readOnly || content === null || !dirty) return
    try { await api(`/projects/${pid}/file?${q}`, { method: 'PUT', body: { path, content } }); setSaved(content) } catch (e) { s.toast((e as Error).message, true) }
  }, [s, content, dirty, pid, q, path])
  const saveRef = useRef(save)
  saveRef.current = save

  const mount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current())
    editor.addAction({
      id: 'aforge.inline', label: 'Upravit výběr agentem', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: (ed) => {
        const sel = ed.getSelection()
        const model = ed.getModel()
        if (!sel || !model) return
        const range = sel.isEmpty() ? new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, model.getLineMaxColumn(sel.startLineNumber)) : sel
        const top = ed.getTopForLineNumber(range.endLineNumber) - ed.getScrollTop() + 24
        setAsk({ startLine: range.startLineNumber, endLine: range.endLineNumber, selection: model.getValueInRange(range), top: Math.max(8, top) })
        setInstruction('')
      },
    })
  }
  const sendInline = async () => {
    if (!ask || !instruction.trim()) return
    if (dirty) await save()
    try {
      await api(`/projects/${pid}/ide/inline`, { body: { repo, path, ...ask, instruction: instruction.trim() } })
      s.toast('Agent repozitáře upraví výběr.')
      setAsk(null)
      await s.reload()
    } catch (e) { s.toast((e as Error).message, true) }
  }

  const theme = darkMode() ? 'vs-dark' : 'vs'
  return (
    <div className="ide-file">
      {review && (
        <div className="ide-diffbar">
          <TypeIcon type={review.type} size={14} /><span className="key">{review.id}</span>
          <span className="ell">Změna agenta {file && <><b className="plus num">+{file.added}</b> <b className="minus num">−{file.removed}</b></>}</span>
          <span className="spacer" />
          <button className={`btn small ${showDiff ? 'pressed' : ''}`} onClick={() => setShowDiff(!showDiff)}>{showDiff ? 'Skrýt diff' : 'Zobrazit diff'}</button>
          {!s.readOnly && <>
            <input className="field small" placeholder="Co upravit…" value={feedback} onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && feedback.trim()) void s.act(`/issues/${review.id}/return`, { feedback }).then((ok) => ok && setFeedback('')) }} />
            <button className="btn small" disabled={!feedback.trim()} onClick={() => void s.act(`/issues/${review.id}/return`, { feedback }).then((ok) => ok && setFeedback(''))}>Vrátit</button>
            <button className="btn small primary" onClick={() => void accept([review.id])}><Glyph name="check" size={12} />Přijmout {review.id}</button>
          </>}
        </div>
      )}
      <div className="ide-monaco">
        {content === null ? <div className="empty">Načítám…</div>
          : showDiff && diff && !diff.binary && !diff.tooLarge
            ? <DiffEditor theme={theme} language={languageOf(path)} original={diff.original} modified={diff.modified}
              options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true }} />
            : <Editor theme={theme} path={`${pid}/${repo}/${path}`} language={languageOf(path)} value={content} onMount={mount} onChange={(v) => setContent(v ?? '')}
              options={{ readOnly: s.readOnly, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }} />}
        {ask && (
          <div className="ide-inline-ask" style={{ top: ask.top }} onKeyDown={(e) => e.key === 'Escape' && setAsk(null)}>
            <Glyph name="spark" size={14} />
            <input autoFocus className="field" placeholder={`Co udělat s řádky ${ask.startLine}–${ask.endLine}?`} value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendInline()} />
            <kbd>⌘K</kbd>
          </div>
        )}
      </div>
      <div className="ide-filebar muted small"><span className="mono ell">{repo} · {path}</span>{dirty && <span className="chip orange">Neuloženo · ⌘S</span>}</div>
    </div>
  )
}

/** A quick look at a story; the full detail is in the Studio. */
const StoryPeek = ({ id, onOpen }: { id: string; onOpen: (t: Tab) => void }) => {
  const s = useStudio()
  const p = s.project
  const story = p.stories.find((x) => x.id === id)
  if (!story) return <div className="empty">Story {id} v projektu není.</div>
  const epic = (p.epics ?? []).find((e) => e.id === story.epicId)
  const issues = (p.issues ?? []).filter((i) => i.storyId === id)
  return (
    <div className="ide-peek pane-scroll">
      <div className="row-gap"><TypeIcon type="story" size={20} /><span className="key">{story.id}</span><h2 className="grow">{story.title}</h2>{autoCreated(p).has(story.id) && <span className="auto-badge">AUTO</span>}</div>
      {epic && <div className="muted small row-gap"><TypeIcon type="epic" size={13} />{epic.id} {epic.title}</div>}
      <p>Jako <b>{story.asA}</b> chci <b>{story.iWant}</b>, abych <b>{story.soThat}</b>.</p>
      <h3>Akceptační kritéria</h3>
      <ol>{story.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ol>
      <h3>Práce</h3>
      {!issues.length && <p className="muted">Zatím žádné tasky.</p>}
      {issues.map((i) => (
        <div key={i.id} className="ide-issue">
          <TypeIcon type={i.type} size={14} /><span className="key">{i.id}</span><span className="grow ell">{i.title}</span>
          <Tile glyph={LAYER_UI[i.layer].glyph} tone={LAYER_UI[i.layer].tone} size={16} title={ROLE_NAME[roleOfIssue(p, i)]} />
          <StatusIcon shape={shapeOf(i.status)} size={14} />
          {i.files[0] && <button className="link-btn small" onClick={() => onOpen({ kind: 'file', repo: i.repoId, path: i.files[0]!.path })}>soubory</button>}
        </div>
      ))}
      <div className="row-gap"><StudioLink item={story.id} /></div>
    </div>
  )
}

const WikiPeek = ({ id }: { id: string }) => {
  const s = useStudio()
  const page = (s.project.wiki ?? []).find((w) => w.id === id)
  if (!page) return <div className="empty">Stránka neexistuje.</div>
  return (
    <div className="ide-peek pane-scroll">
      <div className="row-gap"><Glyph name="wiki" size={18} /><h2 className="grow">{page.title || page.draft?.title}</h2><span className="muted small">{page.history.length + (page.body ? 1 : 0)}. verze</span></div>
      {page.draft && <div className="ide-note">Čeká návrh změn: {page.draft.changes.join(' · ')} <button className="link-btn" onClick={() => { s.setFocus({ ...s.focus, wikiPage: id }); s.setStage('wiki') }}>Rozhodnout ve Wiki</button></div>}
      {page.body ? <Markdown text={page.body} /> : <p className="muted">Stránka zatím nemá přijatý obsah.</p>}
    </div>
  )
}

/** Switches the session to the Studio (Enterprise) and opens the story on the board. */
export const StudioLink = ({ item }: { item?: string }) => {
  const s = useStudio()
  return (
    <button className="btn small" disabled={s.readOnly} onClick={() => {
      const workflow = workflowPreset('enterprise', workflowOf(s.project))
      s.update((x) => ({ ...x, workflow }))
      const step = workflow.steps.find((x) => x.kind === 'stories')!.id
      navigate(`/p/${s.project.id}/${step}${item ? `/${encodeURIComponent(item)}` : ''}`)
    }}><Glyph name="board" size={13} />Otevřít ve Studiu</button>
  )
}

// ---- agents grid ---------------------------------------------------------------------------

const AgentGrid = ({ repos, runs, cols, setCols, onOpenFile }: { repos: Repo[]; runs: AgentRun[]; cols: number; setCols: (n: number) => void; onOpenFile: (repo: string, path: string) => void }) => {
  const [focus, setFocus] = useState<string>()
  const [max, setMax] = useState<string>()
  const shown = max ? repos.filter((r) => r.id === max) : repos
  return (
    <section className="card-pane flush ide-grid">
      <div className="ide-grid-head">
        <Glyph name="team" size={14} /><b>Agenti</b><span className="muted small">jeden na repozitář, souběžně · dvojklik = celá plocha</span>
        <span className="spacer" />
        <div className="segmented" aria-label="Sloupce mřížky">{[1, 2, 3, 4].map((n) => <button key={n} className={cols === n ? 'active' : ''} onClick={() => setCols(n)}>{n}</button>)}</div>
      </div>
      <div className="ide-panes" style={{ gridTemplateColumns: `repeat(${max ? 1 : Math.min(cols, Math.max(1, repos.length))}, minmax(0, 1fr))` }}>
        {shown.map((r) => <AgentPane key={r.id} repo={r} runs={runs} focused={focus === r.id} onFocus={() => setFocus(r.id)} onMax={() => setMax(max ? undefined : r.id)} onOpenFile={(path) => onOpenFile(r.id, path)} />)}
      </div>
    </section>
  )
}

const termClass = (l: LogLine) => (l.kind === 'error' ? 'r' : l.kind === 'done' ? 'g' : l.kind === 'tool' ? '' : 'd')

const AgentPane = ({ repo, runs, focused, onFocus, onMax, onOpenFile }: { repo: Repo; runs: AgentRun[]; focused: boolean; onFocus: () => void; onMax: () => void; onOpenFile: (path: string) => void }) => {
  const s = useStudio()
  const { accept } = useIde()
  const issue = currentIssue(s.project, repo.id)
  const role = issue ? roleOfIssue(s.project, issue) : repo.platform === 'backend' || repo.platform === 'library' ? 'be' : 'fe'
  const run = issue && runs.find((r) => r.issueId === issue.id && isLive(r))
  const lines = issue ? s.buildLog.filter((l) => l.issueId === issue.id && l.kind !== 'usage').slice(-60) : []
  const queued = (s.project.issues ?? []).filter((i) => i.repoId === repo.id && i.status === 'todo' && i.source === 'ide').length
  const fill = run?.usage.contextTokens && run.usage.contextWindow ? Math.min(100, (run.usage.contextTokens / run.usage.contextWindow) * 100) : issue?.status === 'running' ? 8 : 0
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [lines.length])
  return (
    <div className={`ide-pane ${focused ? 'focus' : ''}`} style={{ ['--tone' as string]: ROLE_UI[role].tone }} onClick={onFocus} onDoubleClick={onMax}>
      <header>
        <Tile glyph={ROLE_UI[role].glyph} tone={ROLE_UI[role].tone} size={20} />
        <b>{ROLE_NAME[role]}</b>
        <span className="muted small ell">{repo.name} · {s.project.stack.agent === 'codex' ? 'Codex' : 'Claude'}{run?.workerId ? ` · ${run.host}` : ''}{queued ? ` · ${queued} ve frontě` : ''}</span>
        <StatusIcon shape={issue ? shapeOf(issue.status) : 'todo'} size={14} label={issue ? undefined : 'Volný'} />
      </header>
      <div className="ide-meter" title={run?.usage.contextTokens ? `Kontext ${Math.round(run.usage.contextTokens / 1000)}k tokenů` : undefined}><i style={{ width: `${fill}%` }} /></div>
      <div className="ide-term">
        {issue ? <span className="d">▸ {issue.id} {issue.title}{'\n'}</span> : <span className="d">Volný. Práce přijde z composeru.</span>}
        {lines.map((l, n) => <span key={n} className={termClass(l)}>{l.text}{'\n'}</span>)}
        {issue?.status === 'review' && issue.files.map((f) => <button key={f.path} className="ide-term-file" onClick={(e) => { e.stopPropagation(); onOpenFile(f.path) }}>{f.path} <span className="g">+{f.added}</span> <span className="r">−{f.removed}</span>{'\n'}</button>)}
        <div ref={end} />
      </div>
      {issue && !s.readOnly && (issue.status === 'review' || issue.status === 'running' || issue.status === 'failed') && (
        <footer onClick={(e) => e.stopPropagation()}>
          {issue.status === 'review' && <button className="btn small primary" onClick={() => void accept([issue.id])}><Glyph name="check" size={12} />Přijmout</button>}
          {issue.status === 'running' && <button className="btn small" onClick={() => void s.act('/build/stop', { repo: repo.id })}>Zastavit</button>}
          {issue.status === 'failed' && <button className="btn small" onClick={() => void s.act(`/issues/${issue.id}/run`)}>Spustit znovu</button>}
          {run && <span className="muted small num">{run.usage.costUsd ? `$${run.usage.costUsd.toFixed(2)}` : ''}</span>}
        </footer>
      )}
    </div>
  )
}

// ---- composer ------------------------------------------------------------------------------

const Composer = ({ inputRef, current, onOpen }: { inputRef: React.RefObject<HTMLTextAreaElement | null>; current?: Tab; onOpen: (t: Tab) => void }) => {
  const s = useStudio()
  const p = s.project
  const ide = useIde()
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'agent' | 'ask'>(() => (localStorage.getItem('aforge.ide.mode') === 'ask' ? 'ask' : 'agent'))
  const settings = ideSettingsOf(p)
  const dictation = useDictation(settings.voice, (t) => setText((x) => (x ? `${x} ${t}` : t)))
  const messages = s.chat.filter((m) => m.stage === 'ide' && !m.anchor)
  const topic = p.stories.find((x) => x.id === settings.topic)
  const file = current?.kind === 'file' ? current : undefined
  const busy = ide.busy || s.agentBusy
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length, busy])
  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    if (mode === 'ask') await s.askAgent({ text: t, inline: true })
    else if (!(await ide.run(t, file ? { filePath: file.path, repo: file.repo } : {}))) setText(t)
  }
  return (
    <aside className="card-pane flush ide-composer">
      <div className="ide-composer-head">
        <Glyph name="spark" size={14} /><b>Composer</b>
        <div className="segmented">
          <button className={mode === 'agent' ? 'active' : ''} onClick={() => { setMode('agent'); localStorage.setItem('aforge.ide.mode', 'agent') }} title="Naplánuje práci a spustí agenty repozitářů">Agent</button>
          <button className={mode === 'ask' ? 'active' : ''} onClick={() => { setMode('ask'); localStorage.setItem('aforge.ide.mode', 'ask') }} title="Konzultant odpoví a případně navrhne změny">Ptát se</button>
        </div>
      </div>
      <div className="ide-thread pane-scroll">
        {!messages.length && !busy && <div className="muted small ide-pad">Napište, co se má udělat. Agent to rozdělí na repozitáře a spustí jejich agenty; Zapisovatel to zapíše do backlogu.</div>}
        {messages.map((m) => <div key={m.id}>
          <AgentMessage m={m} />
          {!!m.issueIds?.length && <div className="ide-runs">{m.issueIds.map((id) => {
            const i = p.issues?.find((x) => x.id === id)
            if (!i) return null
            return <button key={id} className="ide-run" onClick={() => i.files[0] && onOpen({ kind: 'file', repo: i.repoId, path: i.files[0].path })}>
              <Tile glyph={LAYER_UI[i.layer].glyph} tone={LAYER_UI[i.layer].tone} size={18} /><span className="key">{i.id}</span><span className="grow ell">{i.title}</span><StatusIcon shape={shapeOf(i.status)} size={14} />
            </button>
          })}</div>}
        </div>)}
        {busy && <><div className="msg user">{ide.pending || s.pendingText}</div><div className="msg agent"><div className="bubble typing"><span /><span /><span /></div></div></>}
        <div ref={end} />
      </div>
      <div className="ide-ctx">
        {topic && <button className="ide-pill" onClick={() => onOpen({ kind: 'story', id: topic.id })} title="Téma session: navazující požadavky ho doplní"><TypeIcon type="story" size={13} />{topic.id} {topic.title}</button>}
        {file && <span className="ide-pill"><Glyph name="file" size={12} />{file.path.split('/').pop()}</span>}
      </div>
      <div className="ide-input">
        <textarea ref={inputRef} rows={3} value={text} disabled={s.readOnly} placeholder={mode === 'agent' ? 'Co dál? Např. „Přidej do košíku slevové kódy“' : 'Na co se zeptat?'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
        <div className="row-gap">
          <select className="field small" aria-label="Implementující agent" disabled={s.readOnly} value={p.stack.agent} onChange={(e) => s.update((x) => ({ ...x, stack: { agent: e.target.value as 'claude' | 'codex' } }))}>
            <option value="claude">Claude Code</option><option value="codex">Codex</option>
          </select>
          <span className="spacer" />
          {dictation.available && <button className={`tool-btn ${dictation.on ? 'pressed rec' : ''}`} onClick={dictation.toggle} title={dictation.on ? 'Zastavit diktování' : 'Diktovat'}><Glyph name="mic" size={14} /></button>}
          <button className="btn primary small" disabled={!text.trim() || busy || s.readOnly} onClick={() => void send()}>{busy ? 'Pracuje…' : mode === 'agent' ? 'Spustit' : 'Zeptat se'}</button>
        </div>
      </div>
    </aside>
  )
}

/** The running app for the Ponor, as the Preview step shows it. */
export const previewSrc = (p: Project, url?: string) => (url ? previewHref(p.id, url) : undefined)
