// The consultant: sees the whole project, answers with proposals the user accepts or rejects, and lists
// consistency conflicts. The side panel holds the general thread; a story keeps its own anchored thread.
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Op, Project } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { Markdown } from './Markdown'
import { StatusIcon } from './Glyphs'

const STAGE_HINT: Record<string, string> = {
  overview: 'Zeptejte se týmu na cokoli k projektu',
  prompt: 'Co má agent připravit',
  design: 'Co má dělat vybraný prvek?',
  stories: 'Např. „Rozděl story na menší“',
  split: 'Např. „Jaké endpointy potřebujeme?“',
  build: 'Např. „Proč task selhal?“',
  code: 'Např. „Proč tu nevalidujeme vstup?“',
  preview: 'Např. „Tlačítko Uložit je moc schované“',
  tests: 'Např. „Proč padá test?“',
  wiki: 'Např. „Popiš rezervace jednodušeji“',
}

export const describeOp = (op: Op, project: Project): string => {
  switch (op.type) {
    case 'story.upsert':
      return `Story ${op.story.id}: ${op.story.title}`
    case 'story.delete':
      return `Smazat story ${op.id}`
    case 'epic.upsert':
      return `Epic ${op.epic.id}: ${op.epic.title}`
    case 'issue.upsert':
      return `${op.issue.type === 'bug' ? 'Bug' : 'Task'} ${op.issue.id === 'new' ? 'nový' : op.issue.id} pod ${op.issue.storyId}: ${op.issue.title}`
    case 'element.annotate': {
      const screen = project.screens.find((s) => s.id === op.screenId)
      const name = screen?.elements.find((e) => e.id === op.id)?.name ?? op.id
      const what = [op.note !== undefined && 'poznámka', op.storyIds && `stories ${op.storyIds.join(', ') || '–'}`, op.work !== undefined && (op.work ? 'rozpracovat' : 'nerozpracovávat')].filter(Boolean)
      return `Objekt „${name}“ na ${screen?.name ?? op.screenId}: ${what.join(', ')}`
    }
    case 'diagram.upsert':
      return `Diagram (${op.diagram.type}): ${op.diagram.title}`
    case 'diagram.delete':
      return `Smazat diagram ${op.id}`
    case 'file.write':
      return `Zapsat soubor ${op.path}`
    case 'file.delete':
      return `Smazat soubor ${op.path}`
    case 'annotation.resolve':
      return `Uzavřít anotaci ${op.id}`
  }
}

/** One agent message with its conflicts and the proposals to accept or reject. */
export const AgentMessage = ({ m }: { m: ChatMessage }) => {
  const s = useStudio()
  const decide = async (pid: string, action: 'accept' | 'reject') => {
    await s.flush()
    try {
      const res = await api<{ project: Project; chat: ChatMessage[] }>(`/projects/${s.project.id}/chat/${m.id}/proposals/${pid}/${action}`, { body: {} })
      s.setChat(res.chat)
      await s.reload()
    } catch (e) {
      s.toast((e as Error).message, true)
    }
  }
  if (m.role === 'user') return <div className="msg user">{m.text}</div>
  return (
    <div className="msg agent">
      <div className="bubble"><Markdown text={m.text} /></div>
      {m.conflicts.map((c) => (
        <div key={c.id} className={`conflict ${c.severity}`}>
          <span style={{ color: c.severity === 'error' ? 'var(--red)' : c.severity === 'info' ? 'var(--accent)' : 'var(--orange)' }}><Icon.warn /></span>
          <div>{c.message}{c.refs.length > 0 && <div className="muted conflict-refs">{c.refs.join(', ')}</div>}</div>
        </div>
      ))}
      {m.proposals.map((p) => (
        <div key={p.id} className={`proposal ${p.status !== 'pending' ? 'done' : ''}`}>
          <div className="proposal-head">
            <StatusIcon shape={p.status === 'accepted' ? 'ok' : p.status === 'rejected' ? 'err' : 'wait'} label={p.status === 'accepted' ? 'Přijato' : p.status === 'rejected' ? 'Odmítnuto' : 'Ke schválení'} />
            <span style={{ flex: 1 }}>{p.title}</span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.rationale}</div>
          <ul className="proposal-ops">
            {p.ops.slice(0, 6).map((op, i) => <li key={i}>{describeOp(op, s.project)}</li>)}
            {p.ops.length > 6 && <li>… a dalších {p.ops.length - 6} změn</li>}
          </ul>
          {p.status === 'pending' && !s.readOnly && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn primary small" onClick={() => void decide(p.id, 'accept')}><Icon.check /> Přijmout</button>
              <button className="btn small" onClick={() => void decide(p.id, 'reject')}>Odmítnout</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const Typing = () => <div className="msg agent"><div className="bubble typing"><span /><span /><span /></div></div>

export const Composer = ({ placeholder, onSend }: { placeholder?: string; onSend: (text: string) => void }) => {
  const s = useStudio()
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t || s.agentBusy) return
    setText('')
    onSend(t)
  }
  return (
    <div className="composer-box">
      <textarea
        rows={1}
        value={text}
        disabled={s.readOnly}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
      />
      <button className="send" disabled={!text.trim() || s.agentBusy} onClick={send} title="Odeslat (Enter)"><Icon.send /></button>
    </div>
  )
}

/** The thread of one story or issue, inside its detail. */
export const AnchoredThread = ({ anchor, placeholder }: { anchor: string; placeholder: string }) => {
  const s = useStudio()
  const messages = s.chat.filter((m) => m.anchor === anchor)
  return (
    <div className="thread">
      {messages.map((m) => <AgentMessage key={m.id} m={m} />)}
      {s.agentBusy && <Typing />}
      <Composer placeholder={placeholder} onSend={(text) => void s.askAgent({ text, anchor })} />
    </div>
  )
}

export const AgentPanel = () => {
  const s = useStudio()
  const logRef = useRef<HTMLDivElement>(null)
  const messages = s.chat.filter((m) => !m.anchor)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, s.agentBusy])

  return (
    <aside className="agent">
      <div className="agent-head">
        <span className="agent-avatar"><Icon.sparkles size={13} /></span>
        Konzultant
        <span className="spacer" />
        {!s.readOnly && <button className="tool-btn" title="Vymazat konverzaci" onClick={() => void api(`/projects/${s.project.id}/chat`, { method: 'DELETE' }).then(() => s.setChat([]))}><Icon.trash /></button>}
        <button className="tool-btn" title="Zavřít (⌘J)" onClick={() => s.setAgentOpen(false)}><Icon.x /></button>
      </div>
      <div className="agent-log" ref={logRef}>
        {!messages.length && !s.agentBusy && <div className="empty" style={{ fontSize: 13 }}>Zeptejte se na cokoli k projektu.</div>}
        {messages.map((m) => <AgentMessage key={m.id} m={m} />)}
        {s.agentBusy && s.pendingText && <div className="msg user">{s.pendingText}</div>}
        {s.agentBusy && <Typing />}
      </div>
      <div className="composer"><Composer placeholder={STAGE_HINT[s.stage]} onSend={(text) => void s.askAgent({ text })} /></div>
    </aside>
  )
}
