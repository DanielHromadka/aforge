// Implementation: tasks and bugs by repository, each repository with its own agent. The selected task shows
// what its agent does step by step and, when it finishes, the changed files to accept or return.
import { useEffect, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { api } from '../api'
import { Icon } from '../icons'
import { darkMode, languageOf } from '../monaco'
import { reposOf, roleOfIssue, ROLE_NAME, type AgentRole, type Issue } from '@aforge/shared'
import { ActionButton } from '../components/ActionButton'
import { useStudio, type LogLine } from '../studio'
import { CodeStage } from './CodeStage'
import { Glyph, LAYER_UI, PLATFORM_UI, StatusIcon, Tile, TypeIcon, type GlyphName } from '../components/Glyphs'
import { IssueFilterBar, IssueGroup, IssueRow, matchesFilter, NO_FILTER, useCollapsed, type IssueFilter } from '../components/Work'
import { Markdown } from '../components/Markdown'
import { AnchoredThread } from '../components/AgentPanel'
import { DeleteItemButton, EditItemButton } from '../components/ItemActions'
import { PlanningPanel } from '../components/Planning'

export const ImplementStage = () => {
  const [tab, setTab] = useState<'tasks' | 'code'>('tasks')
  const tabs = (
    <div className="segmented">
      <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Tasky</button>
      <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>Kód</button>
    </div>
  )
  return tab === 'code' ? <><div className="pane-bar"><h2>Implementace</h2>{tabs}</div><CodeStage /></> : <Tasks tabs={tabs} />
}

/** "Zeptat se …" takes the genitive. */
const ASK: Record<AgentRole, string> = { analyst: 'Analytika', architect: 'Architekta', fe: 'FE vývojáře', be: 'BE vývojáře', tester: 'Testera', writer: 'Dokumentaristy', consultant: 'Konzultanta' }


const Tasks = ({ tabs }: { tabs: React.ReactNode }) => {
  const s = useStudio()
  const p = s.project
  const repos = reposOf(p)
  const base: IssueFilter = { ...NO_FILTER, state: 'open' }
  const [filter, setFilter] = useState<IssueFilter>(base)
  const groups = useCollapsed()
  const approved = (p.issues ?? []).filter((i) => i.status !== 'proposed')
  const issues = approved.filter((i) => matchesFilter(i, filter))
  const selected = (p.issues ?? []).find((i) => i.id === s.focus.issueId) ?? issues.find((i) => i.status === 'running') ?? issues[0]
  const select = (id: string) => s.setFocus({ ...s.focus, issueId: id })
  const ready = p.stories.filter((x) => (p.issues ?? []).some((i) => i.storyId === x.id && i.status === 'todo'))
  const implementAll = async () => { for (const x of ready) await s.act(`/stories/${x.id}/implement`) }

  return (
    <>
      <div className="pane-bar">
        <h2>Implementace</h2>
        {tabs}
        <span className="spacer" />
        {!s.readOnly && <ActionButton className="btn primary" disabled={!ready.length} busyLabel="Spouštím agenty…" icon={<Glyph name="play" />} onClick={implementAll}>Implementovat připravené{ready.length ? ` (${ready.length})` : ''}</ActionButton>}
      </div>
      {!approved.length ? <div className="empty">Žádné tasky. Vzniknou rozpadem stories.</div> : <div className="implement">
        <div className="implement-list pane-scroll">
          <IssueFilterBar filter={filter} onChange={setFilter} issues={approved} stories base={base} />
          {!issues.length && <div className="muted empty-line">Filtru neodpovídá žádný task.</div>}
          {repos.map((r) => {
            const own = issues.filter((i) => i.repoId === r.id)
            if (!own.length) return null
            const live = own.some((i) => i.status === 'running')
            return (
              <section key={r.id} className="card-pane">
                <IssueGroup issues={own} open={groups.isOpen(`repo:${r.id}`)} onToggle={(o) => groups.toggle(`repo:${r.id}`, o)}
                  title={<><Glyph name={PLATFORM_UI[r.platform]} /><b>{r.name}</b>{live && <StatusIcon shape="run" label="Agent pracuje" />}</>}>
                  {own.map((i) => <IssueRow key={i.id} issue={i} selected={selected?.id === i.id} onClick={() => select(i.id)} />)}
                </IssueGroup>
              </section>
            )
          })}
        </div>
        {selected ? <IssueDetail key={selected.id} issue={selected} /> : <div className="card-pane muted">Vyberte task.</div>}
      </div>}
    </>
  )
}

/** Turns the agent's log lines into a timeline with an icon per kind of action. */
const glyphOf = (l: LogLine): GlyphName =>
  l.kind === 'text' ? 'chat' : l.kind === 'done' ? 'check' : l.kind === 'error' ? 'test'
    : /^(Bash|npm|npx|node|dotnet|git|python)|\$ /i.test(l.text) ? 'term'
    : /^(Read|Glob|Grep|LS)/i.test(l.text) ? 'search'
    : /^(Write|Edit|MultiEdit)/i.test(l.text) ? 'file' : 'spark'

export const IssueDetail = ({ issue }: { issue: Issue }) => {
  const s = useStudio()
  const [feedback, setFeedback] = useState('')
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const lines = s.buildLog.filter((l) => l.issueId === issue.id && l.kind !== 'usage')
  const story = s.project.stories.find((x) => x.id === issue.storyId)
  const layer = LAYER_UI[issue.layer]
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [lines.length])
  const added = issue.files.reduce((n, f) => n + f.added, 0)
  const removed = issue.files.reduce((n, f) => n + f.removed, 0)

  return (
    <div className="issue-detail">
      <section className="card-pane">
        <div className="row-gap">
          <TypeIcon type={issue.type} size={20} />
          <span className="key">{issue.id}</span>
          <b className="grow">{issue.title}</b>
          <StatusIcon shape={issue.status === 'running' ? 'run' : issue.status === 'review' || issue.status === 'proposed' ? 'wait' : issue.status === 'done' ? 'ok' : issue.status === 'failed' ? 'err' : issue.status === 'blocked' ? 'block' : 'todo'} />
        </div>
        <div className="row-gap muted small">
          <Tile glyph={layer.glyph} tone={layer.tone} size={18} />{ROLE_NAME[roleOfIssue(s.project, issue)]}
          {story && <><span>·</span><TypeIcon type="story" size={14} /><button className="link-btn" onClick={() => { s.setFocus({ ...s.focus, storyId: story.id }); s.setStage('stories') }}>{story.id} {story.title}</button></>}
        </div>
        {issue.description && <div className="issue-desc"><Markdown text={issue.description} /></div>}
        <div className="row-gap"><EditItemButton kind="issue" id={issue.id} /><DeleteItemButton kind="issue" id={issue.id} /></div>
        {issue.feedback && <div className="muted small">Připomínka z revize: {issue.feedback}</div>}
        {!s.readOnly && (issue.status === 'todo' || issue.status === 'failed' || issue.status === 'running') && <div className="row-gap">
          <ActionButton className="btn primary" busy={issue.status === 'running'} busyLabel={`${ROLE_NAME[roleOfIssue(s.project, issue)]} pracuje…`} icon={<Glyph name="play" />} onClick={() => s.act(`/issues/${issue.id}/run`)}>Spustit agenta</ActionButton>
          {issue.status === 'running' && <ActionButton busyLabel="Zastavuji…" onClick={() => s.act('/build/stop', { repo: issue.repoId })}>Zastavit</ActionButton>}
        </div>}
      </section>

      <PlanningPanel key={issue.id} kind="issue" id={issue.id} />
      {lines.length > 0 && (
        <section className="card-pane timeline-pane">
          <h3>Průběh</h3>
          <div className="timeline">
            {lines.slice(-200).map((l, n) => (
              <div key={n} className={`ev ev-${l.kind}`}>
                <span className="ev-k"><Glyph name={glyphOf(l)} size={13} /></span>
                <span className="ev-text">{l.text}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </section>
      )}

      {(issue.status === 'review' || issue.files.length > 0) && (
        <section className="card-pane">
          <h3>{issue.status === 'review' && <StatusIcon shape="wait" />} Změny <span className="muted num">+{added} −{removed}</span></h3>
          <div className="files">
            {issue.files.map((f) => (
              <button key={f.path} className="file-row clickable" onClick={() => setDiffPath(f.path)} title="Zobrazit změny v souboru">
                <Glyph name="file" size={13} /><span className="grow ell mono">{f.path}</span><span className="plus num">+{f.added}</span><span className="minus num">−{f.removed}</span>
              </button>
            ))}
            {!issue.files.length && <div className="muted small">Agent nezměnil žádný soubor.</div>}
          </div>
          {issue.status === 'review' && !s.readOnly && <>
            <div className="row-gap">
              <ActionButton className="btn primary" busyLabel="Přijímám…" icon={<Glyph name="check" />} onClick={() => s.act(`/issues/${issue.id}/accept`)}>Přijmout</ActionButton>
            </div>
            <div className="return-form">
              <input className="field" placeholder="Co upravit…" value={feedback} onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && feedback.trim()) void s.act(`/issues/${issue.id}/return`, { feedback }).then((ok) => ok && setFeedback('')) }} />
              <ActionButton disabled={!feedback.trim()} busyLabel="Vracím…" onClick={() => s.act(`/issues/${issue.id}/return`, { feedback }).then((ok) => ok && setFeedback(''))}>Vrátit</ActionButton>
            </div>
          </>}
        </section>
      )}

      {diffPath && <FileDiffDialog issue={issue} path={diffPath} onPath={setDiffPath} onClose={() => setDiffPath(null)} />}

      <section className="card-pane">
        <h3>Zeptat se {ASK[roleOfIssue(s.project, issue)]}</h3>
        <AnchoredThread anchor={issue.id} placeholder={`Napsat k ${issue.id}…`} />
      </section>
    </div>
  )
}

type Diff = { original: string; modified: string; binary: boolean; tooLarge: boolean }

/** What the task's run changed: the changed files on the left, the selected one side by side. */
const FileDiffDialog = ({ issue, path, onPath, onClose }: { issue: Issue; path: string; onPath: (p: string) => void; onClose: () => void }) => {
  const s = useStudio()
  const [diff, setDiff] = useState<Diff | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setDiff(null); setError('')
    api<Diff>(`/projects/${s.project.id}/issues/${issue.id}/diff?path=${encodeURIComponent(path)}`).then((d) => live && setDiff(d), (e: Error) => live && setError(e.message))
    return () => { live = false }
  }, [s.project.id, issue.id, path])
  return (
    <div className="backdrop diff-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog diff-dialog" role="dialog" aria-modal aria-label={`Změny v ${path}`}>
        <div className="diff-head">
          <TypeIcon type={issue.type} /><span className="key">{issue.id}</span><b className="grow ell mono">{path}</b>
          <button className="tool-btn" onClick={onClose} title="Zavřít (Esc)" autoFocus><Icon.x /></button>
        </div>
        <div className="diff-body">
          <nav className="diff-files">
            {issue.files.map((f) => (
              <button key={f.path} className={`file-row clickable ${f.path === path ? 'current' : ''}`} onClick={() => onPath(f.path)}>
                <span className="grow ell mono">{f.path}</span><span className="plus num">+{f.added}</span><span className="minus num">−{f.removed}</span>
              </button>
            ))}
          </nav>
          <div className="diff-view">
            {error ? <div className="empty">{error}</div>
              : !diff ? <div className="empty">Načítám změny…</div>
              : diff.binary || diff.tooLarge ? <div className="empty">{diff.binary ? 'Binární soubor, rozdíl nelze zobrazit.' : 'Soubor je příliš velký na zobrazení rozdílu.'}</div>
              : <DiffEditor
                keepCurrentOriginalModel
                keepCurrentModifiedModel key={path} theme={darkMode() ? 'vs-dark' : 'vs'} language={languageOf(path)} original={diff.original} modified={diff.modified}
                  options={{ readOnly: true, originalEditable: false, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true, renderOverviewRuler: false }} />}
          </div>
        </div>
      </div>
    </div>
  )
}
