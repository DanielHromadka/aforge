// The trace: what the Scribe made of every prompt, with the way back. Reverting and sorting go through the
// server, which owns the trace; bugs from tests and annotations join the timeline from the issues themselves.
import { useState } from 'react'
import type { Project, TraceEvent } from '@aforge/shared'
import { useStudio } from '../studio'
import { Glyph, TypeIcon, type GlyphName } from '../components/Glyphs'
import { StudioLink } from './IdeStage'

type Open = { kind: 'story'; id: string } | { kind: 'wiki'; id: string } | { kind: 'file'; repo: string; path: string }

/** Items the Scribe created and nobody reverted: the board marks them AUTO. */
export const autoCreated = (p: Pick<Project, 'trace'>) =>
  new Set((p.trace ?? []).filter((e) => e.auto && !e.reverted && e.revert?.type === 'created').map((e) => e.ref!))

const ICON: Record<TraceEvent['kind'], { glyph?: GlyphName; type?: 'epic' | 'story' | 'task' }> = {
  prompt: { glyph: 'chat' }, epic: { type: 'epic' }, story: { type: 'story' }, criterion: { type: 'story' }, task: { type: 'task' },
  wiki: { glyph: 'wiki' }, contract: { glyph: 'api' }, unsorted: { glyph: 'search' }, proposal: { glyph: 'spark' },
}
const time = (at: string) => new Date(at).toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' })

export const IdeTrace = ({ onClose, onOpen }: { onClose: () => void; onOpen: (t: Open) => void }) => {
  const s = useStudio()
  const p = s.project
  const [tab, setTab] = useState<'time' | 'backlog' | 'wiki'>('time')
  const trace = p.trace ?? []
  const since = trace[0]?.at ?? ''
  // Bugs are written by tests and annotations, not the Scribe: they show by when they appeared.
  const bugs = (p.issues ?? []).filter((i) => i.type === 'bug' && since && i.createdAt >= since)
  const rows = [...trace.map((e) => ({ at: e.at, e })), ...bugs.map((b) => ({ at: b.createdAt, bug: b }))].sort((a, b) => b.at.localeCompare(a.at))
  const auto = autoCreated(p)
  const act = (path: string, body?: unknown) => s.act(`/ide/trace/${path}`, body)
  const openRef = (e: TraceEvent) => {
    if (!e.ref) return
    if (e.kind === 'wiki') return onOpen({ kind: 'wiki', id: e.ref })
    const issue = p.issues?.find((i) => i.id === e.ref)
    if (issue) return issue.storyId ? onOpen({ kind: 'story', id: issue.storyId }) : issue.files[0] && onOpen({ kind: 'file', repo: issue.repoId, path: issue.files[0].path })
    if (p.stories.some((x) => x.id === e.ref)) onOpen({ kind: 'story', id: e.ref })
  }

  return (
    <aside className="ide-trace card-pane flush" role="dialog" aria-label="Stopa" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header>
        <Glyph name="trace" size={15} /><b>Stopa</b>
        <div className="segmented">
          <button className={tab === 'time' ? 'active' : ''} onClick={() => setTab('time')}>Časová osa</button>
          <button className={tab === 'backlog' ? 'active' : ''} onClick={() => setTab('backlog')}>Backlog</button>
          <button className={tab === 'wiki' ? 'active' : ''} onClick={() => setTab('wiki')}>Wiki</button>
        </div>
        <span className="spacer" />
        <button className="tool-btn" onClick={onClose} title="Zavřít (Esc)" autoFocus>×</button>
      </header>
      <div className="pane-scroll ide-trace-body">
        {tab === 'time' && (!rows.length ? <p className="muted ide-pad">Zatím nic. Každý požadavek z composeru tu nechá stopu.</p> : rows.map((r) => {
          if ('bug' in r && r.bug) return (
            <div key={`bug:${r.bug.id}`} className="tev">
              <time>{time(r.at)}</time><TypeIcon type="bug" size={16} />
              <div className="what">
                <span><span className="key">{r.bug.id}</span> {r.bug.title}</span>
                <span className="muted small">{r.bug.source === 'test' ? 'z padajícího testu' : r.bug.source === 'annotation' ? 'z anotace náhledu' : 'bug'}{r.bug.storyId ? ` · ${r.bug.storyId}` : ''}{r.bug.status === 'done' ? ' · uzavřen' : ''}</span>
                {r.bug.storyId && <span className="acts"><button className="link-btn" onClick={() => onOpen({ kind: 'story', id: r.bug!.storyId! })}>Otevřít</button></span>}
              </div>
            </div>
          )
          const e = (r as { e: TraceEvent }).e
          const icon = ICON[e.kind]
          const unsorted = e.kind === 'unsorted' && !e.resolved
          return (
            <div key={e.id} className={`tev ${e.kind === 'prompt' ? 'prompt' : ''} ${e.reverted ? 'reverted' : ''}`}>
              <time>{time(e.at)}</time>
              {icon.type ? <TypeIcon type={icon.type} size={16} /> : <span className={unsorted ? 'unsure' : ''}><Glyph name={icon.glyph!} size={15} /></span>}
              <div className="what">
                <span>{e.kind === 'prompt' ? `„${e.title}“` : e.title}{e.auto && !e.reverted && e.kind !== 'prompt' && <span className="auto-badge">AUTO</span>}{e.reverted && <span className="auto-badge warn">VRÁCENO</span>}</span>
                {e.detail && <span className={`small ${unsorted ? 'unsure' : 'muted'}`}>{e.detail}</span>}
                {!s.readOnly && <span className="acts">
                  {e.ref && e.kind !== 'prompt' && !e.reverted && <button className="link-btn" onClick={() => openRef(e)}>Otevřít</button>}
                  {e.revert && !e.reverted && <button className="link-btn" onClick={() => void act(`${e.id}/revert`)}><Glyph name="undo" size={12} />{e.kind === 'wiki' ? 'Vrátit předchozí verzi' : 'Vrátit'}</button>}
                  {unsorted && <>
                    {e.candidates?.map((id) => <button key={id} className="link-btn" onClick={() => void act(`${e.id}/assign`, { target: id })}>{id}</button>)}
                    {e.draft && <button className="link-btn" onClick={() => void act(`${e.id}/assign`, { target: 'new' })}>Nová story</button>}
                    <button className="link-btn" onClick={() => void act(`${e.id}/assign`, { target: 'ignore' })}>Neevidovat</button>
                  </>}
                  {e.kind === 'proposal' && <button className="link-btn" onClick={() => s.setAgentOpen(true)}>Otevřít konzultanta</button>}
                </span>}
              </div>
            </div>
          )
        }))}
        {tab === 'backlog' && <div className="ide-pad">
          {[...(p.epics ?? []), null].map((epic) => {
            const stories = p.stories.filter((x) => (epic ? x.epicId === epic.id : !x.epicId || !(p.epics ?? []).some((e) => e.id === x.epicId)))
            if (!stories.length) return null
            return <div key={epic?.id ?? 'none'} className="ide-trace-epic">
              <div className="row-gap">{epic ? <><TypeIcon type="epic" size={14} /><span className="key">{epic.id}</span><b>{epic.title}</b>{auto.has(epic.id) && <span className="auto-badge">AUTO</span>}</> : <b className="muted">Bez epicu</b>}</div>
              {stories.map((x) => <button key={x.id} className="ide-row" onClick={() => onOpen({ kind: 'story', id: x.id })}>
                <TypeIcon type="story" size={13} /><span className="key">{x.id}</span><span className="ell grow">{x.title}</span>{auto.has(x.id) && <span className="auto-badge">AUTO</span>}
                <span className="muted small num">{(p.issues ?? []).filter((i) => i.storyId === x.id).length}</span>
              </button>)}
            </div>
          })}
          {!p.stories.length && <p className="muted">Backlog je prázdný.</p>}
        </div>}
        {tab === 'wiki' && <div className="ide-pad">
          {(p.wiki ?? []).map((w) => <button key={w.id} className="ide-row" onClick={() => onOpen({ kind: 'wiki', id: w.id })}>
            <Glyph name="wiki" size={13} /><span className="ell grow">{w.title || w.draft?.title}</span>
            {w.draft ? <span className="auto-badge warn">NÁVRH</span> : <span className="muted small">{w.history.length + 1}. verze</span>}
          </button>)}
          {!(p.wiki ?? []).length && <p className="muted">Wiki zatím nemá stránky.</p>}
        </div>}
      </div>
      <footer><span className="muted small">Kód vždy čeká na vaši revizi. Záznamy AUTO jdou vrátit.</span><span className="spacer" /><StudioLink /></footer>
    </aside>
  )
}
