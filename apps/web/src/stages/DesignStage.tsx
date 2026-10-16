// Wireframe editor: screens of absolutely positioned elements, drag to move, corner handle to resize,
// an inspector to name them and link them to stories. Figma frames come in through the REST import,
// and a Figma file can be shown embedded next to the canvas.
import { useEffect, useRef, useState } from 'react'
import { ELEMENT_KINDS, type Project, type Screen, type WireElement } from '@aforge/shared'
import { api, uid } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { Dialog } from '../components/Dialog'

const KIND_LABEL: Record<WireElement['kind'], string> = {
  container: 'Kontejner',
  text: 'Text',
  button: 'Tlačítko',
  input: 'Vstup',
  image: 'Obrázek',
  nav: 'Navigace',
  list: 'Seznam',
  table: 'Tabulka',
  card: 'Karta',
}

const DEFAULT_SIZE: Record<WireElement['kind'], [number, number]> = {
  container: [400, 240],
  text: [240, 28],
  button: [140, 40],
  input: [280, 38],
  image: [240, 160],
  nav: [1280, 56],
  list: [360, 220],
  table: [640, 260],
  card: [300, 180],
}

const SIZES = [
  { label: 'Desktop 1280×800', w: 1280, h: 800 },
  { label: 'Laptop 1440×900', w: 1440, h: 900 },
  { label: 'Tablet 834×1112', w: 834, h: 1112 },
  { label: 'Mobil 390×844', w: 390, h: 844 },
]

type Drag = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; orig: WireElement }

export const DesignStage = () => {
  const s = useStudio()
  const screen = s.project.screens.find((x) => x.id === s.focus.screenId) ?? s.project.screens[0]
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('aforge.zoom')) || 0.75)
  const [figmaOpen, setFigmaOpen] = useState(false)
  const [embedUrl, setEmbedUrl] = useState(() => localStorage.getItem(`aforge.figmaEmbed.${s.project.id}`) ?? '')
  const [showEmbed, setShowEmbed] = useState(false)
  const drag = useRef<Drag | null>(null)
  const selectedId = s.focus.elementId
  const selected = screen?.elements.find((e) => e.id === selectedId)

  useEffect(() => localStorage.setItem('aforge.zoom', String(zoom)), [zoom])

  const updateScreen = (fn: (sc: Screen) => Screen) =>
    s.update((p: Project) => ({ ...p, screens: p.screens.map((sc) => (sc.id === screen?.id ? fn(sc) : sc)) }))

  const updateEl = (id: string, patch: Partial<WireElement>) =>
    updateScreen((sc) => ({ ...sc, elements: sc.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))

  const addEl = (kind: WireElement['kind']) => {
    if (!screen) return
    const [w, h] = DEFAULT_SIZE[kind]
    const el: WireElement = {
      id: uid('el'),
      kind,
      x: kind === 'nav' ? 0 : 40 + (screen.elements.length % 8) * 24,
      y: kind === 'nav' ? 0 : 80 + (screen.elements.length % 8) * 24,
      w: kind === 'nav' ? screen.width : w,
      h,
      label: KIND_LABEL[kind],
      note: '',
      storyIds: [],
    }
    updateScreen((sc) => ({ ...sc, elements: [...sc.elements, el] }))
    s.setFocus({ screenId: screen.id, elementId: el.id })
  }

  const removeSelected = () => {
    if (!selected || !screen) return
    updateScreen((sc) => ({ ...sc, elements: sc.elements.filter((e) => e.id !== selected.id) }))
    s.setFocus({ screenId: screen.id })
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = (e.clientX - d.sx) / zoom
      const dy = (e.clientY - d.sy) / zoom
      const snap = (v: number) => (e.altKey ? Math.round(v) : Math.round(v / 8) * 8)
      if (d.mode === 'move') updateEl(d.id, { x: snap(d.orig.x + dx), y: snap(d.orig.y + dy) })
      else updateEl(d.id, { w: Math.max(16, snap(d.orig.w + dx)), h: Math.max(12, snap(d.orig.h + dy)) })
    }
    const up = () => (drag.current = null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (!selected || t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        removeSelected()
      }
      const step = e.shiftKey ? 8 : 1
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (nudge[e.key]) {
        e.preventDefault()
        updateEl(selected.id, { x: selected.x + nudge[e.key]![0], y: selected.y + nudge[e.key]![1] })
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        const copy = { ...selected, id: uid('el'), x: selected.x + 16, y: selected.y + 16 }
        updateScreen((sc) => ({ ...sc, elements: [...sc.elements, copy] }))
        s.setFocus({ screenId: screen!.id, elementId: copy.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!screen) {
    return (
      <div className="empty">
        <div>
          Projekt nemá žádnou obrazovku.
          <p>Přidejte ji v postranním panelu (+ u Obrazovky).</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="pane-bar">
        <h2>Design</h2>
        <div className="palette">
          {ELEMENT_KINDS.map((k) => (
            <button key={k} className="tool-btn" onClick={() => addEl(k)} title={`Přidat: ${KIND_LABEL[k]}`}>
              <Icon.plus /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <select className="field" style={{ width: 90 }} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {[0.25, 0.5, 0.75, 1, 1.25].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)} %
            </option>
          ))}
        </select>
        <button className="tool-btn" onClick={() => setFigmaOpen(true)}>
          <Icon.figma /> Import z Figmy
        </button>
        <button className={`tool-btn ${showEmbed ? 'pressed' : ''}`} onClick={() => setShowEmbed(!showEmbed)} title="Zobrazit soubor Figmy vedle plátna">
          Figma náhled
        </button>
      </div>
      <div className="split" style={{ gridTemplateColumns: showEmbed ? '1fr 1fr 280px' : '1fr 280px' }}>
        <div className="canvas-wrap" onPointerDown={(e) => e.target === e.currentTarget && s.setFocus({ screenId: screen.id })}>
          <div className="frame" style={{ width: screen.width * zoom, height: screen.height * zoom }} onPointerDown={(e) => e.target === e.currentTarget && s.setFocus({ screenId: screen.id })}>
            <div className="frame-title">
              {screen.name} · {screen.width}×{screen.height}
            </div>
            {screen.elements.map((el) => (
              <div
                key={el.id}
                className={`wire k-${el.kind} ${el.id === selectedId ? 'selected' : ''}`}
                style={{ left: el.x * zoom, top: el.y * zoom, width: el.w * zoom, height: el.h * zoom, fontSize: Math.max(8, 13 * zoom) }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  s.setFocus({ screenId: screen.id, elementId: el.id })
                  drag.current = { id: el.id, mode: 'move', sx: e.clientX, sy: e.clientY, orig: el }
                }}
                title={el.note || undefined}
              >
                <span className="wire-label">{el.kind === 'input' ? `${el.label}…` : el.label}</span>
                {el.note && <span className="has-note" />}
                {el.id === selectedId && (
                  <span
                    className="handle"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      drag.current = { id: el.id, mode: 'resize', sx: e.clientX, sy: e.clientY, orig: el }
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        {showEmbed && (
          <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--separator)' }}>
            <div className="pane-bar">
              <input
                className="field"
                placeholder="Odkaz na soubor nebo rámec ve Figmě"
                value={embedUrl}
                onChange={(e) => {
                  setEmbedUrl(e.target.value)
                  localStorage.setItem(`aforge.figmaEmbed.${s.project.id}`, e.target.value)
                }}
              />
            </div>
            {/figma\.com\//.test(embedUrl) ? (
              <iframe title="Figma" style={{ flex: 1, border: 0 }} src={`https://www.figma.com/embed?embed_host=aforge&url=${encodeURIComponent(embedUrl)}`} allowFullScreen />
            ) : (
              <div className="empty">Vložte odkaz na Figmu – soubor se zobrazí zde a můžete ho porovnávat s wireframem.</div>
            )}
          </div>
        )}
        <div className="inspector">
          {selected ? (
            <ElementInspector el={selected} onChange={(patch) => updateEl(selected.id, patch)} onDelete={removeSelected} />
          ) : (
            <ScreenInspector screen={screen} onChange={(patch) => updateScreen((sc) => ({ ...sc, ...patch }))} />
          )}
        </div>
      </div>
      {figmaOpen && <FigmaDialog onClose={() => setFigmaOpen(false)} />}
    </>
  )
}

const ScreenInspector = ({ screen, onChange }: { screen: Screen; onChange: (p: Partial<Screen>) => void }) => {
  const s = useStudio()
  const linked = s.project.stories.filter((st) => st.screenIds.includes(screen.id))
  return (
    <>
      <h3>Obrazovka</h3>
      <div className="group-box">
        <div className="form-row" style={{ gridTemplateColumns: '60px 1fr' }}>
          <label>Název</label>
          <input className="field" value={screen.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="form-row" style={{ gridTemplateColumns: '60px 1fr' }}>
          <label>Velikost</label>
          <select
            className="field"
            value={`${screen.width}x${screen.height}`}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number)
              onChange({ width: w, height: h })
            }}
          >
            {SIZES.map((z) => (
              <option key={z.label} value={`${z.w}x${z.h}`}>
                {z.label}
              </option>
            ))}
            {!SIZES.some((z) => z.w === screen.width && z.h === screen.height) && <option value={`${screen.width}x${screen.height}`}>{`${screen.width}×${screen.height}`}</option>}
          </select>
        </div>
      </div>
      <h3>Stories na této obrazovce</h3>
      <div className="group-box">
        {linked.length ? linked.map((st) => <div key={st.id}>{st.id} · {st.title}</div>) : <span className="muted">Žádná story ji zatím nepoužívá.</span>}
      </div>
      <button
        className="btn danger"
        disabled={s.project.screens.length < 2}
        onClick={() => {
          s.update((p) => ({ ...p, screens: p.screens.filter((x) => x.id !== screen.id) }))
          s.setFocus({})
        }}
      >
        <Icon.trash /> Smazat obrazovku
      </button>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 16 }}>
        Tip: prvky přidáte z lišty nahoře, posouváte tažením (Alt = bez přichytávání), šipky posunou o 1 px (⇧ o 8 px), ⌘D duplikuje, Backspace maže.
      </p>
    </>
  )
}

const ElementInspector = ({ el, onChange, onDelete }: { el: WireElement; onChange: (p: Partial<WireElement>) => void; onDelete: () => void }) => {
  const s = useStudio()
  const num = (k: 'x' | 'y' | 'w' | 'h') => (
    <input className="field" type="number" value={Math.round(el[k])} onChange={(e) => onChange({ [k]: Number(e.target.value) })} />
  )
  return (
    <>
      <h3>Prvek</h3>
      <div className="group-box">
        <div className="form-row" style={{ gridTemplateColumns: '60px 1fr' }}>
          <label>Druh</label>
          <select className="field" value={el.kind} onChange={(e) => onChange({ kind: e.target.value as WireElement['kind'] })}>
            {ELEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row" style={{ gridTemplateColumns: '60px 1fr' }}>
          <label>Popisek</label>
          <input className="field" value={el.label} onChange={(e) => onChange({ label: e.target.value })} />
        </div>
        <div className="form-row" style={{ gridTemplateColumns: '60px 1fr 1fr' }}>
          <label>X / Y</label>
          {num('x')}
          {num('y')}
        </div>
        <div className="form-row" style={{ gridTemplateColumns: '60px 1fr 1fr' }}>
          <label>Š / V</label>
          {num('w')}
          {num('h')}
        </div>
        <div className="form-row top" style={{ gridTemplateColumns: '60px 1fr' }}>
          <label>Poznámka</label>
          <textarea className="field" rows={3} placeholder="Chování, validace, data… (jde agentovi i do specifikace)" value={el.note} onChange={(e) => onChange({ note: e.target.value })} />
        </div>
      </div>
      <h3>Stories</h3>
      <div className="group-box">
        {s.project.stories.length === 0 && <span className="muted">Zatím žádné stories.</span>}
        {s.project.stories.map((st) => (
          <label key={st.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
            <input
              type="checkbox"
              checked={el.storyIds.includes(st.id)}
              onChange={(e) => onChange({ storyIds: e.target.checked ? [...el.storyIds, st.id] : el.storyIds.filter((x) => x !== st.id) })}
            />
            <span className="chip gray">{st.id}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.title}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn" onClick={() => void s.askAgent({ text: `Posuď prvek ${el.id} („${el.label}“) – sedí na stories? Co chybí?` })}>
          <Icon.sparkles /> Zeptat se agenta
        </button>
        <button className="btn danger" onClick={onDelete}>
          <Icon.trash />
        </button>
      </div>
    </>
  )
}

const FigmaDialog = ({ onClose }: { onClose: () => void }) => {
  const s = useStudio()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState(() => sessionStorage.getItem('aforge.figmaToken') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await s.flush()
      sessionStorage.setItem('aforge.figmaToken', token)
      const before = new Set(s.project.screens.map((x) => x.id))
      await api<Project>(`/projects/${s.project.id}/figma`, { body: { url, token } })
      await s.reload()
      const fresh = await api<Project>(`/projects/${s.project.id}`)
      const added = fresh.screens.filter((x) => !before.has(x.id))
      s.toast(`Importováno ${added.length} obrazovek z Figmy.`)
      if (added[0]) s.setFocus({ screenId: added[0].id })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog onClose={onClose} width={520}>
      <h3>Import z Figmy</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Každý rámec (Frame) se stane obrazovkou, jeho vrstvy prvky wireframu. Odkaz s <code>node-id</code> naimportuje jen vybraný rámec.
      </p>
      <div className="form-row">
        <label>Odkaz</label>
        <input className="field" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.figma.com/design/…" />
      </div>
      <div className="form-row">
        <label>Osobní token</label>
        <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="figd_…" />
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>
        Token vytvoříte ve Figmě v Settings → Security → Personal access tokens (stačí File content: read). Zůstává jen v této záložce prohlížeče.
      </p>
      {error && <div style={{ color: 'var(--red)' }}>{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Zrušit
        </button>
        <button className="btn primary" disabled={!url || !token || busy} onClick={() => void run()}>
          {busy ? 'Importuji…' : 'Importovat'}
        </button>
      </div>
    </Dialog>
  )
}
