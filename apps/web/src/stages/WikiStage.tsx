// The wiki for people: a page about the application and one per epic. The Writer proposes changes after
// the tests pass; the user accepts or discards them, and older versions stay in the history.
import { useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { useStudio } from '../studio'
import { Glyph, StatusIcon, TypeIcon } from '../components/Glyphs'
import { Markdown } from '../components/Markdown'

export const WikiStage = () => {
  const s = useStudio()
  const p = s.project
  const pages = p.wiki ?? []
  const order = [...pages.filter((w) => w.id === 'about'), ...pages.filter((w) => w.id !== 'about')]
  const current = s.focus.wikiPage
  const setCurrent = (id: string) => s.setFocus({ ...s.focus, wikiPage: id })
  const page = pages.find((w) => w.id === current) ?? order[0]
  const [showDraft, setShowDraft] = useState(true)
  const epicOf = (id: string) => (p.epics ?? []).find((e) => e.id === id)
  const passed = p.testReport?.cases.filter((c) => c.status === 'passed').length ?? 0

  return (
    <>
      <div className="pane-bar">
        <h2>Wiki</h2>
        <span className="spacer" />
        {!s.readOnly && <ActionButton className="btn primary" disabled={s.generating !== null} busy={s.generating === 'wiki'} busyLabel="Dokumentarista píše…" icon={<Glyph name="wiki" />} onClick={() => s.generate('wiki')}>Aktualizovat wiki</ActionButton>}
      </div>
      {!order.length ? <div className="empty">Wiki napíše Dokumentarista po prvních zelených testech.</div> : <div className="wiki">
        <nav className="card-pane wiki-tree">
          {order.map((w) => (
            <button key={w.id} className={`side-link ${page?.id === w.id ? 'current' : ''}`} onClick={() => setCurrent(w.id)}>
              {w.id === 'about' ? <Glyph name="wiki" /> : <TypeIcon type="epic" />}
              <span>{w.draft?.title ?? w.title}</span>
              {w.draft && <StatusIcon shape="wait" size={14} />}
            </button>
          ))}
        </nav>
        <article className="card-pane wiki-page">
          {page ? <>
            <h1>{(showDraft && page.draft?.title) || page.title}</h1>
            <div className="wiki-meta muted small">
              {epicOf(page.id) && <span className="row-gap"><TypeIcon type="epic" size={12} />{page.id}</span>}
              {passed > 0 && <span className="row-gap"><StatusIcon shape="ok" size={12} />{passed} testů prošlo</span>}
              {page.body && <span>Aktualizováno {new Date(page.updatedAt).toLocaleString('cs-CZ')}</span>}
              {page.draft && page.body && <button className="link-btn" onClick={() => setShowDraft(!showDraft)}>{showDraft ? 'Zobrazit současnou verzi' : 'Zobrazit návrh'}</button>}
            </div>
            <Markdown text={(showDraft && page.draft?.body) || page.body || '_Stránka zatím nemá obsah._'} />
          </> : <div className="muted">Žádná stránka.</div>}
        </article>
        <aside className="card-pane wiki-side">
          {page?.draft ? <>
            <h3><StatusIcon shape="wait" /> Změny ke schválení</h3>
            <ul className="changes">{page.draft.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            {page.draft.sources.length > 0 && <div className="muted small">Zdroj: {page.draft.sources.join(', ')}</div>}
            {!s.readOnly && <div className="row-gap">
              <ActionButton className="btn primary" icon={<Glyph name="check" />} onClick={() => s.act(`/wiki/${page.id}/decide`, { accept: true })}>Přijmout</ActionButton>
              <ActionButton onClick={() => s.act(`/wiki/${page.id}/decide`, { accept: false })}>Zahodit</ActionButton>
            </div>}
          </> : <h3 className="muted">Bez čekajících změn</h3>}
          {page && page.history.length > 0 && <div className="muted small">{page.history.length} starších verzí</div>}
        </aside>
      </div>}
    </>
  )
}
