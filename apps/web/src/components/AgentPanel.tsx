// The consultant: available in every stage, sees the whole project, answers with proposals the user
// accepts or rejects, and lists consistency conflicts.
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, Op, Project } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { Markdown } from './Markdown'

const INTENTS: { id: string; label: string }[] = [
  { id: 'check', label: 'Kontrola konzistence' },
  { id: 'stories', label: 'Navrhnout stories' },
  { id: 'wireframes', label: 'Navrhnout wireframy' },
  { id: 'blocks', label: 'Stories → bloky' },
  { id: 'annotations', label: 'Zpracovat anotace' },
  { id: 'tests', label: 'Rozebrat testy' },
]

const STAGE_HINT: Record<string, string> = {
  design: 'Např. „Přidej na přihlašovací obrazovku zapomenuté heslo“',
  stories: 'Např. „Rozděl US-2 na menší stories“',
  blocks: 'Např. „Jaké API endpointy potřebujeme pro objednávky?“',
  build: 'Např. „Jaké jsou rizika nasazení na Container Apps?“',
  code: 'Např. „Proč tento soubor nevalidujeme vstup?“',
  preview: 'Např. „Tlačítko Uložit je moc schované“',
  tests: 'Např. „Proč padá test US-3?“',
}

export const describeOp = (op: Op, project: Project): string => {
  switch (op.type) {
    case 'story.upsert':
      return `Story ${op.story.id}: ${op.story.title}`
    case 'story.delete':
      return `Smazat story ${op.id}`
    case 'screen.upsert':
      return `Obrazovka „${op.screen.name}“ (${op.screen.elements.length} prvků)`
    case 'screen.delete':
      return `Smazat obrazovku ${op.id}`
    case 'element.upsert':
      return `Prvek ${op.element.kind} „${op.element.label}“ na ${project.screens.find((s) => s.id === op.screenId)?.name ?? op.screenId}`
    case 'element.delete':
      return `Smazat prvek ${op.id}`
    case 'block.upsert':
      return `Blok ${op.node.kind}: ${op.node.label}`
    case 'block.delete':
      return `Smazat blok ${op.id}`
    case 'edge.upsert':
      return `Vazba ${op.edge.from} → ${op.edge.to}`
    case 'edge.delete':
      return `Smazat vazbu ${op.id}`
    case 'file.write':
      return `Zapsat soubor ${op.path}`
    case 'file.delete':
      return `Smazat soubor ${op.path}`
    case 'annotation.resolve':
      return `Uzavřít anotaci ${op.id}`
  }
}

export const AgentPanel = () => {
  const s = useStudio()
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [s.chat.length, s.agentBusy])

  const send = () => {
    const t = text.trim()
    if (!t || s.agentBusy) return
    setText('')
    void s.askAgent({ text: t })
  }

  const decide = async (msg: ChatMessage, pid: string, action: 'accept' | 'reject') => {
    await s.flush()
    try {
      const res = await api<{ project: Project; chat: ChatMessage[] }>(`/projects/${s.project.id}/chat/${msg.id}/proposals/${pid}/${action}`, { body: {} })
      s.setChat(res.chat)
      await s.reload()
    } catch (e) {
      s.toast((e as Error).message, true)
    }
  }

  const focusLabel = s.focus.filePath ?? s.focus.storyId ?? s.focus.elementId ?? s.project.screens.find((x) => x.id === s.focus.screenId)?.name

  return (
    <aside className="agent">
      <div className="agent-head">
        <span className="agent-avatar">
          <Icon.sparkles size={13} />
        </span>
        Agent
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
          vidí celý projekt
        </span>
        <span className="spacer" />
        <button
          className="tool-btn"
          title="Vymazat konverzaci"
          onClick={() => void api(`/projects/${s.project.id}/chat`, { method: 'DELETE' }).then(() => s.setChat([]))}
        >
          <Icon.trash />
        </button>
      </div>
      <div className="agent-intents">
        {INTENTS.map((i) => (
          <button key={i.id} className="btn small" disabled={s.agentBusy} onClick={() => void s.askAgent({ intent: i.id })}>
            {i.label}
          </button>
        ))}
      </div>
      <div className="agent-log" ref={logRef}>
        {!s.chat.length && !s.agentBusy && (
          <div className="empty" style={{ fontSize: 13 }}>
            <div>
              Zeptejte se na cokoli k projektu nebo navrhněte změnu.
              <p>Agent odpoví návrhy, které můžete přijmout nebo odmítnout, a upozorní na rozpory mezi stories, designem a kódem.</p>
            </div>
          </div>
        )}
        {s.chat.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="msg agent">
              <div className="msg-meta">Agent · {new Date(m.createdAt).toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' })}</div>
              <div className="bubble">
                <Markdown text={m.text} />
              </div>
              {m.conflicts.map((c) => (
                <div key={c.id} className={`conflict ${c.severity}`}>
                  <span style={{ color: c.severity === 'error' ? 'var(--red)' : c.severity === 'info' ? 'var(--accent)' : 'var(--orange)' }}>
                    <Icon.warn />
                  </span>
                  <div>
                    {c.message}
                    {c.refs.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {c.refs.map((r) => (
                          <span key={r} className="chip gray">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {m.proposals.map((p) => (
                <div key={p.id} className={`proposal ${p.status !== 'pending' ? 'done' : ''}`}>
                  <div className="proposal-head">
                    <span style={{ flex: 1 }}>{p.title}</span>
                    {p.status === 'accepted' && <span className="chip green">Přijato</span>}
                    {p.status === 'rejected' && <span className="chip gray">Odmítnuto</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {p.rationale}
                  </div>
                  <ul className="proposal-ops">
                    {p.ops.slice(0, 6).map((op, i) => (
                      <li key={i}>
                        <code>{op.type}</code> {describeOp(op, s.project)}
                      </li>
                    ))}
                    {p.ops.length > 6 && <li>… a dalších {p.ops.length - 6} změn</li>}
                  </ul>
                  {p.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn primary small" onClick={() => void decide(m, p.id, 'accept')}>
                        <Icon.check /> Přijmout
                      </button>
                      <button className="btn small" onClick={() => void decide(m, p.id, 'reject')}>
                        <Icon.x /> Odmítnout
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ),
        )}
        {s.agentBusy && s.pendingText && <div className="msg user">{s.pendingText}</div>}
        {s.agentBusy && (
          <div className="msg agent">
            <div className="bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <div className="composer">
        <div className="composer-box">
          <textarea
            rows={2}
            value={text}
            placeholder={STAGE_HINT[s.stage]}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="send" disabled={!text.trim() || s.agentBusy} onClick={send} title="Odeslat (Enter)">
            <Icon.send />
          </button>
        </div>
        <div className="composer-hint">
          Kontext: fáze {s.stage}
          {focusLabel ? ` · ${focusLabel}` : ''} · Enter odešle, ⇧Enter nový řádek
        </div>
      </div>
    </aside>
  )
}
