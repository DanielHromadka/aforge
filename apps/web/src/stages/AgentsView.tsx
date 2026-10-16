// Distributed agents: the hub's relay connection, the enrolled worker daemons and the orchestrated
// pipeline of the open project.
import { useCallback, useEffect, useState } from 'react'
import type { HubStatus, PipelineRun, PipelineTask } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { Dialog } from '../components/Dialog'

const PHASE_LABEL: Record<PipelineTask['phase'], string> = {
  stories: 'Stories',
  wireframes: 'Wireframy',
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
  const [hub, setHub] = useState<HubStatus>()
  const [relay, setRelay] = useState('')
  const [adding, setAdding] = useState(false)
  const [goal, setGoal] = useState('')
  const [autoApply, setAutoApply] = useState(false)

  const refresh = useCallback(async () => {
    const h = await api<HubStatus>('/hub')
    setHub(h)
    setRelay((r) => r || h.relay)
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(t)
  }, [refresh])

  const configure = async (body: { relay?: string; mode?: 'local' | 'remote' }) => {
    try {
      setHub(await api<HubStatus>('/hub', { method: 'PUT', body }))
    } catch (e) {
      s.toast((e as Error).message, true)
    }
  }

  const run = s.pipeline
  const live = run && (run.status === 'planning' || run.status === 'running')
  const online = hub?.workers.filter((w) => w.online).length ?? 0

  return (
    <>
      <div className="pane-bar">
        <h2>Agenti</h2>
        <span className="chip gray">
          <span className={`dot ${hub?.connected ? 'ok' : hub?.error ? 'err' : ''}`} /> {hub?.connected ? 'Relay připojen' : (hub?.error ?? 'Relay nepřipojen')}
        </span>
        <span className="muted">
          {online}/{hub?.workers.length ?? 0} workerů online
        </span>
        <span className="spacer" />
        <div className="segmented">
          <button className={hub?.mode === 'local' ? 'active' : ''} onClick={() => void configure({ mode: 'local' })}>
            Lokálně
          </button>
          <button className={hub?.mode === 'remote' ? 'active' : ''} onClick={() => void configure({ mode: 'remote' })}>
            Vzdálení workeři
          </button>
        </div>
      </div>
      <div className="pane-scroll" style={{ padding: 16, background: 'var(--window)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <div>
            <h3 className="section-title">Relay a workery</h3>
            <div className="group-box">
              <div className="form-row" style={{ gridTemplateColumns: '60px 1fr auto' }}>
                <label>Relay</label>
                <input className="field mono" value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="wss://relay.example.com" />
                <button className="btn" disabled={!hub || relay === hub.relay} onClick={() => void configure({ relay })}>
                  Uložit
                </button>
              </div>
              <p className="muted" style={{ fontSize: 11.5, margin: '0 0 0 68px' }}>
                aForge i workery se k relayi připojují odchozím WebSocketem; obsah je šifrovaný end-to-end klíčem každého workera. V režimu <b>Vzdálení workeři</b> běží konzultace, buildy i
                orchestrace na workerech, jinak lokálně.
              </p>
            </div>
            <div className="group-box" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="list-header" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 60px 34px' }}>
                <div>Worker</div>
                <div>Umí</div>
                <div>Štítky</div>
                <div>Úlohy</div>
                <div />
              </div>
              <div className="list-body">
                {!hub?.workers.length && <div className="muted" style={{ padding: 10 }}>Zatím žádný worker.</div>}
                {hub?.workers.map((w) => (
                  <div key={w.id} className="list-row" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 60px 34px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={w.id}>
                      <span className={`dot ${w.online ? 'ok' : ''}`} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {w.caps
                        ? (['claude', 'codex', 'docker'] as const).filter((k) => w.caps![k]).map((k) => (
                            <span key={k} className="chip gray">
                              {k}
                            </span>
                          ))
                        : <span className="muted">offline</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {w.labels.map((l) => (
                        <span key={l} className="chip">
                          {l}
                        </span>
                      ))}
                    </div>
                    <div className="muted">{w.online ? `${w.running}/${w.maxJobs}` : '—'}</div>
                    <div>
                      <button className="tool-btn" title="Odebrat workera (zneplatní jeho klíč)" onClick={() => void api<HubStatus>(`/hub/workers/${w.id}`, { method: 'DELETE' }).then(setHub)}>
                        <Icon.trash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Icon.plus /> Přidat worker
            </button>
          </div>

          <div>
            <h3 className="section-title">Pipeline projektu</h3>
            <div className="group-box">
              <textarea
                className="field"
                rows={3}
                value={goal}
                disabled={!!live}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Cíl pro orchestrátor, např. „Doplň správu místností pro admina, implementuj a otestuj“. Prázdné = dotáhnout aplikaci podle stories."
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  <input type="checkbox" checked={autoApply} disabled={!!live} onChange={(e) => setAutoApply(e.target.checked)} />
                  Automaticky přijímat návrhy modelu (kód vždy čeká na schválení)
                </label>
                {live ? (
                  <button className="btn" onClick={() => void api(`/projects/${s.project.id}/pipeline/cancel`, { body: {} })}>
                    <Icon.stop /> Zrušit
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    onClick={async () => {
                      await s.flush()
                      try {
                        s.setPipeline(await api<PipelineRun>(`/projects/${s.project.id}/pipeline`, { body: { goal, autoApply } }))
                      } catch (e) {
                        s.toast((e as Error).message, true)
                      }
                    }}
                  >
                    <Icon.play /> Spustit pipeline
                  </button>
                )}
              </div>
            </div>
            {run && (
              <div className="group-box">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {live && <span className="dot run" />}
                  <strong style={{ flex: 1 }}>{RUN_STATUS[run.status]}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {new Date(run.startedAt).toLocaleString('cs')}
                  </span>
                </div>
                {run.summary && <div className="muted" style={{ marginBottom: 8 }}>{run.summary}</div>}
                {run.tasks.map((t) => (
                  <div key={t.id} className="pipeline-task">
                    <span className="chip gray mono">{t.id}</span>
                    <span className="chip purple">{PHASE_LABEL[t.phase]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }} title={t.instruction}>
                        {t.title}
                      </div>
                      {(t.dependsOn.length > 0 || t.note) && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {t.dependsOn.length > 0 && `po ${t.dependsOn.join(', ')}`}
                          {t.dependsOn.length > 0 && t.note && ' · '}
                          {t.note}
                        </div>
                      )}
                    </div>
                    <span className={`chip ${TASK_STATUS[t.status].cls}`}>
                      {t.status === 'running' && <span className="dot run" />}
                      {TASK_STATUS[t.status].label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {adding && <AddWorkerDialog onClose={() => setAdding(false)} onAdded={() => void refresh()} />}
    </>
  )
}

const AddWorkerDialog = ({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) => {
  const [name, setName] = useState('')
  const [labels, setLabels] = useState('build')
  const [token, setToken] = useState('')
  const enroll = `npx aforge-worker enroll ${token} --name ${name || 'worker'}${labels ? ` --labels ${labels.replace(/\s+/g, '')}` : ''} --max-jobs 1`
  return (
    <Dialog onClose={onClose} width={620}>
      <h3>Přidat worker</h3>
      {!token ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Worker je démon na serveru s přihlášeným Claude Code a/nebo Codexem (subscription). Štítek <code>orchestrator</code> dostane plánování pipeline, <code>build</code> implementace,{' '}
            <code>review</code> kontroly.
          </p>
          <div className="form-row">
            <label>Jméno</label>
            <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="build-01" />
          </div>
          <div className="form-row">
            <label>Štítky</label>
            <input className="field" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="orchestrator,build,review" />
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>
              Zrušit
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                setToken((await api<{ token: string }>('/hub/workers', { body: { name } })).token)
                onAdded()
              }}
            >
              Vytvořit token
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Na serveru workera (Node 22+, git, přihlášený <code>claude</code> / <code>codex</code>) v klonu aForge spusťte. Token obsahuje klíč workera – zobrazí se jen teď.
          </p>
          <pre className="log" style={{ borderRadius: 8, userSelect: 'all' }}>
            {enroll}
            {'\n'}npx aforge-worker run
          </pre>
          <div className="dialog-actions">
            <button className="btn" onClick={() => void navigator.clipboard.writeText(`${enroll}\nnpx aforge-worker run`)}>
              Kopírovat
            </button>
            <button className="btn primary" onClick={onClose}>
              Hotovo
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
