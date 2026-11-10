import { useState } from 'react'
import { deletionImpact, itemOf, itemTitle, LAYER_LABEL, reposOf, type ItemKind, type Issue, type Walkthrough } from '@aforge/shared'
import { useStudio } from '../studio'
import { Dialog } from './Dialog'
import { ActionButton } from './ActionButton'
import { Icon } from '../icons'
import { Glyph } from './Glyphs'

export const DeleteItemButton = ({ kind, id }: { kind: ItemKind; id: string }) => {
  const s = useStudio()
  const [open, setOpen] = useState(false)
  if (s.readOnly) return null
  return <><button className="btn danger" onClick={() => setOpen(true)}><Icon.trash /> Smazat</button>{open && <DeleteItemDialog key={`${kind}:${id}`} kind={kind} id={id} onClose={() => setOpen(false)} />}</>
}
const DeleteItemDialog = ({ kind, id, onClose }: { kind: ItemKind; id: string; onClose: () => void }) => {
  const s = useStudio()
  const item = itemOf(s.project, kind, id)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  if (!item) return null
  const name = itemTitle(item)
  const impact = deletionImpact(s.project, kind, id)
  const submit = async () => {
    if (!name || typed !== name || pending) return
    setPending(true)
    const ok = await s.act(`/items/${kind}/${id}/delete`, { title: typed })
    setPending(false)
    if (ok) {
      s.setFocus({ ...s.focus, ...(s.focus.storyId === id ? { storyId: undefined } : {}), ...(s.focus.issueId === id ? { issueId: undefined } : {}), ...(s.focus.testId === id ? { testId: undefined } : {}) })
      onClose()
    }
  }
  return <Dialog onClose={() => { if (!pending) onClose() }} width={480} label="Potvrdit smazání">
    <form className="create-form delete-item-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <h3>Smazat {kind === 'epic' ? 'epic' : kind === 'story' ? 'story' : kind === 'test' ? 'test' : 'task nebo bug'}?</h3>
      <p className="delete-item-name">{name}</p>
      {kind === 'epic' && <p>{impact.detachedStories.length} stories zůstane zachováno v sekci „Bez epicu“.</p>}
      {kind === 'epic' && s.project.wiki?.some((w) => w.id === id) && <p>Smaže se také stránka wiki tohoto epicu.</p>}
      {(kind === 'story' || kind === 'issue') && <p>Spolu s položkou se smaže {impact.issues.size - (kind === 'issue' ? 1 : 0)} navázaných tasků, bugů a podúkolů a {impact.tests.length} testů.</p>}
      {impact.tests.length > 0 && <p>Smažou se také jejich skripty a videa. Sdílené testy navázané na jiné stories zůstanou.</p>}
      <label className="review-field">Pro odblokování tlačítka opište přesný název:
        <input className="field" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={pending} aria-label="Název pro potvrzení smazání" />
      </label>
      {!name && <p>Nejprve položce vyplňte název.</p>}
      <div className="dialog-actions"><button type="button" className="btn" disabled={pending} onClick={onClose}>Zrušit</button><button type="submit" className="btn danger" disabled={!name || typed !== name || pending}>{pending ? 'Mažu…' : 'Potvrdit'}</button></div>
    </form>
  </Dialog>
}

export const EditItemButton = ({ kind, id }: { kind: 'issue' | 'test'; id: string }) => {
  const s = useStudio()
  const [open, setOpen] = useState(false)
  if (s.readOnly) return null
  return <><button className="btn" onClick={() => setOpen(true)}><Glyph name="pencil" /> Upravit</button>{open && <EditItemDialog key={id} kind={kind} id={id} onClose={() => setOpen(false)} />}</>
}
const EditItemDialog = ({ kind, id, onClose }: { kind: 'issue' | 'test'; id: string; onClose: () => void }) => {
  const s = useStudio()
  const item = itemOf(s.project, kind, id) as Issue | Walkthrough
  const [draft, setDraft] = useState(() => kind === 'issue'
    ? { title: itemTitle(item), description: (item as Issue).description, layer: (item as Issue).layer, repoId: (item as Issue).repoId, route: '', section: '', instructions: '' }
    : { title: itemTitle(item), route: (item as Walkthrough).route, section: (item as Walkthrough).section, instructions: (item as Walkthrough).instructions, description: '', layer: 'fe' as Issue['layer'], repoId: '' })
  const set = (patch: Partial<typeof draft>) => setDraft((old) => ({ ...old, ...patch }))
  return <Dialog onClose={onClose} width={560} label="Upravit položku"><form className="create-form" onSubmit={(e) => e.preventDefault()}>
    <h3>Upravit {kind === 'issue' ? id : 'test'}</h3>
    <label className="review-field">Název<input autoFocus className="field" value={draft.title} onChange={(e) => set({ title: e.target.value })} /></label>
    {kind === 'issue' ? <>
      <label className="review-field">Popis<textarea className="field" rows={7} value={draft.description} onChange={(e) => set({ description: e.target.value })} /></label>
      <label className="review-field">Vrstva<select className="field" value={draft.layer} onChange={(e) => set({ layer: e.target.value as Issue['layer'] })}>{Object.entries(LAYER_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label className="review-field">Repozitář<select className="field" value={draft.repoId} onChange={(e) => set({ repoId: e.target.value })}>{reposOf(s.project).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    </> : <>
      <label className="review-field">Stránka<input className="field" value={draft.route} onChange={(e) => set({ route: e.target.value })} /></label>
      <label className="review-field">Sekce<input className="field" value={draft.section} onChange={(e) => set({ section: e.target.value })} /></label>
      <label className="review-field">Pokyny<textarea className="field" rows={7} value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} /></label>
      <p className="small">Po změně scénáře se skript a video vytvoří znovu při dalším spuštění testu.</p>
    </>}
    <div className="dialog-actions"><button className="btn" type="button" onClick={onClose}>Zrušit</button><ActionButton className="btn primary" disabled={!draft.title.trim() || (kind === 'test' && (!draft.route.startsWith('/') || !draft.section.trim()))} busyLabel="Ukládám…" onClick={async () => { if (await s.act(`/items/${kind}/${id}/edit`, draft)) onClose() }}>Uložit změny</ActionButton></div>
  </form></Dialog>
}
