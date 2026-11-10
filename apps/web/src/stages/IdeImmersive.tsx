// The Ponor: the running app full screen, one prompt line and nothing else. A click into the app (through the
// preview's inspector) adds the element to the prompt; the agents are rings, the Scribe's records fade in a corner.
// Finished runs rebuild the preview so the result is judged by what it does; the code still waits for review.
import { useEffect, useRef, useState } from 'react'
import { ideSettingsOf, reposOf, roleOfIssue, ROLE_NAME } from '@aforge/shared'
import { api, previewHref } from '../api'
import { useStudio } from '../studio'
import { Glyph, ROLE_UI, TypeIcon } from '../components/Glyphs'
import { currentIssue, useDictation, useIde } from './IdeStage'

type Picked = { selector: string; text: string; route: string }

export const IdeImmersive = ({ onClose }: { onClose: () => void }) => {
  const s = useStudio()
  const p = s.project
  const ide = useIde()
  const frame = useRef<HTMLIFrameElement>(null)
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [route, setRoute] = useState('/')
  const [reload, setReload] = useState(0)
  const dictation = useDictation(ideSettingsOf(p).voice, (t) => setText((x) => (x ? `${x} ${t}` : t)))
  const opened = useRef(new Date().toISOString())
  const crumbs = (p.trace ?? []).filter((e) => e.at >= opened.current && e.kind !== 'prompt').slice(-4).reverse()
  const review = (p.issues ?? []).filter((i) => i.source === 'ide' && i.status === 'review')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picking) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, picking])
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { source?: string; type?: string } & Partial<Picked>
      if (d?.source !== 'aforge-inspector') return
      if (d.type === 'route' && d.route) setRoute(d.route)
      if (d.type === 'pick') { setPicked({ selector: d.selector ?? '', text: d.text ?? '', route: d.route ?? '/' }); setPicking(false) }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ target: 'aforge-inspector', type: 'mode', select: picking }, '*') }, [picking])

  // A run that just finished is shown at once: the preview rebuilds from the repositories.
  const reviewKey = review.map((i) => i.id).join()
  const seen = useRef(reviewKey)
  useEffect(() => {
    if (reviewKey && reviewKey !== seen.current && review.some((i) => !seen.current.split(',').includes(i.id))) ide.rebuild()
    seen.current = reviewKey
  }, [reviewKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // The frame reloads when the container is up again.
  useEffect(() => { if (s.preview.state === 'running') setReload((n) => n + 1) }, [s.preview.state])

  const send = async () => {
    const t = text.trim()
    if (!t || ide.busy) return
    setText('')
    if (await ide.run(t, picked ? { element: picked } : {})) setPicked(null)
    else setText(t)
  }

  return (
    <div className="immersive" role="dialog" aria-modal aria-label="Ponor">
      <div className="im-orbs">
        {reposOf(p).map((r) => {
          const issue = currentIssue(p, r.id)
          const role = issue ? roleOfIssue(p, issue) : r.platform === 'backend' || r.platform === 'library' ? 'be' : 'fe'
          const state = issue?.status === 'running' ? 'run' : issue?.status === 'review' || issue?.status === 'done' ? 'ok' : issue?.status === 'failed' ? 'err' : 'idle'
          return (
            <div key={r.id} className={`im-orb ${state}`} style={{ ['--tone' as string]: ROLE_UI[role].tone }} title={issue ? `${ROLE_NAME[role]} · ${issue.id} ${issue.title}` : `${ROLE_NAME[role]} · volný`}>
              <span className="ring"><span><Glyph name={state === 'ok' ? 'check' : ROLE_UI[role].glyph} size={12} /></span></span>
              <span className="ell">{r.name}{issue ? ` · ${issue.status === 'running' ? 'pracuje' : issue.status === 'review' ? 'hotovo, čeká' : issue.status === 'failed' ? 'selhalo' : issue.status === 'done' ? 'přijato' : 've frontě'}` : ''}</span>
            </div>
          )
        })}
      </div>
      <div className="im-crumbs" aria-live="polite">
        {crumbs.map((e) => <span key={e.id}>{e.kind === 'epic' || e.kind === 'task' || e.kind === 'story' || e.kind === 'criterion'
          ? <TypeIcon type={e.kind === 'criterion' ? 'story' : e.kind} size={13} />
          : <Glyph name={e.kind === 'wiki' ? 'wiki' : e.kind === 'contract' ? 'api' : e.kind === 'unsorted' ? 'search' : 'spark'} size={12} />}{e.kind === 'unsorted' ? `Nezařazeno: ${e.detail ?? ''}` : e.title}</span>)}
      </div>

      <div className="im-preview">
        <div className="im-bar">
          <button className="tool-btn" onClick={() => setReload((n) => n + 1)} title="Obnovit" disabled={!s.preview.url}>↻</button>
          <span className="mono ell">{s.preview.url ? `náhled · ${route}` : 'náhled neběží'}</span>
          <span className="spacer" />
          <button className={`tool-btn ${picking ? 'pressed' : ''}`} disabled={s.preview.state !== 'running'} onClick={() => setPicking(!picking)} title="Klikněte na prvek v aplikaci">Vybrat prvek</button>
        </div>
        {s.preview.url
          ? <iframe key={reload} ref={frame} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" title="Běžící aplikace" src={previewHref(p.id, s.preview.url)} />
          : <div className="empty"><div>Aplikace neběží.<p><button className="btn primary" disabled={s.readOnly || s.preview.state === 'starting'} onClick={() => void api(`/projects/${p.id}/preview/start`, { body: {} }).catch((e: Error) => s.toast(e.message, true))}>{s.preview.state === 'starting' ? 'Spouští se…' : 'Spustit náhled'}</button></p></div></div>}
      </div>

      {review.length > 0 && !s.readOnly && (
        <div className="im-review">
          {review.length} {review.length === 1 ? 'změna čeká' : review.length < 5 ? 'změny čekají' : 'změn čeká'} na revizi
          <button className="btn small primary" onClick={() => void ide.accept(review.map((i) => i.id))}>Přijmout vše</button>
          <button className="btn small" onClick={onClose}>Revize v IDE</button>
        </div>
      )}

      <div className="im-prompt">
        {ide.busy ? <div className="im-said">{ide.pending} <em>… plánuji</em></div>
          : <textarea autoFocus rows={2} value={text} disabled={s.readOnly} placeholder="Co změnit? Klikněte na prvek v aplikaci, nebo jen pište." onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />}
        <div className="row-gap">
          {picked && <span className="ide-pill"><Glyph name="preview" size={12} />prvek: {picked.text.slice(0, 40) || picked.selector}<button className="link-btn" aria-label="Odebrat prvek" onClick={() => setPicked(null)}>×</button></span>}
          <span className="spacer" />
          {dictation.available && <button className={`im-mic ${dictation.on ? 'on' : ''}`} onClick={dictation.toggle} title={dictation.on ? 'Zastavit diktování' : 'Diktovat'}><Glyph name="mic" size={15} /></button>}
          <button className="btn primary small" disabled={!text.trim() || ide.busy || s.readOnly} onClick={() => void send()}>Spustit</button>
        </div>
      </div>
      <div className="im-esc"><kbd>Esc</kbd> zpět do IDE · <kbd>⌘⇧T</kbd> Stopa</div>
    </div>
  )
}
