import { useState } from 'react'
import { planningKey, PLANNING_LEVEL, type ItemKind, type ItemPlanning, type PlanningEntryInput } from '@aforge/shared'
import { uid } from '../api'
import { useStudio } from '../studio'
import { ActionButton } from './ActionButton'
import { Glyph } from './Glyphs'

export const planningChanged = () => window.dispatchEvent(new Event('aforge:planning-changed'))
export const formatPlanningTime = (iso: string) => new Date(iso).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })
const localTime = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const isoTime = (local: string) => local ? new Date(local).toISOString() : undefined
const hours = (minutes: number) => (minutes / 60).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })

export const PlanningSummary = ({ kind, id }: { kind: ItemKind; id: string }) => {
  const p = useStudio().project.planning?.[planningKey(kind, id)]
  if (p?.estimateMinutes === undefined) return null
  return <span className="planning-estimate" title="Časový odhad pro tým">{hours(p.estimateMinutes)} h</span>
}

export const PlanningPanel = ({ kind, id, readOnly = false }: { kind: ItemKind; id: string; readOnly?: boolean }) => {
  const s = useStudio()
  const plan = s.project.planning?.[planningKey(kind, id)]
  const [editing, setEditing] = useState(false)
  const locked = readOnly || s.readOnly
  const active = plan?.entries.filter((e) => !e.resolvedAt) ?? []
  const done = plan?.entries.filter((e) => e.resolvedAt) ?? []
  const entry = (e: NonNullable<typeof plan>['entries'][number]) => <article key={e.id} className={`planning-entry planning-${e.level} ${e.resolvedAt ? 'resolved' : ''}`}>
    <div className="row-gap"><span className="chip">{PLANNING_LEVEL[e.level]}</span>{e.deadlineAt && !e.resolvedAt && Date.parse(e.deadlineAt) <= Date.now() && <span className="planning-overdue">Po termínu</span>}</div>
    <p>{e.text}</p>
    {(e.remindAt || e.deadlineAt) && <dl className="planning-dates">{e.remindAt && <><dt>Připomenout</dt><dd>{formatPlanningTime(e.remindAt)}</dd></>}{e.deadlineAt && <><dt>Deadline</dt><dd>{formatPlanningTime(e.deadlineAt)}</dd></>}</dl>}
    {!locked && <ActionButton className="btn small" busyLabel="Ukládám…" onClick={async () => {
      if (await s.act(`/items/${kind}/${id}/planning/resolve`, { entryId: e.id, expectedVersion: plan!.version, resolved: !e.resolvedAt })) planningChanged()
    }}>{e.resolvedAt ? 'Znovu otevřít' : 'Označit jako vyřízené'}</ActionButton>}
  </article>
  return <section className="card-pane planning-panel">
    <div className="row-gap"><h3 className="grow"><Glyph name="bell" /> Plánování pro tým</h3>{!locked && !editing && <button className="btn small" onClick={() => setEditing(true)}><Glyph name="pencil" />{plan ? 'Upravit plánování' : 'Přidat plánování'}</button>}</div>
    <p className="small planning-caption">Odhady, omezení a upozornění pro lidi v projektu. Nepředávají se agentům a neřídí implementaci.</p>
    {editing && !locked ? <PlanningEditor kind={kind} id={id} initial={plan} onClose={() => setEditing(false)} /> : <>
      <div className="planning-estimate-row"><span>Odhad práce</span><b>{plan?.estimateMinutes !== undefined ? `${hours(plan.estimateMinutes)} h` : 'Nezadán'}</b></div>
      {!active.length && <p className="muted small">Žádná otevřená omezení ani upozornění.</p>}
      {active.map(entry)}
      {!!done.length && <details className="planning-resolved"><summary>Vyřízené ({done.length})</summary>{done.map(entry)}</details>}
    </>}
  </section>
}

const PlanningEditor = ({ kind, id, initial, onClose }: { kind: ItemKind; id: string; initial?: ItemPlanning; onClose: () => void }) => {
  const s = useStudio()
  const [version] = useState(initial?.version ?? 0)
  const [estimate, setEstimate] = useState(initial?.estimateMinutes !== undefined ? String(initial.estimateMinutes / 60) : '')
  const [entries, setEntries] = useState<PlanningEntryInput[]>(() => (initial?.entries ?? []).map(({ id, text, level, remindAt, deadlineAt }) => ({ id, text, level, remindAt, deadlineAt })))
  const set = (id: string, patch: Partial<PlanningEntryInput>) => setEntries((old) => old.map((e) => e.id === id ? { ...e, ...patch } : e))
  const stale = (s.project.planning?.[planningKey(kind, id)]?.version ?? 0) !== version
  const estimateNumber = estimate === '' ? undefined : Number(estimate)
  const valid = !stale && (estimateNumber === undefined || (Number.isFinite(estimateNumber) && estimateNumber >= 0 && estimateNumber <= 1_000_000)) && entries.every((e) => e.text.trim())
  return <form className="planning-editor" onSubmit={(e) => e.preventDefault()}>
    <label className="review-field">Odhad práce v hodinách<input className="field" type="number" min="0" max="1000000" step="any" placeholder="Např. 2,5" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></label>
    <p className="small planning-caption">Vlastní odhad této položky, bez automatického přičítání odhadů podřízených položek.</p>
    {entries.map((e) => <fieldset key={e.id} className="planning-entry-editor"><legend>{PLANNING_LEVEL[e.level]}</legend>
      <label className="review-field">Typ<select className="field" value={e.level} onChange={(event) => set(e.id, { level: event.target.value as PlanningEntryInput['level'] })}>{Object.entries(PLANNING_LEVEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="review-field">Text<textarea className="field" rows={3} maxLength={4000} value={e.text} onChange={(event) => set(e.id, { text: event.target.value })} placeholder="Čemu se věnovat nebo na co si dát pozor…" /></label>
      <div className="planning-date-inputs"><label className="review-field">Čas upozornění<input className="field" type="datetime-local" value={localTime(e.remindAt)} onChange={(event) => set(e.id, { remindAt: isoTime(event.target.value) })} /></label><label className="review-field">Deadline<input className="field" type="datetime-local" value={localTime(e.deadlineAt)} onChange={(event) => set(e.id, { deadlineAt: isoTime(event.target.value) })} /></label></div>
      <button type="button" className="link-btn small" onClick={() => setEntries((old) => old.filter((x) => x.id !== e.id))}>Odebrat poznámku</button>
    </fieldset>)}
    <button type="button" className="btn small" disabled={entries.length >= 100} onClick={() => setEntries((old) => [...old, { id: uid('plan'), text: '', level: 'warning' }])}><Glyph name="plus" /> Přidat poznámku nebo upozornění</button>
    <p className="small planning-caption">Časy jsou v pásmu {Intl.DateTimeFormat().resolvedOptions().timeZone}. Upozornění najdete pod zvonkem v aplikaci i po pozdějším přihlášení. Bez času a deadlinu zůstane poznámka pouze u položky.</p>
    {stale && <p role="alert">Plánování mezitím někdo změnil. Vaše rozepsané údaje zůstávají ve formuláři; pro načtení aktuálních hodnot editor zavřete a znovu otevřete.</p>}
    <div className="row-gap planning-form-actions"><button type="button" className="btn" onClick={onClose}>Zrušit</button><ActionButton className="btn primary" disabled={!valid} busyLabel="Ukládám…" onClick={async () => {
      if (await s.act(`/items/${kind}/${id}/planning`, { expectedVersion: version, estimateMinutes: estimateNumber === undefined ? undefined : estimateNumber * 60, entries })) { planningChanged(); onClose() }
    }}>Uložit plánování</ActionButton></div>
  </form>
}
