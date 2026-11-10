// The hub's infrastructure, shared by the Agents and Settings pages: worker daemons, relay and run mode.
import { useCallback, useEffect, useState } from 'react'
import type { HubStatus } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { Dialog } from './Dialog'
import { isLive } from './AgentRuns'

/** Polls the hub; workers and runs change without events. */
export const useHub = () => {
  const [hub, setHub] = useState<HubStatus>()
  const [error, setError] = useState('')
  const refresh = useCallback(() => api<HubStatus>('/hub').then((h) => { setHub(h); setError('') }, (e: Error) => setError(e.message)), [])
  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(t)
  }, [refresh])
  return { hub, setHub, error, refresh }
}

export const WorkerList = ({ hub, admin, onChange }: { hub: HubStatus; admin: boolean; onChange: (h: HubStatus) => void }) => (
  <div className="plain-list">
    {!hub.workers.length && <div className="plain-empty">Žádný worker</div>}
    {hub.workers.map((w) => {
      const job = hub.runs.find((r) => r.workerId === w.id && isLive(r))
      return (
        <div key={w.id} className="plain-row" title={w.id}>
          <span className={`dot ${w.online ? 'ok' : ''}`} />
          <div className="plain-main">
            <strong>{w.name}</strong>
            <span className="muted">{w.online ? (job ? `${job.projectName} · ${job.step}` : 'Volný') : 'Offline'}</span>
          </div>
          <span className="muted">{[...(w.caps ? (['claude', 'codex', 'docker'] as const).filter((k) => w.caps![k]) : []), ...w.labels].join(', ')}</span>
          <span className="muted plain-num">{w.online ? `${w.running}/${w.maxJobs}` : ''}</span>
          {admin && <button className="tool-btn" title="Odebrat" onClick={() => void api<HubStatus>(`/hub/workers/${w.id}`, { method: 'DELETE' }).then(onChange)}><Icon.trash /></button>}
        </div>
      )
    })}
  </div>
)

export const AddWorkerDialog = ({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) => {
  const [name, setName] = useState('')
  const [labels, setLabels] = useState('build')
  const [token, setToken] = useState('')
  const enroll = `npx aforge-worker enroll ${token} --name ${name || 'worker'}${labels ? ` --labels ${labels.replace(/\s+/g, '')}` : ''} --max-jobs 1`
  return (
    <Dialog onClose={onClose} width={560}>
      <h3>Nový worker</h3>
      {!token ? (
        <>
          <div className="form-row"><label>Jméno</label><input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="build-01" /></div>
          <div className="form-row"><label>Štítky</label><input className="field" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="orchestrator, build, review" /></div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>Zrušit</button>
            <button className="btn primary" onClick={async () => { setToken((await api<{ token: string }>('/hub/workers', { body: { name } })).token); onAdded() }}>Vytvořit token</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Spusťte na serveru workera. Token se zobrazí jen teď.</p>
          <pre className="log" style={{ borderRadius: 8, userSelect: 'all' }}>{enroll}{'\n'}npx aforge-worker run</pre>
          <div className="dialog-actions">
            <button className="btn" onClick={() => void navigator.clipboard.writeText(`${enroll}\nnpx aforge-worker run`)}>Kopírovat</button>
            <button className="btn primary" onClick={onClose}>Hotovo</button>
          </div>
        </>
      )}
    </Dialog>
  )
}
