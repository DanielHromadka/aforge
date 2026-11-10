// Design: the design lives in Figma and comes in by sync. The canvas shows the rendered frame and lets
// you pick its layers, the Layers panel shows the layer tree, the Inspector annotates the picked layer
// (note, stories, work mark) and the Figma panel shows the file live. Nothing is drawn here.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { elementDepths, type DesignElement, type Project, type Screen } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { Spinner } from '../components/ActionButton'
import { useStudio } from '../studio'
import { Dialog } from '../components/Dialog'

// ---- shared bits ----------------------------------------------------------------------------

/** The layer under the pointer, shared by the canvas and the Layers panel. */
let hovered: string | undefined
const hoverSubs = new Set<() => void>()
const setHovered = (id?: string) => {
  if (id === hovered) return
  hovered = id
  hoverSubs.forEach((f) => f())
}
const useHovered = () =>
  useSyncExternalStore(
    (cb) => {
      hoverSubs.add(cb)
      return () => hoverSubs.delete(cb)
    },
    () => hovered,
  )

const useScreen = () => {
  const s = useStudio()
  const screen = s.project.screens.find((x) => x.id === s.focus.screenId) ?? s.project.screens[0]
  const selected = screen?.elements.find((e) => e.id === s.focus.elementId)
  const select = (id?: string) => screen && s.setFocus({ screenId: screen.id, elementId: id })
  return { s, screen, selected, select }
}

/** Link to a node in the Figma editor. */
const figmaLink = (fileUrl: string | undefined, figmaId?: string) => {
  const key = fileUrl?.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/)?.[1]
  if (!key) return undefined
  return `https://www.figma.com/design/${key}/${figmaId ? `?node-id=${figmaId.replace(/:/g, '-')}` : ''}`
}

const TYPE_GLYPH: Record<string, string> = {
  TEXT: 'T',
  FRAME: '#',
  INSTANCE: '◇',
  COMPONENT: '❖',
  COMPONENT_SET: '❖',
  GROUP: '▢',
  RECTANGLE: '▭',
  SECTION: '§',
}

const updateElement = (update: (fn: (p: Project) => Project) => void, screenId: string, id: string, patch: Partial<DesignElement>) =>
  update((p) => ({
    ...p,
    screens: p.screens.map((sc) =>
      sc.id === screenId
        ? {
            ...sc,
            elements: sc.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          }
        : sc,
    ),
  }))

// ---- sync ------------------------------------------------------------------------------------

const TOKEN_KEY = 'aforge.figmaToken'

const useFigmaSync = () => {
  const s = useStudio()
  const [busy, setBusy] = useState(false)
  const run = async (url?: string, token?: string) => {
    setBusy(true)
    try {
      await s.flush()
      if (token !== undefined) localStorage.setItem(TOKEN_KEY, token)
      const r = await api<{
        project: Project
        added: number
        removed: number
        updated: number
      }>(`/projects/${s.project.id}/figma`, {
        body: { url, token: token ?? localStorage.getItem(TOKEN_KEY) ?? '' },
      })
      await s.reload()
      const parts = [`${r.project.screens.length} obrazovek`, r.added && `nové ${r.added}`, r.removed && `odebrané ${r.removed}`].filter(Boolean)
      s.toast(`Synchronizováno z Figmy: ${parts.join(', ')}.`)
      if (!r.project.screens.some((x) => x.id === s.focus.screenId)) s.setFocus({ screenId: r.project.screens[0]?.id })
      return true
    } catch (e) {
      s.toast((e as Error).message, true)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

// ---- canvas (the stage) ----------------------------------------------------------------------

type Zoom = number | 'fit'

export const DesignStage = () => {
  const { s, screen, selected, select } = useScreen()
  const hover = useHovered()
  const sync = useFigmaSync()
  const [setup, setSetup] = useState(false)
  const [zoomPref, setZoomPref] = useState<Zoom>(() => {
    const v = localStorage.getItem('aforge.zoom')
    return v === 'fit' || !v ? 'fit' : Number(v) || 'fit'
  })
  const wrap = useRef<HTMLDivElement>(null)
  const [wrapWidth, setWrapWidth] = useState(1000)
  const depths = useMemo(() => (screen ? elementDepths(screen) : new Map<string, number>()), [screen])

  useEffect(() => localStorage.setItem('aforge.zoom', String(zoomPref)), [zoomPref])
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWrapWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen?.id])

  const zoom = zoomPref === 'fit' ? Math.min(2, Math.max(0.1, (wrapWidth - 80) / (screen?.width || 1))) : zoomPref

  // Escape walks up to the parent layer, then clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !selected || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      select(selected.parentId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** The deepest layer under the point; among equals the one painted last. */
  const hitTest = (e: React.PointerEvent) => {
    if (!screen) return undefined
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / zoom
    const y = (e.clientY - r.top) / zoom
    let best: DesignElement | undefined
    let bestDepth = -1
    for (const el of screen.elements) {
      if (x < el.x || y < el.y || x > el.x + el.w || y > el.y + el.h) continue
      const d = depths.get(el.id) ?? 0
      if (d >= bestDepth) {
        best = el
        bestDepth = d
      }
    }
    return best
  }

  const quickSync = () => (s.project.figma?.url ? void sync.run().then((ok) => !ok && setSetup(true)) : setSetup(true))

  const box = (el: DesignElement) => ({
    left: el.x * zoom,
    top: el.y * zoom,
    width: el.w * zoom,
    height: el.h * zoom,
  })
  const hoverEl = hover && hover !== selected?.id ? screen?.elements.find((e) => e.id === hover) : undefined
  const imageUrl = screen?.image && `/api/projects/${s.project.id}/figma/${screen.image}?v=${encodeURIComponent(s.project.figma?.syncedAt ?? '')}`

  return (
    <>
      <div className="pane-bar">
        <h2>Design</h2>
        {screen && (
          <span className="muted">
            {screen.name} · {screen.width}×{screen.height}
          </span>
        )}
        <span className="spacer" />
        {s.project.figma && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            Synchronizováno {new Date(s.project.figma.syncedAt).toLocaleString('cs-CZ')}
          </span>
        )}
        <select className="field" style={{ width: 110 }} value={String(zoomPref)} onChange={(e) => setZoomPref(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
          <option value="fit">Přizpůsobit</option>
          {[0.25, 0.5, 0.75, 1, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)} %
            </option>
          ))}
        </select>
        <button className={`tool-btn ${sync.busy ? 'is-busy' : ''}`} disabled={sync.busy} aria-busy={sync.busy} onClick={quickSync} title="Stáhnout aktuální design z Figmy">
          {sync.busy ? <Spinner /> : <Icon.refresh />} {sync.busy ? 'Synchronizuji…' : 'Synchronizovat'}
        </button>
        <button className="tool-btn" onClick={() => setSetup(true)} title="Odkaz na soubor a token">
          <Icon.figma /> Figma
        </button>
      </div>
      {screen ? (
        <div className="canvas-wrap" ref={wrap} onPointerDown={(e) => e.target === e.currentTarget && select()}>
          <div
            className="frame figma-frame"
            style={{ width: screen.width * zoom, height: screen.height * zoom }}
            onPointerMove={(e) => setHovered(hitTest(e)?.id)}
            onPointerLeave={() => setHovered()}
            onPointerDown={(e) => select(hitTest(e)?.id)}
          >
            <div className="frame-title">{screen.name}</div>
            <div className="frame-clip">
              {imageUrl ? (
                <img className="frame-image" src={imageUrl} alt={screen.name} draggable={false} />
              ) : (
                screen.elements.filter((el) => (depths.get(el.id) ?? 0) <= 1).map((el) => <div key={el.id} className="mark outline" style={box(el)} />)
              )}
              {screen.elements
                .filter((el) => el.work && el.id !== selected?.id)
                .map((el) => (
                  <div key={el.id} className="mark work" style={box(el)} title={`Rozpracováno: ${el.name}`} />
                ))}
              {hoverEl && (
                <div className="mark hover" style={box(hoverEl)}>
                  <span className="mark-label">{hoverEl.name}</span>
                </div>
              )}
              {selected && (
                <div className={`mark selected ${selected.work ? 'is-work' : ''}`} style={box(selected)}>
                  <span className="mark-label">
                    {selected.name} · {selected.w}×{selected.h}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">
          <div>
            Design zatím není synchronizovaný z Figmy.
            <p>Vložte odkaz na soubor ve Figmě – každý rámec (Frame) se stane obrazovkou.</p>
            <button className="btn primary" onClick={() => setSetup(true)}>
              <Icon.figma /> Připojit Figmu
            </button>
          </div>
        </div>
      )}
      {setup && <FigmaDialog busy={sync.busy} onSync={async (url, token) => (await sync.run(url, token)) && setSetup(false)} onClose={() => setSetup(false)} />}
    </>
  )
}

// ---- layers panel ----------------------------------------------------------------------------

export const LayersPanel = () => {
  const { s, screen, selected, select } = useScreen()
  const hover = useHovered()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)

  const children = useMemo(() => {
    const m = new Map<string | undefined, DesignElement[]>()
    for (const e of screen?.elements ?? []) m.set(e.parentId, [...(m.get(e.parentId) ?? []), e])
    return m
  }, [screen])

  // The picked layer is always visible in the tree: its ancestors open up and it scrolls into view.
  useEffect(() => {
    if (!selected || !screen) return
    const byId = new Map(screen.elements.map((e) => [e.id, e]))
    const up: string[] = []
    for (let p = selected.parentId; p; p = byId.get(p)?.parentId) up.push(p)
    if (up.some((id) => !open.has(id))) setOpen((o) => new Set([...o, ...up]))
    requestAnimationFrame(() => listRef.current?.querySelector('.layer-row.selected')?.scrollIntoView({ block: 'nearest' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, screen?.id])

  if (!screen) return <div className="empty">Žádná obrazovka z Figmy.</div>

  const row = (e: DesignElement, depth: number, flat = false) => {
    const kids = children.get(e.id)?.length ?? 0
    const isOpen = open.has(e.id)
    return (
      <div key={e.id}>
        <div
          className={`layer-row ${e.id === selected?.id ? 'selected' : ''} ${e.id === hover ? 'hovered' : ''}`}
          style={{ paddingLeft: 6 + (flat ? 0 : depth * 12) }}
          onPointerEnter={() => setHovered(e.id)}
          onPointerLeave={() => setHovered()}
          onClick={() => select(e.id)}
        >
          <span
            className={`layer-caret ${kids && !flat ? '' : 'none'}`}
            onClick={(ev) => {
              ev.stopPropagation()
              setOpen((o) => {
                const n = new Set(o)
                if (n.has(e.id)) n.delete(e.id)
                else n.add(e.id)
                return n
              })
            }}
          >
            {kids && !flat ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span className="layer-glyph">{TYPE_GLYPH[e.type] ?? '•'}</span>
          <span className="layer-name">{e.text && e.type === 'TEXT' ? e.text : e.name}</span>
          {e.note && <span className="layer-note" title={e.note} />}
          {e.storyIds.length > 0 && <span className="chip gray">{e.storyIds.length}</span>}
          {e.work && (
            <span className="chip work" title="Pracuje se na tom">
              ●
            </span>
          )}
        </div>
        {!flat && isOpen && children.get(e.id)?.map((c) => row(c, depth + 1))}
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const matches = q ? screen.elements.filter((e) => `${e.name} ${e.text ?? ''}`.toLowerCase().includes(q)).slice(0, 300) : null
  const work = screen.elements.filter((e) => e.work)

  return (
    <div className="layers">
      <div className="layers-head">
        <select className="field" value={screen.id} onChange={(e) => s.setFocus({ screenId: e.target.value })}>
          {s.project.screens.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.name}
            </option>
          ))}
        </select>
        <input className="field" placeholder="Hledat vrstvu" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="layers-list" ref={listRef}>
        {matches ? matches.length ? matches.map((e) => row(e, 0, true)) : <div className="muted layers-empty">Nic nenalezeno.</div> : children.get(undefined)?.map((e) => row(e, 0))}
      </div>
      {work.length > 0 && (
        <div className="layers-work">
          <div className="side-header">Rozpracované ({work.length})</div>
          {work.map((e) => row(e, 0, true))}
        </div>
      )}
    </div>
  )
}

// ---- inspector panel -------------------------------------------------------------------------

export const DesignInspector = () => {
  const { s, screen, selected, select } = useScreen()
  if (!screen) return <div className="empty">Žádná obrazovka z Figmy.</div>
  return (
    <div className="inspector">
      {selected ? <ElementInspector screen={screen} el={selected} onSelect={select} /> : <ScreenInspector screen={screen} onSelect={select} />}
      {!selected && s.project.figma && (
        <p className="muted" style={{ fontSize: 11.5 }}>
          Tip: klikněte na objekt v náhledu nebo ve Vrstvách. Esc vybere nadřazenou vrstvu.
        </p>
      )}
    </div>
  )
}

const ScreenInspector = ({ screen, onSelect }: { screen: Screen; onSelect: (id?: string) => void }) => {
  const s = useStudio()
  const linked = s.project.stories.filter((st) => st.screenIds.includes(screen.id))
  const work = screen.elements.filter((e) => e.work)
  const link = figmaLink(s.project.figma?.url, screen.figmaId)
  return (
    <>
      <h3>Obrazovka</h3>
      <div className="group-box">
        <div style={{ fontWeight: 600 }}>{screen.name}</div>
        <div className="muted">
          {screen.width}×{screen.height} · {screen.elements.length} vrstev
        </div>
        {link && (
          <a className="btn small" style={{ marginTop: 8 }} href={link} target="_blank" rel="noreferrer">
            <Icon.figma /> Otevřít ve Figmě
          </a>
        )}
      </div>
      <h3>Rozpracované prvky</h3>
      <div className="group-box">
        {work.length ? (
          work.map((e) => (
            <button key={e.id} className="side-link" onClick={() => onSelect(e.id)}>
              <span className="chip work">●</span>
              <span>{e.name}</span>
            </button>
          ))
        ) : (
          <span className="muted">Vyberte objekt a zvolte „Pracovat na tomto prvku“.</span>
        )}
      </div>
      <h3>Stories na této obrazovce</h3>
      <div className="group-box">
        {linked.length ? (
          linked.map((st) => (
            <div key={st.id}>
              {st.id} · {st.title}
            </div>
          ))
        ) : (
          <span className="muted">Žádná story ji zatím nepoužívá.</span>
        )}
      </div>
    </>
  )
}

const ElementInspector = ({ screen, el, onSelect }: { screen: Screen; el: DesignElement; onSelect: (id?: string) => void }) => {
  const s = useStudio()
  const patch = (p: Partial<DesignElement>) => updateElement(s.update, screen.id, el.id, p)
  const link = figmaLink(s.project.figma?.url, el.figmaId)
  const parent = el.parentId ? screen.elements.find((e) => e.id === el.parentId) : undefined
  return (
    <>
      <h3>Objekt</h3>
      <div className="group-box">
        <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{el.name}</div>
        <div className="muted">
          {[el.type, `${el.x},${el.y}`, `${el.w}×${el.h}`].filter(Boolean).join(' · ')}
        </div>
        {el.text && el.type === 'TEXT' && <div className="element-text">„{el.text}“</div>}
        <button className={`btn work-toggle ${el.work ? 'primary' : ''}`} onClick={() => patch({ work: !el.work })}>
          {el.work ? (
            <>
              <Icon.check /> Pracuje se na tom
            </>
          ) : (
            'Pracovat na tomto prvku'
          )}
        </button>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {parent && (
            <button className="btn small" onClick={() => onSelect(parent.id)} title={parent.name}>
              ↑ Nadřazený
            </button>
          )}
          {link && (
            <a className="btn small" href={link} target="_blank" rel="noreferrer">
              <Icon.figma /> Ve Figmě
            </a>
          )}
        </div>
      </div>
      <h3>Poznámka</h3>
      <div className="group-box">
        <textarea
          className="field"
          rows={4}
          style={{ width: '100%' }}
          placeholder="Chování, validace, data… (jde agentovi i do specifikace)"
          value={el.note}
          onChange={(e) => patch({ note: e.target.value })}
        />
      </div>
      <h3>Stories</h3>
      <div className="group-box">
        {s.project.stories.length === 0 && <span className="muted">Zatím žádné stories.</span>}
        {s.project.stories.map((st) => (
          <label
            key={st.id}
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              padding: '2px 0',
            }}
          >
            <input
              type="checkbox"
              checked={el.storyIds.includes(st.id)}
              onChange={(e) =>
                patch({
                  storyIds: e.target.checked ? [...el.storyIds, st.id] : el.storyIds.filter((x) => x !== st.id),
                })
              }
            />
            <span className="chip gray">{st.id}</span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {st.title}
            </span>
          </label>
        ))}
      </div>
      <button
        className="btn"
        onClick={() =>
          void s.askAgent({
            text: `Posuď objekt ${el.id} („${el.name}“) na obrazovce ${screen.name} – co má dělat, sedí na stories, co chybí?`,
          })
        }
      >
        <Icon.sparkles /> Zeptat se agenta
      </button>
    </>
  )
}

// ---- live Figma panel ------------------------------------------------------------------------

/** Figma's embed is view-only; editing happens in Figma itself. */
export const FigmaPanel = () => {
  const { s, screen, selected } = useScreen()
  const [follow, setFollow] = useState(false)
  const node = follow && selected ? selected.figmaId : screen?.figmaId
  const url = figmaLink(s.project.figma?.url, node || undefined)
  return (
    <div className="figma-panel">
      <div className="pane-bar">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Sledovat vybraný objekt
        </label>
        <span className="spacer" />
        {url && (
          <a className="tool-btn" href={url} target="_blank" rel="noreferrer" title="Otevřít v editoru Figmy">
            Upravit ve Figmě ↗
          </a>
        )}
      </div>
      {url ? (
        <iframe key={url} title="Figma" className="figma-embed" src={`https://www.figma.com/embed?embed_host=aforge&url=${encodeURIComponent(url)}`} allowFullScreen />
      ) : (
        <div className="empty">Nejdřív připojte soubor ve Figmě (Design → Figma).</div>
      )}
    </div>
  )
}

// ---- setup dialog ----------------------------------------------------------------------------

const FigmaDialog = ({ busy, onSync, onClose }: { busy: boolean; onSync: (url: string, token: string) => Promise<unknown>; onClose: () => void }) => {
  const s = useStudio()
  const [url, setUrl] = useState(s.project.figma?.url ?? '')
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  return (
    <Dialog onClose={onClose} width={540}>
      <h3>Figma</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Design se dělá ve Figmě. Synchronizace stáhne rámce (Frame) jako obrazovky i s jejich vrstvami a náhledem; poznámky, stories a rozpracované prvky v Reactoru zůstanou. Odkaz s{' '}
        <code>node-id</code> synchronizuje jen vybraný rámec nebo sekci.
      </p>
      <div className="form-row">
        <label>Odkaz</label>
        <input className="field" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.figma.com/design/…" />
      </div>
      <div className="form-row">
        <label>Osobní token</label>
        <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="figd_… (nebo FIGMA_TOKEN na serveru)" />
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>
        Token vytvoříte ve Figmě v Settings → Security → Personal access tokens (stačí File content: read). Uloží se jen v tomto prohlížeči.
      </p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Zrušit
        </button>
        <button className="btn primary" disabled={!url || busy} onClick={() => void onSync(url, token)}>
          {busy ? 'Synchronizuji…' : 'Synchronizovat'}
        </button>
      </div>
    </Dialog>
  )
}
