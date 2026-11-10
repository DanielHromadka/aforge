import { useState } from 'react'
import { STEP_TITLES, STAGES, WORKFLOW_PRESETS, WorkflowSchema, workflowOf, workflowPreset, withWorkflowSteps, type Stage, type Workflow } from '@aforge/shared'
import { useStudio } from '../studio'
import { Dialog } from './Dialog'
import { api } from '../api'

export const WorkflowEditor = ({ onClose }: { onClose: () => void }) => {
  const s = useStudio()
  const [draft, setDraft] = useState<Workflow>(() => structuredClone(workflowOf(s.project)))
  const [kind, setKind] = useState<Stage>('prompt')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (steps: Workflow['steps']) => setDraft((w) => withWorkflowSteps(w, steps))
  const move = (index: number, delta: number) => {
    const steps = [...draft.steps]; const target = index + delta
    if (target < 0 || target >= steps.length) return
    ;[steps[index], steps[target]] = [steps[target]!, steps[index]!]; change(steps)
  }
  const add = (id?: string) => {
    const restored = draft.retained.find((step) => id ? step.id === id : kind !== 'prompt' && step.kind === kind)
    change([...draft.steps, restored ?? { id: kind === 'prompt' ? `custom-${crypto.randomUUID()}` : kind, kind, label: kind === 'prompt' ? 'Vlastní krok' : STEP_TITLES[kind], prompt: '' }])
  }
  const save = async () => {
    const result = WorkflowSchema.safeParse(draft)
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Zkontrolujte kroky workflow.'); return }
    setBusy(true); setError('')
    try {
      if (!(await s.flush())) throw new Error('Nejprve je třeba uložit rozpracované změny.')
      await api(`/projects/${s.project.id}`, { method: 'PUT', body: { ...s.project, workflow: result.data } })
      await s.reload()
      if (result.data.preset === 'vibe') s.setAgentOpen(false)
      s.toast('Workflow uloženo.'); onClose()
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return <Dialog width={760} onClose={() => { if (!busy) onClose() }}>
    <h3>Workflow session</h3>
    <p className="muted">Vyberte výchozí režim a upravte jeho kroky. Dosavadní podklady i prompty zůstanou uložené. Prompt každého kroku upravíte po jeho otevření.</p>
    <div className="workflow-presets" role="group" aria-label="Předvolby workflow">{Object.entries(WORKFLOW_PRESETS).map(([id, preset]) => <button key={id} className={`workflow-preset ${draft.preset === id ? 'selected' : ''}`} aria-pressed={draft.preset === id} disabled={s.readOnly || busy} onClick={() => setDraft(workflowPreset(id as keyof typeof WORKFLOW_PRESETS, draft))}><strong>{preset.label}</strong><span>{preset.description}</span><small>{preset.kinds.map((k) => STEP_TITLES[k]).join(' → ')}</small></button>)}</div>
    <div className="workflow-list-head"><h4>Kroky workflow</h4><span className="muted">{draft.steps.length} / 24</span></div>
    <ol className="workflow-editor-steps">{draft.steps.map((step, i) => <li key={step.id}>
      <span className="workflow-index">{i + 1}</span><div className="workflow-step-fields"><label><span className="sr-only">Název kroku {i + 1}</span><input className="field" aria-label={`Název kroku ${i + 1}`} value={step.label} maxLength={80} readOnly={s.readOnly} disabled={busy} onChange={(e) => change(draft.steps.map((st) => st.id === step.id ? { ...st, label: e.target.value } : st))} /></label><small className="muted">{step.kind === 'prompt' ? 'Vlastní promptový krok' : STEP_TITLES[step.kind]} · {step.prompt.trim() ? 'Prompt vyplněný' : 'Volitelný prompt je prázdný'}</small></div>
      {!s.readOnly && <div className="workflow-row-actions"><button className="btn small" aria-label={`Posunout ${step.label} nahoru`} disabled={i === 0 || busy} onClick={() => move(i, -1)}>↑</button><button className="btn small" aria-label={`Posunout ${step.label} dolů`} disabled={i === draft.steps.length - 1 || busy} onClick={() => move(i, 1)}>↓</button><button className="btn small" aria-label={`Odebrat ${step.label}`} disabled={draft.steps.length === 1 || busy} onClick={() => change(draft.steps.filter((st) => st.id !== step.id))}>Odebrat</button></div>}
    </li>)}</ol>
    {!s.readOnly && <div className="workflow-add"><select className="field" aria-label="Typ nového kroku" disabled={busy} value={kind} onChange={(e) => setKind(e.target.value as Stage)}>{STAGES.map((k) => <option key={k} value={k} disabled={k !== 'prompt' && draft.steps.some((st) => st.kind === k)}>{k === 'prompt' ? 'Vlastní krok s promptem' : STEP_TITLES[k]}</option>)}</select><button className="btn" disabled={busy || draft.steps.length >= 24 || (kind !== 'prompt' && draft.steps.some((st) => st.kind === kind))} onClick={() => add()}>Přidat krok</button></div>}
    {!!draft.retained.length && <details className="workflow-retained"><summary>Odložené kroky a prompty ({draft.retained.length})</summary>{draft.retained.map((step) => <div key={step.id}><span>{step.label} · {step.prompt.trim() ? 'Prompt uložený' : 'Prázdný prompt'}</span>{!s.readOnly && <button className="btn small" disabled={busy || draft.steps.length >= 24 || (step.kind !== 'prompt' && draft.steps.some((st) => st.kind === step.kind))} onClick={() => add(step.id)}>Vrátit krok</button>}</div>)}</details>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="dialog-actions"><button className="btn" disabled={busy} onClick={onClose}>{s.readOnly ? 'Zavřít' : 'Zrušit'}</button>{!s.readOnly && <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Ukládám…' : 'Uložit workflow'}</button>}</div>
  </Dialog>
}
