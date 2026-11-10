import { ActionButton } from '../components/ActionButton'
import { useStudio } from '../studio'
import { previewHref, api } from '../api'
import { LogView } from './BuildStage'

/** A prompt-only step can consult the agent or directly implement the application. */
export const PromptStage = () => {
  const s = useStudio()
  const available = s.project.stack.agent === 'codex' ? s.providers?.codex : s.providers?.claude
  const run = async () => {
    if (!(await s.flush())) return
    try {
      s.setBuilding(true)
      await api(`/projects/${s.project.id}/build`, { body: { stepId: s.activeStep.id } })
    } catch (e) { s.setBuilding(false); s.toast((e as Error).message, true) }
  }
  return <>
    <div className="pane-bar"><h2>{s.activeStep.label}</h2><span className="spacer" /><span className="muted">{s.readOnly ? 'Pouze pro čtení' : s.activeStep.id === 'prompt' ? 'Požadavek na aplikaci' : 'Vlastní krok'}</span></div>
    <div className="prompt-layout">
    <div className="workflow-prompt-stage">
      <label htmlFor="workflow-main-prompt">Co má agent připravit?</label>
      <textarea id="workflow-main-prompt" className="field" value={s.activeStep.prompt} readOnly={s.readOnly} placeholder="Popište aplikaci nebo další změnu." onChange={(e) => s.setStepPrompt(e.target.value)} />
      {!s.readOnly && <div className="workflow-prompt-actions">
        <select className="field" aria-label="Implementující agent" disabled={s.building} value={s.project.stack.agent} onChange={(e) => s.update((p) => ({ ...p, stack: { agent: e.target.value as 'claude' | 'codex' } }))}><option value="claude">Claude Code</option><option value="codex">Codex</option></select>
        <ActionButton disabled={s.building} busy={s.agentBusy} busyLabel="Agent odpovídá…" onClick={() => s.askAgent({ text: s.activeStep.prompt.trim() || `Pokračuj v kroku „${s.activeStep.label}“ podle dosavadního kontextu projektu.` })}>Konzultovat s agentem</ActionButton>
        <ActionButton className="btn primary" disabled={!available || s.generating !== null} busy={s.building} busyLabel="Implementuje se…" onClick={run}>Implementovat aplikaci</ActionButton>
        {s.building && <ActionButton busyLabel="Zastavuji…" onClick={() => api(`/projects/${s.project.id}/build/stop`, { body: {} }).catch((e: Error) => s.toast(e.message, true))}>Zastavit</ActionButton>}
      </div>}
      <LogView lines={s.buildLog.filter((l) => !l.issueId)} empty="Průběh implementace se zobrazí zde." />
    </div>
    {/* Vibe coding: the running app right beside the prompt. */}
    {s.project.workflow?.preset === 'vibe' && <div className="vibe-preview">
      {s.preview.url ? <iframe sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" title="Náhled aplikace" src={previewHref(s.project.id, s.preview.url)} /> : <div className="empty"><div>Náhled neběží.<p><ActionButton disabled={s.readOnly} busy={s.preview.state === 'starting'} busyLabel="Spouští se…" onClick={() => api(`/projects/${s.project.id}/preview/start`, { body: {} })}>Spustit náhled</ActionButton></p></div></div>}
    </div>}
    </div>
  </>
}
