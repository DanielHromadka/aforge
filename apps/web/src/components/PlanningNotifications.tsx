import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PlanningInbox, PlanningNotice } from '@aforge/shared'
import { api } from '../api'
import { navigate } from '../router'
import { Dialog } from './Dialog'
import { Glyph, TypeIcon } from './Glyphs'
import { ActionButton } from './ActionButton'
import { formatPlanningTime, planningChanged } from './Planning'

const Notifications = createContext<{ unread: number; open: () => void; loading: boolean }>(null!)
export const PlanningNotificationsProvider = ({ children, toast }: { children: ReactNode; toast: (text: string, error?: boolean) => void }) => {
  const [inbox, setInbox] = useState<PlanningInbox>()
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(true)
  const notified = useRef(new Set<string>())
  const requestId = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestId.current++ } }, [])
  const reload = useCallback(async () => {
    if (!mounted.current) return
    const request = ++requestId.current
    try {
      const data = await api<PlanningInbox>('/planning/notifications')
      if (!mounted.current || request !== requestId.current) return
      setInbox(data); setError('')
      const fresh = data.notices.filter((n) => !n.read && !notified.current.has(`${n.projectId}:${n.kind}:${n.itemId}:${n.entry.id}:${n.dueAt}`))
      for (const n of fresh) notified.current.add(`${n.projectId}:${n.kind}:${n.itemId}:${n.entry.id}:${n.dueAt}`)
      if (fresh.length) toast(fresh.length === 1 ? `Upozornění · ${fresh[0]!.itemTitle}: ${fresh[0]!.entry.text}` : `Máte ${fresh.length} nových upozornění. Najdete je pod zvonkem.`)
    } catch (e) { if (mounted.current && request === requestId.current) setError((e as Error).message) }
  }, [toast])
  useEffect(() => {
    let stopped = false
    let timer: number
    let running = false
    let again = false
    const refresh = async () => {
      if (stopped) return
      if (running) { again = true; return }
      running = true
      await reload()
      running = false
      if (stopped) return
      if (again) { again = false; void refresh() }
      else { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 30_000) }
    }
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    const changed = () => void refresh()
    void refresh()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', changed)
    window.addEventListener('aforge:planning-changed', changed)
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', changed); window.removeEventListener('aforge:planning-changed', changed) }
  }, [reload])
  // Wake at the scheduled instant as well as polling. Server time avoids a skewed browser clock.
  useEffect(() => {
    if (!inbox?.nextDueAt) return
    const untilDue = Date.parse(inbox.nextDueAt) - Date.parse(inbox.now)
    if (untilDue > 30_000) return
    const delay = Math.max(100, untilDue + 100)
    const timer = window.setTimeout(planningChanged, delay)
    return () => window.clearTimeout(timer)
  }, [inbox])
  const unread = inbox?.notices.filter((n) => !n.read).length ?? 0
  const read = async (n: PlanningNotice) => {
    try {
      await api(`/projects/${n.projectId}/planning/read`, { body: { kind: n.kind, itemId: n.itemId, entryId: n.entry.id, dueAt: n.dueAt } })
      await reload()
    } catch (e) { toast((e as Error).message, true); await reload() }
  }
  return <Notifications.Provider value={{ unread, loading: !inbox, open: () => { setOpen(true); void reload() } }}>
    {children}
    {open && <Dialog onClose={() => setOpen(false)} width={760} label="Upozornění"><div className="planning-inbox">
      <div className="row-gap"><h2 className="grow"><Glyph name="bell" /> Upozornění</h2><button className="btn" onClick={() => setOpen(false)}>Zavřít</button></div>
      <p className="small">Připomenutí a termíny ze všech vašich aktivních projektových sessions. Přečtení platí jen pro vás; vyřízení poznámky v detailu platí pro tým.</p>
      <label className="check-row"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />Pouze nepřečtená ({unread})</label>
      {error && <p role="alert">{error}<button className="link-btn" onClick={() => void reload()}>Zkusit znovu</button></p>}
      {!inbox && !error && <p role="status">Načítám upozornění…</p>}
      <div className="planning-inbox-list">{inbox?.notices.filter((n) => !onlyUnread || !n.read).map((n) => <article className={`planning-notice ${n.overdue ? 'overdue' : ''}`} key={`${n.projectId}:${n.kind}:${n.itemId}:${n.entry.id}`}>
        <div className="row-gap">{n.itemType === 'test' ? <Glyph name="test" /> : <TypeIcon type={n.itemType} />}<b>{n.itemId.startsWith('wt-') ? n.itemTitle : `${n.itemId} · ${n.itemTitle}`}</b>{n.overdue && <span className="planning-overdue">Po termínu</span>}</div>
        <p>{n.entry.text}</p><p className="small">{n.projectName} · {n.sessionName} · {formatPlanningTime(n.dueAt)}</p>
        <div className="row-gap"><button className="btn primary small" onClick={() => { setOpen(false); navigate(`/p/${encodeURIComponent(n.projectId)}/stories/${encodeURIComponent(n.itemId)}`) }}>Otevřít položku</button>{!n.read && <ActionButton className="btn small" busyLabel="Ukládám…" onClick={() => read(n)}>Označit jako přečtené</ActionButton>}</div>
      </article>)}</div>
      {!!inbox && !inbox.notices.some((n) => !onlyUnread || !n.read) && <p className="planning-inbox-empty">{onlyUnread ? 'Žádná nepřečtená upozornění.' : 'Žádná splatná upozornění.'}</p>}
    </div></Dialog>}
  </Notifications.Provider>
}

export const PlanningNotificationsButton = ({ beforeOpen }: { beforeOpen?: () => Promise<boolean> }) => {
  const n = useContext(Notifications)
  return <button className="tool-btn planning-notifications-button" aria-label={`Upozornění${n.unread ? ` (${n.unread} nepřečtených)` : ''}`} title="Upozornění a termíny" onClick={async () => { if (!beforeOpen || await beforeOpen()) n.open() }}><Glyph name="bell" />{n.unread > 0 && <span className="planning-unread-count">{n.unread > 99 ? '99+' : n.unread}</span>}</button>
}
