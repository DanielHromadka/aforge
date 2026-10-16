// Preview: the app running in its container, shown in a browser frame. In select mode a click inside
// the app picks the element (via the injected inspector) and the user attaches a note to it.
import { useEffect, useRef, useState } from 'react'
import type { Annotation } from '@aforge/shared'
import { api, uid } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'

interface Pick {
  selector: string
  text: string
  tag: string
  route: string
}

const STATE_LABEL = { idle: 'Neběží', starting: 'Spouští se', running: 'Běží', stopped: 'Zastaveno', error: 'Chyba' } as const

export const PreviewStage = () => {
  const s = useStudio()
  const { preview, project } = s
  const frame = useRef<HTMLIFrameElement>(null)
  const [selecting, setSelecting] = useState(false)
  const [route, setRoute] = useState('/')
  const [pick, setPick] = useState<Pick | null>(null)
  const [comment, setComment] = useState('')
  const [showLog, setShowLog] = useState(preview.state !== 'running')
  const [reloadKey, setReloadKey] = useState(0)

  const postToApp = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ target: 'aforge-inspector', ...msg }, '*')

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { source?: string; type?: string } & Partial<Pick>
      if (d?.source !== 'aforge-inspector') return
      if (d.type === 'route' && d.route) setRoute(d.route)
      if (d.type === 'pick') {
        setPick({ selector: d.selector ?? '', text: d.text ?? '', tag: d.tag ?? '', route: d.route ?? '/' })
        setComment('')
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => postToApp({ type: 'mode', select: selecting }), [selecting])

  useEffect(() => {
    if (preview.state === 'running') setShowLog(false)
    if (preview.state === 'error') setShowLog(true)
  }, [preview.state])

  const saveAnnotation = () => {
    if (!pick || !comment.trim()) return
    const a: Annotation = {
      id: uid('ann'),
      source: 'preview',
      target: pick.selector,
      text: pick.text,
      route: pick.route,
      comment: comment.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
    }
    s.update((p) => ({ ...p, annotations: [...p.annotations, a] }))
    setPick(null)
  }

  const start = async () => {
    setShowLog(true)
    await api(`/projects/${project.id}/preview/start`, { body: {} }).catch((e: Error) => s.toast(e.message, true))
  }

  const annotations = [...project.annotations].reverse()

  return (
    <>
      <div className="pane-bar">
        <h2>Náhled</h2>
        {preview.state === 'running' || preview.state === 'starting' ? (
          <button className="btn" onClick={() => void api(`/projects/${project.id}/preview/stop`, { body: {} })}>
            <Icon.stop /> Zastavit
          </button>
        ) : (
          <button className="btn primary" onClick={() => void start()}>
            <Icon.play /> Spustit v kontejneru
          </button>
        )}
        <button className="btn" disabled={preview.state === 'starting'} onClick={() => void start()} title="Znovu sestavit a spustit">
          <Icon.refresh /> Restart
        </button>
        <span className="chip gray">
          <span className={`dot ${preview.state === 'running' ? 'ok' : preview.state === 'starting' ? 'run' : preview.state === 'error' ? 'err' : ''}`} /> {STATE_LABEL[preview.state]}
        </span>
        {preview.message && preview.state !== 'running' && <span className="muted">{preview.message}</span>}
        <span className="spacer" />
        <button className={`tool-btn ${selecting ? 'pressed' : ''}`} disabled={preview.state !== 'running'} onClick={() => setSelecting(!selecting)} title="Klikněte na prvek v aplikaci a přidejte k němu poznámku">
          <Icon.cursor /> Anotovat
        </button>
        <button className={`tool-btn ${showLog ? 'pressed' : ''}`} onClick={() => setShowLog(!showLog)}>
          Log kontejneru
        </button>
      </div>
      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--canvas)' }}>
          <div className="browser" style={{ flex: showLog ? 2 : 1 }}>
            <div className="browser-bar">
              <button className="tool-btn" onClick={() => setReloadKey((k) => k + 1)} disabled={!preview.url}>
                <Icon.refresh />
              </button>
              <div className="browser-url">{preview.url ? `${preview.url}${route}` : 'aplikace neběží'}</div>
              {preview.url && (
                <a className="tool-btn" href={preview.url} target="_blank" rel="noreferrer" title="Otevřít v novém okně">
                  ↗
                </a>
              )}
            </div>
            {preview.url ? (
              <iframe key={reloadKey} ref={frame} src={preview.url} title="Náhled aplikace" onLoad={() => postToApp({ type: 'mode', select: selecting })} />
            ) : (
              <div className="empty">
                <div>
                  Aplikace zatím neběží.
                  <p>Spustí se izolovaně v Ubuntu kontejneru (backend, frontend a Nginx) podle .aforge/start.sh z buildu.</p>
                </div>
              </div>
            )}
          </div>
          {showLog && (
            <pre className="log" style={{ flex: 1, minHeight: 120, margin: '0 12px 12px', borderRadius: 10 }}>
              {s.previewLog || 'Log kontejneru je prázdný.'}
            </pre>
          )}
        </div>
        <div className="inspector">
          {pick && (
            <>
              <h3>Nová anotace</h3>
              <div className="group-box">
                <div className="mono muted" style={{ wordBreak: 'break-all', marginBottom: 4 }}>
                  {pick.route} · {pick.selector}
                </div>
                {pick.text && <div style={{ marginBottom: 6 }}>„{pick.text.slice(0, 120)}“</div>}
                <textarea
                  className="field"
                  rows={3}
                  autoFocus
                  value={comment}
                  placeholder="Co je potřeba změnit?"
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveAnnotation()
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="btn primary" disabled={!comment.trim()} onClick={saveAnnotation}>
                    Přidat ⌘↩
                  </button>
                  <button className="btn" onClick={() => setPick(null)}>
                    Zrušit
                  </button>
                </div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, flex: 1 }}>Anotace</h3>
            <button className="btn small" disabled={!project.annotations.some((a) => a.status === 'open') || s.agentBusy} onClick={() => void s.askAgent({ intent: 'annotations' })}>
              <Icon.sparkles /> Poslat agentovi
            </button>
          </div>
          {annotations.length === 0 && <div className="muted">Zapněte „Anotovat“ a klikněte na prvek v aplikaci.</div>}
          {annotations.map((a) => (
            <div key={a.id} className="group-box" style={{ opacity: a.status === 'resolved' ? 0.55 : 1, marginBottom: 8 }} onClick={() => postToApp({ type: 'highlight', selector: a.target, label: a.comment.slice(0, 40) })}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <Icon.pin />
                <span className="mono muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.route} {a.target}
                </span>
                <span className={`chip ${a.status === 'open' ? 'orange' : a.status === 'sent' ? '' : 'green'}`}>{a.status === 'open' ? 'Otevřená' : a.status === 'sent' ? 'Odesláno' : 'Vyřešeno'}</span>
              </div>
              <div>{a.comment}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {a.status !== 'resolved' && (
                  <button className="btn small" onClick={(e) => {
                      e.stopPropagation()
                      s.update((p) => ({ ...p, annotations: p.annotations.map((x) => (x.id === a.id ? { ...x, status: 'resolved' } : x)) }))
                    }}
                  >
                    Vyřešeno
                  </button>
                )}
                <button className="btn small danger" onClick={(e) => {
                    e.stopPropagation()
                    s.update((p) => ({ ...p, annotations: p.annotations.filter((x) => x.id !== a.id) }))
                  }}
                >
                  <Icon.trash />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
