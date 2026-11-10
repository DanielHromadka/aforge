import { useCallback, useEffect, useState } from 'react'
import type { Project, ProjectHistory, SessionEntry } from '@aforge/shared'
import { api, type HubEvent } from '../api'
import { useStudio } from '../studio'

type History = Omit<ProjectHistory, 'sessions'> & { sessions: (SessionEntry & { activity?: string })[] }
export const SessionsView = ({ onOpen }: { onOpen: (id: string) => Promise<void> }) => {
  const s = useStudio()
  const root = s.project.session?.projectId ?? s.project.id
  const [history, setHistory] = useState<History>()
  const [form, setForm] = useState<'session' | 'snapshot'>('session')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<HubEvent[]>([])
  const refresh = useCallback(async () => {
    try {
      const [history, record] = await Promise.all([api<History>(`/projects/${root}/sessions`), api<{ events: HubEvent[] }>(`/projects/${s.project.id}/session-record`)])
      setHistory(history); setEvents(record.events); setError('')
    }
    catch (e) { setError((e as Error).message) }
  }, [root, s.project.id])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => clearInterval(timer) }, [refresh])
  const open = async (id: string) => { if (!busy && await s.flush()) await onOpen(id) }
  const create = async () => {
    setBusy(true); setError('')
    try {
      if (!(await s.flush())) return
      const project = await api<Project>(`/projects/${form === 'session' ? root : s.project.id}/${form === 'session' ? 'sessions' : 'snapshots'}`, { body: { name } })
      await onOpen(project.id)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const archive = async () => {
    setBusy(true); setError('')
    try {
      if (!(await s.flush())) return
      await api(`/projects/${s.project.id}/archive`, { body: {} })
      await onOpen(s.project.id)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    <div className="pane-bar"><h2>Sessions a historie</h2><span className="muted">{s.project.name}</span></div>
    <div className="pane-scroll sessions-view">
      <div className="session-create">
        <h3>Nová práce nebo uložený stav</h3>
        <p className="muted">Nová session začíná s prázdným flow a vlastním workspace. Ostatní sessions mohou dál pracovat. Snapshot zachová aktuální obsah pouze pro čtení.</p>
        <form onSubmit={(e) => { e.preventDefault(); void create() }}>
          <label>Co vytvořit<select className="field" value={form} disabled={busy} onChange={(e) => setForm(e.target.value as 'session' | 'snapshot')}><option value="session">Prázdná pracovní session</option><option value="snapshot" disabled={!!s.project.session?.snapshot}>Snapshot aktuální session</option></select></label>
          <label>Název<input className="field" maxLength={120} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder={form === 'session' ? 'Např. Správa rezervací' : 'Např. Před revizí zadání'} /></label>
          <button className="btn primary" disabled={busy}>{busy ? 'Ukládám…' : form === 'session' ? 'Vytvořit session' : 'Uložit snapshot'}</button>
        </form>
        {form === 'snapshot' && <p className="muted">Před uložením musí skončit agent, build, pipeline, testy a nahrávání průchodů. Běžící náhled může pokračovat.</p>}
        {!s.readOnly && <div className="session-archive"><span className="muted">Archivace uzamkne celou aktuální session a ukončí její běžící náhled.</span><button className="btn" disabled={busy} onClick={() => void archive()}>Archivovat session</button></div>}
      </div>
      {error && <p role="alert" className="session-error">{error}</p>}
      <h3>Historie projektu</h3>
      {!history && !error && <p role="status">Načítám historii…</p>}
      <div className="session-history">
        {history?.sessions.slice().reverse().map((entry) => {
          const snapshots = history.snapshots.filter((snap) => snap.sessionId === entry.id)
          return <section key={entry.id} className="session-history-group">
            <button className={`session-entry ${s.project.id === entry.id ? 'current' : ''}`} disabled={busy} onClick={() => void open(entry.id)}>
              <span><strong>{entry.name}</strong><small>Vytvořeno {new Date(entry.createdAt).toLocaleString('cs-CZ')}{entry.archivedAt ? ` · Archivováno ${new Date(entry.archivedAt).toLocaleString('cs-CZ')}` : ''}</small></span>
              <span className={`chip ${entry.archivedAt ? 'gray' : entry.activity ? 'green' : ''}`}>{entry.archivedAt ? 'Archiv · pouze čtení' : entry.activity ?? 'Pracovní session'}</span>
            </button>
            {snapshots.map((snap) => <button key={snap.id} className={`session-entry snapshot-entry ${s.project.id === snap.id ? 'current' : ''}`} disabled={busy} onClick={() => void open(snap.id)}><span><strong>{snap.name}</strong><small>{new Date(snap.createdAt).toLocaleString('cs-CZ')}</small></span><span className="chip gray">Snapshot · pouze čtení</span></button>)}
            {!snapshots.length && <p className="muted session-no-snapshots">Zatím bez snapshotu</p>}
          </section>
        })}
      </div>
      <details className="session-activity"><summary>Aktivita této session</summary>{!events.length && <p className="muted">Zatím bez zaznamenané aktivity. Záznamy se ukládají od této verze.</p>}{events.slice(-100).reverse().map((event, i) => <details key={i} className="session-event"><summary>{new Date(event.at).toLocaleString('cs-CZ')} · {event.text.slice(0, 100) || 'Aktualizace stavu'}</summary><pre className="archive-pre">{event.text}</pre></details>)}</details>
    </div>
  </>
}
