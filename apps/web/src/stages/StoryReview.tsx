import { useState } from 'react'
import { reviewFingerprint, storyReviewBlock, validateReviewGroup, type ReviewGroup, type ReviewGroupInput, type ReviewStory, type Story, type StoryArchive } from '@aforge/shared'
import { useStudio } from '../studio'
import { ActionButton } from '../components/ActionButton'
import { Glyph } from '../components/Glyphs'
import { PlanningPanel } from '../components/Planning'
import { Markdown } from '../components/Markdown'

const KIND = { merge: 'Sloučit', split: 'Rozdělit', reshape: 'Přeskupit', move: 'Přesunout', clarify: 'Upřesnit', keep: 'Ponechat' }

export const StoryReviewPanel = ({ onClose }: { onClose: () => void }) => {
  const s = useStudio()
  const p = s.project
  const [scope, setScope] = useState('all')
  const [picked, setPicked] = useState(() => new Set(p.stories.filter((st) => !storyReviewBlock(p, st)).map((st) => st.id)))
  const [reviewId, setReviewId] = useState('')
  const reviews = [...(p.storyReviews ?? [])].reverse()
  const review = reviews.find((r) => r.id === reviewId) ?? reviews[0]
  const candidates = p.stories.filter((st) => scope === 'all' || (scope === 'none' ? !st.epicId : st.epicId === scope))
  const selected = candidates.filter((st) => picked.has(st.id) && !storyReviewBlock(p, st))
  return <>
    <div className="pane-bar">
      <button className="btn" onClick={onClose}><Glyph name="back" /> Stories</button>
      <h2>Revize backlogu</h2>
    </div>
    <div className="review-layout pane-scroll">
      {!s.readOnly && <section className="card-pane review-setup">
        <h3>Stories před implementací</h3>
        <p>Analytik navrhne sloučení, rozdělení nebo upřesnění podle uživatelského cíle. Každou změnu nejprve zkontrolujete a schválíte.</p>
        <label className="review-field">Rozsah<select className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Celý projekt</option><option value="none">Bez epicu</option>
          {(p.epics ?? []).map((e) => <option key={e.id} value={e.id}>{e.id} {e.title}</option>)}
        </select></label>
        <div className="row-gap"><button className="link-btn small" onClick={() => setPicked(new Set(candidates.filter((st) => !storyReviewBlock(p, st)).map((st) => st.id)))}>Vybrat způsobilé</button><button className="link-btn small" onClick={() => setPicked(new Set())}>Zrušit výběr</button></div>
        <div className="review-picks">
          {candidates.map((st) => {
            const block = storyReviewBlock(p, st)
            return <label key={st.id} className="review-pick">
              <input type="checkbox" disabled={!!block || s.generating !== null} checked={!block && picked.has(st.id)} onChange={(e) => setPicked((old) => { const next = new Set(old); if (e.target.checked) next.add(st.id); else next.delete(st.id); return next })} />
              <span><b className="key">{st.id}</b> {st.title}{block && <small>{block} Slouží jen jako kontext.</small>}</span>
            </label>
          })}
          {!candidates.length && <p className="muted">V tomto rozsahu nejsou žádné stories.</p>}
        </div>
        <ActionButton className="btn primary" disabled={!selected.length || s.generating !== null} busy={s.generating === 'reorganize'} busyLabel="Analytik porovnává obsah…" icon={<Glyph name="spark" />} onClick={async () => { setReviewId(''); await s.generate('reorganize', selected.map((st) => st.id)) }}>Analyzovat vybrané ({selected.length})</ActionButton>
        {!selected.length && <p className="small">Vyberte story, na jejíchž taskech ještě nezačala práce. Hotové a rozpracované stories zůstávají kontextem.</p>}
      </section>}
      <section className="review-results">
        <div className="row-gap review-results-head"><h3>Návrh reorganizace</h3>{reviews.length > 0 && <select className="field" aria-label="Historie analýz" value={review?.id} onChange={(e) => setReviewId(e.target.value)}>{reviews.map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString('cs-CZ')} · {r.groups.filter((g) => g.status === 'pending').length} k revizi</option>)}</select>}</div>
        {review ? <>
          <p>{review.summary}</p>
          <p className="small">Změna uchová původní stories i rozpad v historii. Výsledné stories dostanou nové klíče a rozpadnou se znovu.</p>
          {review.groups.map((g) => <ReviewGroupEditor key={g.id} group={g} reviewId={review.id} />)}
        </> : <div className="card-pane"><h3>Nejprve spusťte analýzu</h3><p>Tady se zobrazí původní a výsledná zadání, důvody změn a přiřazení akceptačních kritérií. Samotná analýza backlog nemění.</p></div>}
        {!!p.storyArchive?.length && <details className="card-pane"><summary>Nahrazené stories ({p.storyArchive.length})</summary>{p.storyArchive.map((a) => <p key={`${a.groupId}:${a.story.id}`}><button className="link-btn" onClick={() => s.setFocus({ ...s.focus, storyId: a.story.id })}>{a.story.id} {a.story.title}</button> → {a.replacedBy.join(', ')}</p>)}</details>}
      </section>
    </div>
  </>
}

const ReviewGroupEditor = ({ group: g, reviewId }: { group: ReviewGroup; reviewId: string }) => {
  const s = useStudio()
  const [draft, setDraft] = useState<ReviewGroupInput>(g)
  const [editing, setEditing] = useState(false)
  const stale = g.status === 'pending' && reviewFingerprint(s.project, g.sourceIds) !== g.fingerprint
  let error = ''
  if (g.status === 'pending' && !stale) { try { validateReviewGroup(s.project, draft) } catch (e) { error = (e as Error).message } }
  const setStory = (index: number, patch: Partial<ReviewStory>) => setDraft((old) => ({ ...old, stories: old.stories.map((st, n) => n === index ? { ...st, ...patch } : st) }))
  const issues = (s.project.issues ?? []).filter((i) => i.storyId && g.sourceIds.includes(i.storyId))
  const tests = (s.project.walkthroughs ?? []).filter((w) => w.storyIds.some((id) => g.sourceIds.includes(id)))
  return <article className="card-pane review-group">
    <div className="row-gap"><span className="chip">{KIND[g.kind]}</span><h3 className="grow">{g.title}</h3><span className="small">{g.status === 'accepted' ? 'Přijato' : g.status === 'rejected' ? 'Odmítnuto' : 'Ke schválení'}</span></div>
    <p>{g.rationale}</p>
    <div className="review-compare">
      <div><h4>Před změnou</h4>{g.before.map((st) => <StoryText key={st.id} story={st} />)}</div>
      <div><h4>Po změně{g.resultIds?.length ? ` · ${g.resultIds.join(', ')}` : ''}</h4>{draft.stories.map((st, index) => editing ? <fieldset key={index} className="review-story-edit"><legend>Výsledná story {index + 1}</legend>
        {(['title', 'asA', 'iWant', 'soThat'] as const).map((key) => <label className="review-field" key={key}>{{ title: 'Název', asA: 'Jako', iWant: 'Chci', soThat: 'Abych' }[key]}<input className="field" value={st[key]} onChange={(e) => setStory(index, { [key]: e.target.value })} /></label>)}
        <label className="review-field">Podrobný popis (Markdown)<textarea className="field" rows={5} value={st.description ?? ''} onChange={(e) => setStory(index, { description: e.target.value })} /></label>
        <label className="review-field">Epic<select className="field" value={st.epicId} onChange={(e) => setStory(index, { epicId: e.target.value })}><option value="">Bez epicu</option>{s.project.epics?.map((e) => <option key={e.id} value={e.id}>{e.id} {e.title}</option>)}</select></label>
        <label className="review-field">Kritéria (jedno na řádek)<textarea className="field" rows={Math.max(3, st.acceptance.length)} value={st.acceptance.join('\n')} onChange={(e) => setStory(index, { acceptance: e.target.value.split('\n') })} /></label>
      </fieldset> : <StoryText key={index} story={{ ...st, id: g.resultIds?.[index] ?? `Výsledek ${index + 1}` }} />)}</div>
    </div>
    <details><summary>Přiřazení kritérií ({g.coverage.length})</summary><div className="review-coverage">
      {draft.coverage.map((m, n) => <div key={n}>
        <b>{m.sourceId} · {m.criterion + 1}.</b> {g.before.find((st) => st.id === m.sourceId)?.acceptance[m.criterion]}
        {editing ? <label className="review-field">Přiřadit ke kritériu<select className="field" value={`${m.target}:${m.targetCriterion}`} onChange={(e) => { const [target, targetCriterion] = e.target.value.split(':').map(Number); setDraft((old) => ({ ...old, coverage: old.coverage.map((c, i) => i === n ? { ...c, target: target!, targetCriterion: targetCriterion! } : c) })) }}>
          {draft.stories.flatMap((st, target) => st.acceptance.map((criterion, targetCriterion) => <option key={`${target}:${targetCriterion}`} value={`${target}:${targetCriterion}`}>Story {target + 1} · {targetCriterion + 1}. {criterion}</option>))}
        </select></label> : <p>→ Story {m.target + 1} · kritérium {m.targetCriterion + 1}: {draft.stories[m.target]?.acceptance[m.targetCriterion]}</p>}
        {m.note && <small>{m.note}</small>}
      </div>)}
    </div></details>
    {issues.length > 0 && g.kind !== 'keep' && <p className="small">Rozpad k nové revizi: {issues.map((i) => i.id).join(', ')}. Původní tasky zůstanou v historii.</p>}
    {tests.length > 0 && g.kind !== 'keep' && <p className="small">Koncepty testů ({tests.length}) se uchovají u původních stories v historii. Pro výsledné stories připravte testy znovu.</p>}
    {g.kind !== 'keep' && g.sourceIds.some((id) => s.project.planning?.[`story:${id}`] || issues.some((i) => s.project.planning?.[`issue:${i.id}`])) && <p className="small">Poznámky, upozornění a termíny se přenesou na výsledné stories. Při sloučení se sečtou vlastní odhady stories; při rozdělení nastavte odhady výsledků znovu.</p>}
    {stale && <p role="alert">Zadání, design nebo rozpad se změnily. Spusťte novou analýzu.</p>}
    {error && <p role="alert">{error}</p>}
    {g.status === 'pending' && !s.readOnly && <div className="row-gap review-actions">
      <ActionButton className="btn primary" disabled={stale || !!error} onClick={() => s.act(`/story-reviews/${reviewId}/${g.id}/decide`, { accept: true, edited: draft })}>{g.kind === 'keep' ? 'Ponechat story' : 'Použít změnu'}</ActionButton>
      {g.kind !== 'keep' && <button className="btn" disabled={stale} onClick={() => setEditing(!editing)}>{editing ? 'Zobrazit výsledek' : 'Upravit návrh'}</button>}
      <ActionButton onClick={() => s.act(`/story-reviews/${reviewId}/${g.id}/decide`, { accept: false })}>Odmítnout návrh</ActionButton>
    </div>}
  </article>
}

const StoryText = ({ story: st }: { story: Pick<Story, 'id' | 'title' | 'asA' | 'iWant' | 'soThat' | 'acceptance'> & Partial<Pick<Story, 'epicId' | 'screenIds' | 'priority' | 'description'>> }) => {
  const s = useStudio()
  return <div className="review-story"><b>{st.id} · {st.title}</b><p className="small">{st.epicId ? `${st.epicId} · ${s.project.epics?.find((e) => e.id === st.epicId)?.title ?? 'Epic'}` : 'Bez epicu'}{st.priority ? ` · ${st.priority}` : ''}</p><p>Jako {st.asA} chci {st.iWant}, abych {st.soThat}.</p>{st.description && <Markdown text={st.description} />}{st.acceptance.length > 0 && <ol>{st.acceptance.map((a, n) => <li key={n}>{a}</li>)}</ol>}{!!st.screenIds?.length && <p className="small">Design: {st.screenIds.map((id) => s.project.screens.find((sc) => sc.id === id)?.name ?? id).join(', ')}</p>}</div>
}

export const ArchivedStoryDetail = ({ archive: a }: { archive: StoryArchive }) => {
  const s = useStudio()
  return <><div className="pane-bar"><button className="btn" onClick={() => s.setFocus({ ...s.focus, storyId: undefined })}><Glyph name="back" /> Stories</button><h2>{a.story.id} · Nahrazená story</h2></div><div className="pane-scroll review-archive"><section className="card-pane"><StoryText story={a.story} /><h3>Nahrazena stories</h3>{a.replacedBy.map((id) => <p key={id}><button className="link-btn" onClick={() => s.setFocus({ ...s.focus, storyId: id })}>{id} {s.project.stories.find((st) => st.id === id)?.title}</button></p>)}<h3>Původní rozpad</h3>{a.issues.map((i) => <p key={i.id}>{i.id} · {i.title} · {i.description}</p>)}{!a.issues.length && <p>Bez tasků.</p>}{!!a.tests?.length && <><h3>Původní koncepty testů</h3>{a.tests.map((w) => <p key={w.id}><b>{w.title ?? w.section}</b> · {w.route}<br />{w.instructions}</p>)}</>}</section><PlanningPanel kind="story" id={a.story.id} readOnly /></div></>
}
