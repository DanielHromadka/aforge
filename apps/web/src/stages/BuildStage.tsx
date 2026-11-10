// Build in two parts. Bloky: Claude turns the design and the stories into the architecture – the chosen
// stack and Mermaid diagrams of the right type with a logical description of every step. Implementace: the
// refined implementation prompt and the files that will really change, both editable; Build hands them to
// Claude Code or Codex and streams its work.
import { useEffect, useRef, useState } from 'react'
import type { Diagram, Project } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { ActionButton } from '../components/ActionButton'
import { useStudio, type BuildPart } from '../studio'
import { Markdown } from '../components/Markdown'
import { Mermaid } from '../components/Mermaid'

export const LogView = ({ lines, empty }: { lines: { kind: string; text: string }[]; empty: string }) => {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <pre className="log" ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {lines.length === 0 && <span style={{ opacity: 0.5 }}>{empty}</span>}
      {lines.map((l, i) => (
        <div key={i} className={`l-${l.kind === 'error' ? 'err' : l.kind}`}>
          {l.kind === 'tool' ? '▸ ' : l.kind === 'text' ? '◆ ' : ''}
          {l.text}
        </div>
      ))}
    </pre>
  )
}

const PARTS: { id: BuildPart; label: string }[] = [
  { id: 'blocks', label: '1 · Bloky' },
  { id: 'plan', label: '2 · Implementace' },
]

const DIAGRAM_LABEL: Record<Diagram['type'], string> = { flowchart: 'Architektura', sequence: 'Průběh', state: 'Workflow', er: 'Data', class: 'Typy' }

export const BuildStage = () => {
  const s = useStudio()
  const { project, providers } = s
  const [spec, setSpec] = useState<string | null>(null)

  const build = async () => {
    if (!(await s.flush())) return
    try {
      s.setBuilding(true)
      s.setBuildPart('plan')
      await api(`/projects/${project.id}/build`, { body: { stepId: s.activeStep.id } })
    } catch (e) {
      s.setBuilding(false)
      s.toast((e as Error).message, true)
    }
  }

  const agentAvailable = project.stack.agent === 'codex' ? providers?.codex : providers?.claude

  return (
    <>
      <div className="pane-bar">
        <h2>Build</h2>
        <div className="segmented small" role="tablist">
          {PARTS.map((p) => (
            <button key={p.id} role="tab" aria-selected={s.buildPart === p.id} className={s.buildPart === p.id && spec === null ? 'active' : ''} onClick={() => (setSpec(null), s.setBuildPart(p.id))}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button
          className="tool-btn"
          onClick={async () => {
            await s.flush()
            setSpec(spec === null ? (await api<{ spec: string }>(`/projects/${project.id}/spec`)).spec : null)
          }}
          title="AFORGE_SPEC.md, jak ho dostane implementující agent"
        >
          <Icon.stories /> {spec === null ? 'Specifikace' : 'Zpět'}
        </button>
        <select className="field" style={{ width: 130 }} value={project.stack.agent} disabled={s.building} onChange={(e) => s.update((p) => ({ ...p, stack: { agent: e.target.value as Project['stack']['agent'] } }))} title="Kdo bude implementovat">
          <option value="claude">Claude Code</option>
          <option value="codex">OpenAI Codex</option>
        </select>
        <ActionButton className="btn primary" disabled={!agentAvailable || s.generating !== null} busy={s.building} busyLabel="Build běží…" icon={<Icon.play />} onClick={build}
          title={!agentAvailable ? 'Implementující agent není nainstalovaný' : project.buildPlan ? 'Implementovat podle implementačního promptu' : 'Bez implementačního promptu agent vyjde jen ze zadání, stories a bloků'}>Build</ActionButton>
        {s.building && <ActionButton busyLabel="Zastavuji…" icon={<Icon.stop />} onClick={() => api(`/projects/${project.id}/build/stop`, { body: {} })}>Zastavit</ActionButton>}
      </div>
      {spec !== null ? (
        <div className="pane-scroll" style={{ padding: '16px 24px' }}>
          <Markdown text={spec} />
        </div>
      ) : s.buildPart === 'blocks' ? (
        <BlocksPart />
      ) : (
        <PlanPart agentAvailable={Boolean(agentAvailable)} />
      )}
    </>
  )
}

// ---- 1 · Bloky -------------------------------------------------------------------------------

const BlocksPart = () => {
  const s = useStudio()
  const arch = s.project.architecture
  const busy = s.generating === 'blocks'
  const updateDiagram = (id: string, patch: Partial<Diagram>) =>
    s.update((p) => (p.architecture ? { ...p, architecture: { ...p.architecture, diagrams: p.architecture.diagrams.map((d) => (d.id === id ? { ...d, ...patch } : d)) } } : p))
  const removeDiagram = (id: string) => s.update((p) => (p.architecture ? { ...p, architecture: { ...p.architecture, diagrams: p.architecture.diagrams.filter((d) => d.id !== id) } } : p))

  if (!arch)
    return (
      <div className="empty">
        <div>
          Bloky zatím nejsou navržené.
          <p>Agent z designu, zadání a promptů navrhne stack a diagramy aplikace (FE, BE, DB, průběhy, workflow, data) s popisem každého kroku.</p>
          <ActionButton className="btn primary" disabled={s.generating !== null} busy={busy} busyLabel="Architekt navrhuje…" icon={<Icon.sparkles />} onClick={() => s.generate('blocks')}>Navrhnout bloky</ActionButton>
        </div>
      </div>
    )

  return (
    <div className="pane-scroll build-part">
      <div className="arch-head group-box">
        <div className="arch-stack">
          {(['frontend', 'backend', 'database'] as const).map((k) => (
            <div key={k}>
              <span className="muted">{{ frontend: 'Frontend', backend: 'Backend', database: 'Databáze' }[k]}</span>
              <strong>{arch.stack[k] || '–'}</strong>
            </div>
          ))}
          <span className="spacer" />
          <ActionButton className="btn small" disabled={s.generating !== null} busy={busy} busyLabel="Navrhuji…" icon={<Icon.sparkles />} title="Navrhnout znovu ze zadání, promptů a kontextu" onClick={() => s.generate('blocks')}>Navrhnout znovu</ActionButton>
        </div>
        <p className="muted">{arch.stack.reason}</p>
        <p>{arch.summary}</p>
      </div>
      {arch.diagrams.map((d) => (
        <DiagramCard key={d.id} d={d} onChange={(patch) => updateDiagram(d.id, patch)} onRemove={() => removeDiagram(d.id)} />
      ))}
      <button className="btn" onClick={() => s.setBuildPart('plan')}>
        Pokračovat na implementaci →
      </button>
    </div>
  )
}

const DiagramCard = ({ d, onChange, onRemove }: { d: Diagram; onChange: (p: Partial<Diagram>) => void; onRemove: () => void }) => {
  const [editing, setEditing] = useState(false)
  return (
    <section className="diagram-card group-box">
      <div className="diagram-head">
        <h3>{d.title}</h3>
        <span className="chip">{DIAGRAM_LABEL[d.type]}</span>
        {d.storyIds.map((id) => (
          <span key={id} className="chip gray">
            {id}
          </span>
        ))}
        <span className="spacer" />
        <button className="btn small" onClick={() => setEditing(!editing)}>
          {editing ? 'Hotovo' : 'Upravit text'}
        </button>
        <button className="btn small danger" onClick={onRemove} title="Odebrat diagram">
          <Icon.trash />
        </button>
      </div>
      {d.description && <p className="muted">{d.description}</p>}
      <div className={editing ? 'diagram-edit' : ''}>
        {editing && <textarea className="field mono" spellCheck={false} value={d.mermaid} onChange={(e) => onChange({ mermaid: e.target.value })} />}
        <Mermaid source={d.mermaid} />
      </div>
      {d.steps.length > 0 && (
        <dl className="diagram-steps">
          {d.steps.map((st, i) => (
            <div key={i}>
              <dt>{st.name}</dt>
              <dd>{st.description}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

// ---- 2 · Implementace ------------------------------------------------------------------------

const ACTION: Record<'create' | 'modify' | 'delete', { label: string; cls: string }> = {
  create: { label: 'nový', cls: 'green' },
  modify: { label: 'změna', cls: 'orange' },
  delete: { label: 'smazat', cls: 'red' },
}

const PlanPart = ({ agentAvailable }: { agentAvailable: boolean }) => {
  const s = useStudio()
  const { project } = s
  const plan = project.buildPlan
  const busy = s.generating === 'plan'
  const [side, setSide] = useState<'changes' | 'log'>(s.building ? 'log' : 'changes')
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    if (s.building) setSide('log')
  }, [s.building])

  const checks: [boolean, string][] = [
    [project.screens.length > 0, 'Design z Figmy'],
    [project.stories.length > 0, `${project.stories.length} user stories`],
    [Boolean(project.architecture), 'Navržené bloky'],
    [Boolean(plan), 'Implementační prompt'],
    [agentAvailable, `${project.stack.agent === 'codex' ? 'Codex' : 'Claude Code'} je nainstalovaný`],
  ]

  return (
    <div className="split plan-split">
      <div className="plan-prompt">
        <div className="pane-bar">
          <h3>Implementační prompt</h3>
          {plan && <span className="muted">{new Date(plan.generatedAt).toLocaleString('cs-CZ')}</span>}
          <span className="spacer" />
          {plan && (
            <button className={`tool-btn ${preview ? 'pressed' : ''}`} onClick={() => setPreview(!preview)}>
              Náhled
            </button>
          )}
          <ActionButton className="btn small" disabled={s.generating !== null} busy={busy} busyLabel="Skládám…" icon={<Icon.sparkles />} title="Složit ze zadání, promptů, designu, stories a bloků" onClick={() => s.generate('plan')}>{plan ? 'Sestavit znovu' : 'Sestavit prompt'}</ActionButton>
        </div>
        {!plan ? (
          <div className="empty">
            <div>
              Implementační prompt zatím není sestavený.
              <p>Agent ho složí z promptů sekcí, designu, user stories a bloků, a vypíše soubory, které se v kódu změní. Pak ho můžete upravit a spustit Build.</p>
            </div>
          </div>
        ) : preview ? (
          <div className="pane-scroll" style={{ padding: '12px 18px' }}>
            <Markdown text={plan.prompt} />
          </div>
        ) : (
          <textarea className="plan-editor mono" spellCheck={false} value={plan.prompt} onChange={(e) => s.update((p) => (p.buildPlan ? { ...p, buildPlan: { ...p.buildPlan, prompt: e.target.value } } : p))} />
        )}
      </div>
      <div className="inspector plan-side">
        <div className="segmented small" style={{ marginBottom: 10 }}>
          <button className={side === 'changes' ? 'active' : ''} onClick={() => setSide('changes')}>
            Změny v kódu{plan ? ` (${plan.changes.length})` : ''}
          </button>
          <button className={side === 'log' ? 'active' : ''} onClick={() => setSide('log')}>
            Průběh buildu{s.building ? ' ●' : ''}
          </button>
        </div>
        {side === 'log' ? (
          <LogView lines={s.buildLog} empty="Zde se zobrazí průběh práce agenta." />
        ) : (
          <>
            <div className="group-box">
              {plan?.changes.length ? (
                plan.changes.map((c) => (
                  <div key={`${c.action}:${c.path}`} className="change-row" title={c.reason}>
                    <span className={`chip ${ACTION[c.action].cls}`}>{ACTION[c.action].label}</span>
                    <code>{c.path}</code>
                    <div className="muted">{c.reason}</div>
                  </div>
                ))
              ) : (
                <span className="muted">Seznam souborů vznikne se sestavením promptu.</span>
              )}
            </div>
            <h3>Připravenost</h3>
            <div className="group-box">
              {checks.map(([ok, label]) => (
                <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                  <span className={`dot ${ok ? 'ok' : 'warn'}`} /> {label}
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Build zapíše <code>AFORGE_SPEC.md</code> (implementační prompt, plán změn, stack, bloky, stories, design a běhový kontrakt) do repozitáře projektu a spustí agenta. Prázdný repozitář dostane
              kompletní implementaci, existující aplikace jen změny. Výsledek se commitne.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
