// The orchestrated pipeline of the open project and its agent runs. Workers and the relay live on the
// global Agents and Settings pages.
import { useState } from 'react'
import type { PipelineRun, PipelineTask } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { AgentRuns } from '../components/AgentRuns'
import { useHub } from '../components/Workers'

const PHASE_LABEL: Record<PipelineTask['phase'], string> = {
  stories: 'Stories',
  wireframes: 'Design',
  blocks: 'Bloky',
  review: 'Review',
  build: 'Build',
  tests: 'Testy',
}

const TASK_STATUS: Record<PipelineTask['status'], { label: string; cls: string }> = {
  pending: { label: 'Čeká', cls: 'gray' },
  running: { label: 'Běží', cls: '' },
  awaiting: { label: 'Ke schválení', cls: 'orange' },
  done: { label: 'Hotovo', cls: 'green' },
  failed: { label: 'Chyba', cls: 'red' },
  skipped: { label: 'Přeskočeno', cls: 'gray' },
}

const RUN_STATUS: Record<PipelineRun['status'], string> = {
  planning: 'Orchestrátor plánuje…',
  running: 'Běží',
  done: 'Dokončeno',
  failed: 'Skončilo chybou',
  cancelled: 'Zrušeno',
}

export const AgentsView = () => {
  const s = useStudio()
  const { hub, error } = useHub()
  const [goal, setGoal] = useState('')
  const [autoApply, setAutoApply] = useState(false)
  const run = s.pipeline
  const live = run && (run.status === 'planning' || run.status === 'running')
  const projectId = s.project.session?.projectId ?? s.project.id

  return (
    <>
      <div className="pane-bar">
        <h2>Agenti</h2>
      </div>
      <div className="pane-scroll" style={{ padding: 16 }}>
        <h3 className="section-title">Pipeline</h3>
        <div className="group-box">
          <textarea className="field" rows={3} value={goal} disabled={!!live} onChange={(e) => setGoal(e.target.value)} placeholder="Cíl pro orchestrátor. Prázdné = dotáhnout aplikaci podle stories." />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <input type="checkbox" checked={autoApply} disabled={!!live} onChange={(e) => setAutoApply(e.target.checked)} />
              Přijímat návrhy automaticky
            </label>
            {live ? (
              <button className="btn" onClick={() => void api(`/projects/${s.project.id}/pipeline/cancel`, { body: {} })}><Icon.stop /> Zrušit</button>
            ) : (
              <button
                className="btn primary"
                disabled={s.readOnly}
                onClick={async () => {
                  await s.flush()
                  try { s.setPipeline(await api<PipelineRun>(`/projects/${s.project.id}/pipeline`, { body: { goal, autoApply } })) }
                  catch (e) { s.toast((e as Error).message, true) }
                }}
              >
                <Icon.play /> Spustit
              </button>
            )}
          </div>
        </div>
        {run && (
          <div className="group-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {live && <span className="dot run" />}
              <strong style={{ flex: 1 }}>{RUN_STATUS[run.status]}</strong>
              <span className="muted" style={{ fontSize: 11 }}>{new Date(run.startedAt).toLocaleString('cs')}</span>
            </div>
            {run.summary && <div className="muted" style={{ marginBottom: 8 }}>{run.summary}</div>}
            {run.tasks.map((t) => (
              <div key={t.id} className="pipeline-task">
                <span className="muted mono">{t.id}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }} title={t.instruction}>{t.title}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{[PHASE_LABEL[t.phase], t.dependsOn.length ? `po ${t.dependsOn.join(', ')}` : '', t.note ?? ''].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={`task-state ${TASK_STATUS[t.status].cls}`}>
                  {t.status === 'running' && <span className="dot run" />}
                  {TASK_STATUS[t.status].label}
                </span>
              </div>
            ))}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {hub && <AgentRuns runs={hub.runs.filter((r) => r.projectId === projectId || r.rootProjectId === projectId)} />}
      </div>
    </>
  )
}
