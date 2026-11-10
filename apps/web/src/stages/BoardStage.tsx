// Stories as a board: a row per epic, a column per step. A card shows its type and key, the screen from
// Figma and the trail of its tasks (colour = layer, shape = state). Opening a card shows the story detail.
import { useState } from 'react'
import { api, previewHref } from '../api'
import { Dialog } from '../components/Dialog'
import { LAYER_LABEL, LAYERS, nextKeys, reposOf, STORY_STAGES, type Epic, type Issue, type Project, type Story } from '@aforge/shared'
import { ActionButton } from '../components/ActionButton'
import { useStudio } from '../studio'
import { useHub } from '../components/Workers'
import { isLive } from '../components/AgentRuns'
import { AnchoredThread } from '../components/AgentPanel'
import { Glyph, LAYER_UI, ROLE_UI, shapeOf, StatusIcon, Tile, TypeIcon, type Shape } from '../components/Glyphs'
import { IssueFilterBar, IssueGroup, IssueRow, issuesOf, matchesFilter, NO_FILTER, openBugs, projectRuns, stageOf, STORY_STAGE_UI, useCollapsed, type IssueFilter } from '../components/Work'
import { StoryTree } from '../components/StoryTree'
import { DeleteItemButton } from '../components/ItemActions'
import { ArchivedStoryDetail, StoryReviewPanel } from './StoryReview'
import { IssueDetail } from './ImplementStage'
import { TestDetail } from './TestsStage'
import { PlanningPanel, PlanningSummary } from '../components/Planning'
import { DescriptionEditor } from '../components/DescriptionEditor'

const screenUrl = (p: Project, image: string) => `/api/projects/${p.id}/figma/${image}?v=${encodeURIComponent(p.figma?.syncedAt ?? '')}`

export const BoardStage = () => {
  const s = useStudio()
  const [review, setReview] = useState(false)
  const story = s.project.stories.find((x) => x.id === s.focus.storyId)
  const epic = s.project.epics?.find((x) => x.id === s.focus.storyId)
  const issue = s.project.issues?.find((x) => x.id === s.focus.storyId)
  const test = s.project.walkthroughs?.find((x) => x.id === s.focus.storyId)
  const archive = s.project.storyArchive?.find((x) => x.story.id === s.focus.storyId)
  const back = () => s.setFocus({ ...s.focus, storyId: undefined })
  const detailBar = <div className="pane-bar"><button className="btn" onClick={back}><Glyph name="back" /> Stories</button><h2>{issue ? `${issue.id} · ${issue.title}` : test?.title ?? test?.section}</h2></div>
  return <div className="stories-workspace"><StoryTree onNavigate={() => setReview(false)} /><div className="stories-main">
    {story ? <StoryDetail key={story.id} story={story} /> : epic ? <EpicDetail key={epic.id} epic={epic} /> : issue ? <>{detailBar}<div className="pane-scroll"><IssueDetail key={issue.id} issue={issue} /></div></> : test ? <>{detailBar}<div className="pane-scroll"><TestDetail key={test.id} w={test} log={[]} /></div></> : archive ? <ArchivedStoryDetail archive={archive} /> : review ? <StoryReviewPanel onClose={() => setReview(false)} /> : <Board onReview={() => setReview(true)} />}
  </div></div>
}

const Board = ({ onReview }: { onReview: () => void }) => {
  const s = useStudio()
  const p = s.project
  const { hub } = useHub()
  const runs = hub ? projectRuns(hub.runs, p).filter(isLive) : []
  const epics: (Epic | null)[] = [...(p.epics ?? []), ...(p.stories.some((x) => !x.epicId || !(p.epics ?? []).some((e) => e.id === x.epicId)) || !p.stories.length ? [null] : [])]
  const open = (id?: string) => s.setFocus({ ...s.focus, storyId: id })

  const [creating, setCreating] = useState<{ kind: 'story' | 'epic'; epicId?: string } | null>(null)
  const [jira, setJira] = useState(false)
  // Dragging a card onto another epic's row moves the story there; the row without an epic removes it.
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const moveTo = (storyId: string, epicId?: string) =>
    s.update((x) => ({ ...x, stories: x.stories.map((st) => (st.id === storyId ? { ...st, epicId } : st)) }))

  return (
    <>
      <div className="pane-bar">
        <h2>Stories</h2>
        <span className="spacer" />
        <button className="btn" onClick={onReview}><Glyph name="split" /> Analyzovat a reorganizovat{p.storyReviews?.some((r) => r.groups.some((g) => g.status === 'pending')) ? ' · k revizi' : ''}</button>
        {!s.readOnly && <>
          <button className="btn" onClick={() => setJira(true)} title={p.jira ? `Naposledy ${new Date(p.jira.syncedAt).toLocaleString('cs-CZ')}` : 'Importovat epics a stories z Jiry'}><Glyph name="import" /> Jira</button>
          <button className="btn" onClick={() => setCreating({ kind: 'epic' })}><TypeIcon type="epic" size={14} /> Nový epic</button>
          <button className="btn" onClick={() => setCreating({ kind: 'story' })}><TypeIcon type="story" size={14} /> Nová story</button>
          <ActionButton className="btn primary" disabled={s.generating !== null} busy={s.generating === 'stories'} busyLabel="Analytik pracuje…" icon={<Glyph name="spark" />} onClick={() => s.generate('stories')}>Navrhnout stories</ActionButton>
        </>}
      </div>
      <div className="board">
        <div className="board-cols board-head">
          {STORY_STAGES.map((st) => <div key={st} className="colhead"><Tile glyph={STORY_STAGE_UI[st].glyph} tone={STORY_STAGE_UI[st].tone} size={20} />{STORY_STAGE_UI[st].label}</div>)}
        </div>
        {!p.stories.length && <div className="board-empty muted">Zatím žádné stories. Navrhne je Analytik z designu a zadání.</div>}
        {dragging && !epics.includes(null) && <section className={`lane lane-drop ${over === 'none' ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver('none') }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); moveTo(e.dataTransfer.getData('text/plain')); setOver(null) }}>
          <div className="lane-head"><b>Bez epicu</b><span className="muted small">Pusťte sem story, kterou chcete z epicu vyjmout</span></div>
        </section>}
        {epics.map((epic) => {
          const stories = p.stories.filter((x) => (epic ? x.epicId === epic.id : !x.epicId || !(p.epics ?? []).some((e) => e.id === x.epicId)))
          if (!epic && !stories.length) return null
          const done = stories.filter((x) => stageOf(p, x) === 'done').length
          const bugs = stories.flatMap((x) => openBugs(p, x.id))
          return (
            <section key={epic?.id ?? 'none'} className={`lane ${over === (epic?.id ?? 'none') ? 'over' : ''}`}
              onDragOver={(e) => { if (!dragging) return; e.preventDefault(); setOver(epic?.id ?? 'none') }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) moveTo(id, epic?.id); setOver(null) }}>
              <div className="lane-head">
                {epic ? <TypeIcon type="epic" /> : null}
                {epic && <span className="key">{epic.id}</span>}
                {epic ? <button className="link-btn lane-title" onClick={() => open(epic.id)}>{epic.title}</button> : <b>Bez epicu</b>}
                <span className="muted small">{stories.length} stories · {done} hotové</span>
                {epic && <PlanningSummary kind="epic" id={epic.id} />}
                <span className="bar lane-bar"><i style={{ width: `${stories.length ? (done / stories.length) * 100 : 0}%` }} /></span>
                <span className="spacer" />
                {!s.readOnly && <button className="tool-btn" title="Přidat story do epicu" onClick={() => setCreating({ kind: 'story', epicId: epic?.id })}><Glyph name="plus" /></button>}
              </div>
              <div className="board-cols">
                {STORY_STAGES.map((st) => (
                  <div key={st} className="board-col">
                    {stories.filter((x) => stageOf(p, x) === st).map((x) => <StoryCard key={x.id} story={x} runs={runs} onOpen={() => open(x.id)}
                      draggable={!s.readOnly} onDrag={(on) => { setDragging(on ? x.id : null); if (!on) setOver(null) }} />)}
                    {(st === 'build' || st === 'tests') && bugs.filter((b) => (b.status === 'running' || b.status === 'review') === (st === 'build')).map((b) => (
                      <BugCard key={b.id} bug={b} running={runs.some((r) => r.issueId === b.id)} onOpen={() => open(b.storyId)} />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {creating && <CreateDialog kind={creating.kind} epicId={creating.epicId} onClose={() => setCreating(null)} />}
      {jira && <JiraDialog onClose={() => setJira(false)} />}
    </>
  )
}

const JIRA_TOKEN_KEY = 'aforge.jiraToken'

/** Jira Cloud: address, e-mail and API token. Data Center: address and a personal access token, no e-mail. */
const JiraDialog = ({ onClose }: { onClose: () => void }) => {
  const s = useStudio()
  const saved = s.project.jira
  const [url, setUrl] = useState(saved?.url ?? '')
  const [email, setEmail] = useState(saved?.email ?? '')
  const [token, setToken] = useState(() => { try { return localStorage.getItem(JIRA_TOKEN_KEY) ?? '' } catch { return '' } })
  const [jql, setJql] = useState(saved?.jql ?? 'project = ABC AND issuetype in (Epic, Story) ORDER BY created')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await s.flush()
      try { localStorage.setItem(JIRA_TOKEN_KEY, token) } catch { /* the token is only a convenience */ }
      const r = await api<{ found: number; added: number; updated: number; skipped: number }>(`/projects/${s.project.id}/jira`, { body: { url, email, token, jql } })
      await s.reload()
      const parts = [r.added && `nové ${r.added}`, r.updated && `aktualizované ${r.updated}`, r.skipped && `přeskočené smazané ${r.skipped}`].filter(Boolean)
      s.toast(r.found ? `Z Jiry ${r.found} položek: ${parts.join(', ')}.` : 'Dotaz v Jiře nic nenašel.')
      onClose()
    } catch (e) {
      s.toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog onClose={onClose} width={560}>
      <h3>Import z Jiry</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Epicy a stories z dotazu se přidají na board. Opakovaný import je aktualizuje podle klíče v Jiře; obrazovky, stav a tasky v Reactoru zůstanou.
      </p>
      <div className="form-row">
        <label>Adresa</label>
        <input className="field" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://firma.atlassian.net" />
      </div>
      <div className="form-row">
        <label>E-mail</label>
        <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Jira Cloud; u Data Center nechte prázdné" />
      </div>
      <div className="form-row">
        <label>Token</label>
        <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token (nebo JIRA_TOKEN na serveru)" />
      </div>
      <div className="form-row">
        <label>JQL</label>
        <input className="field" value={jql} onChange={(e) => setJql(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>
        API token pro Cloud vytvoříte na id.atlassian.com → Security → API tokens, pro Data Center v profilu → Personal Access Tokens. Uloží se jen v tomto prohlížeči.
      </p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>Zrušit</button>
        <button className="btn primary" disabled={!url.trim() || !jql.trim() || busy} onClick={() => void run()}>{busy ? 'Importuji…' : 'Importovat'}</button>
      </div>
    </Dialog>
  )
}

/** Name a new epic, or a new story placed into an existing epic, no epic, or a new epic named right here. */
const CreateDialog = ({ kind, epicId, onClose }: { kind: 'story' | 'epic'; epicId?: string; onClose: () => void }) => {
  const s = useStudio()
  const epics = s.project.epics ?? []
  const [title, setTitle] = useState('')
  const [epic, setEpic] = useState<string>(epicId ?? (kind === 'story' && epics.length ? epics[epics.length - 1]!.id : ''))
  const [newEpic, setNewEpic] = useState('')
  const NEW = '__new'
  const valid = title.trim() && (kind === 'epic' || epic !== NEW || newEpic.trim())
  const create = () => {
    s.update((p) => {
      if (kind === 'epic') {
        const [id] = nextKeys(p)
        return { ...p, epics: [...(p.epics ?? []), { id: id!, title: title.trim(), description: '', screenIds: [] }] }
      }
      let next = p
      let target = epic || undefined
      if (epic === NEW) {
        const [id] = nextKeys(next)
        next = { ...next, epics: [...(next.epics ?? []), { id: id!, title: newEpic.trim(), description: '', screenIds: [] }] }
        target = id
      }
      const [id] = nextKeys(next)
      const story: Story = { id: id!, epicId: target, title: title.trim(), asA: 'uživatel', iWant: '', soThat: '', acceptance: [], priority: 'should', status: 'draft', screenIds: [] }
      return { ...next, stories: [...next.stories, story] }
    })
    onClose()
  }
  return (
    <Dialog onClose={onClose} width={440}>
      <form className="create-form" onSubmit={(e) => { e.preventDefault(); if (valid) create() }}>
        <h3><TypeIcon type={kind} size={18} /> {kind === 'epic' ? 'Nový epic' : 'Nová story'}</h3>
        <input className="field" autoFocus placeholder="Název" value={title} onChange={(e) => setTitle(e.target.value)} />
        {kind === 'story' && <>
          <select className="field" aria-label="Epic" value={epic} onChange={(e) => setEpic(e.target.value)}>
            <option value="">Bez epicu</option>
            {epics.map((x) => <option key={x.id} value={x.id}>{x.id} {x.title}</option>)}
            <option value={NEW}>Nový epic…</option>
          </select>
          {epic === NEW && <input className="field" placeholder="Název nového epicu" value={newEpic} onChange={(e) => setNewEpic(e.target.value)} />}
        </>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Zrušit</button>
          <button className="btn primary" disabled={!valid}>Vytvořit</button>
        </div>
      </form>
    </Dialog>
  )
}

const StoryCard = ({ story, runs, onOpen, draggable, onDrag }: { story: Story; runs: { issueId?: string; role?: string }[]; onOpen: () => void; draggable?: boolean; onDrag?: (on: boolean) => void }) => {
  const s = useStudio()
  const p = s.project
  const screen = p.screens.find((x) => story.screenIds.includes(x.id) && x.image)
  const tasks = issuesOf(p, story.id).filter((i) => i.type !== 'bug')
  const bugs = openBugs(p, story.id)
  const working = runs.find((r) => r.issueId && issuesOf(p, story.id).some((i) => i.id === r.issueId))
  return (
    <button className="story-tile" onClick={onOpen} draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', story.id); e.dataTransfer.effectAllowed = 'move'; onDrag?.(true) }}
      onDragEnd={() => onDrag?.(false)}>
      {screen?.image && <img className="story-thumb" src={screenUrl(p, screen.image)} alt="" loading="lazy" />}
      <span className="row-gap"><TypeIcon type="story" /><span className="key">{story.id}</span></span>
      <b className="story-tile-title">{story.title}</b>
      <span className="trail">
        <PlanningSummary kind="story" id={story.id} />
        {LAYERS.filter((l) => tasks.some((t) => t.layer === l)).map((l) => {
          const own = tasks.filter((t) => t.layer === l)
          const done = own.filter((t) => t.status === 'done').length
          return (
            <span key={l} className="trail-chip" title={`${LAYER_LABEL[l]}: ${done} z ${own.length} hotovo`}>
              <Tile glyph={LAYER_UI[l].glyph} tone={LAYER_UI[l].tone} size={14} />
              {own.length > 1 && <span className="num">{done}/{own.length}</span>}
              <StatusIcon shape={worstShape(own)} size={12} />
            </span>
          )
        })}
        {!tasks.length && story.acceptance.length > 0 && <span className="muted small">{story.acceptance.length} kritéria</span>}
        {bugs.length > 0 && <span className="trail-chip"><TypeIcon type="bug" size={14} />{bugs.length}</span>}
        {working?.role && <span className="who"><Tile glyph={ROLE_UI[working.role as keyof typeof ROLE_UI].glyph} tone={ROLE_UI[working.role as keyof typeof ROLE_UI].tone} size={18} /></span>}
      </span>
    </button>
  )
}

/** The state that needs attention first: a running, waiting or failed task outranks the rest. */
const worstShape = (issues: Issue[]): Shape => (['run', 'wait', 'err', 'block', 'todo', 'ok'] as Shape[]).find((sh) => issues.some((i) => shapeOf(i.status) === sh)) ?? 'todo'

const BugCard = ({ bug, running, onOpen }: { bug: Issue; running: boolean; onOpen: () => void }) => (
  <button className="story-tile" onClick={onOpen}>
    <span className="row-gap"><TypeIcon type="bug" /><span className="key">{bug.id}</span>{bug.storyId && <span className="muted small">pod {bug.storyId}</span>}</span>
    <b className="story-tile-title">{bug.title}</b>
    <span className="trail">
      <span className="trail-chip"><Tile glyph={LAYER_UI[bug.layer].glyph} tone={LAYER_UI[bug.layer].tone} size={14} /><StatusIcon shape={running ? 'run' : shapeOf(bug.status)} size={12} /></span>
    </span>
  </button>
)

/** One story: design, criteria with tests, its thread, and its tasks and bugs. */
const StoryDetail = ({ story }: { story: Story }) => {
  const s = useStudio()
  const p = s.project
  const epic = (p.epics ?? []).find((e) => e.id === story.epicId)
  const issues = issuesOf(p, story.id)
  const tasks = issues.filter((i) => i.type !== 'bug')
  const bugs = issues.filter((i) => i.type === 'bug')
  const proposed = tasks.some((i) => i.status === 'proposed')
  const ready = issues.some((i) => i.status === 'todo' || i.status === 'failed')
  const running = issues.some((i) => i.status === 'running')
  const tests = p.testReport?.cases.filter((c) => c.storyIds.includes(story.id)) ?? []
  const screens = p.screens.filter((x) => story.screenIds.includes(x.id))
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<IssueFilter>(NO_FILTER)
  const groups = useCollapsed()
  const set = (patch: Partial<Story>) => s.update((x) => ({ ...x, stories: x.stories.map((st) => (st.id === story.id ? { ...st, ...patch } : st)) }))
  const back = () => s.setFocus({ ...s.focus, storyId: undefined })

  return (
    <>
      <div className="pane-bar">
        <button className="tool-btn" onClick={back} title="Zpět na board"><Glyph name="back" /></button>
        <TypeIcon type="story" size={20} />
        <div className="detail-title">
          {epic && <span className="crumb"><TypeIcon type="epic" size={12} />{epic.id} {epic.title}</span>}
          <span className="row-gap"><span className="key">{story.id}</span>
            <input className="title-input" value={story.title} readOnly={s.readOnly} aria-label="Název story" onChange={(e) => set({ title: e.target.value })} />
          </span>
        </div>
        <span className="spacer" />
        {!s.readOnly && <>
          <DeleteItemButton kind="story" id={story.id} />
          {!tasks.length && <ActionButton disabled={s.generating !== null} busy={s.generating === 'split'} busyLabel="Architekt pracuje…" icon={<Glyph name="split" />} onClick={() => s.generate('split', [story.id])}>Rozpadnout</ActionButton>}
          {proposed && <ActionButton busyLabel="Schvaluji…" icon={<Glyph name="check" />} onClick={() => s.act(`/stories/${story.id}/breakdown/approve`)}>Schválit rozpad</ActionButton>}
          {(ready || running) && <ActionButton className="btn primary" busy={running} busyLabel="Implementuje se…" icon={<Glyph name="play" />} onClick={() => s.act(`/stories/${story.id}/implement`)}>Implementovat</ActionButton>}
          {s.preview.url && <a className="btn" href={previewHref(s.project.id, s.preview.url)} target="_blank" rel="noreferrer"><Glyph name="preview" /> Náhled</a>}
        </>}
      </div>
      <div className="story-detail">
        <div className="story-aside">
        <section className="card-pane">
          <h3><Tile glyph="design" tone="var(--c-design)" size={20} /> Design</h3>
          {screens.map((sc) => (
            <figure key={sc.id} className="detail-screen">
              {sc.image ? <img src={screenUrl(p, sc.image)} alt={sc.name} /> : <div className="frame-empty" />}
              <figcaption className="muted small">{sc.name} · {sc.elements.filter((e) => e.storyIds.includes(story.id)).length} vrstev navázaných na story</figcaption>
            </figure>
          ))}
          <div className="screen-picks">
            {p.screens.map((sc) => (
              <label key={sc.id} className="check-row">
                <input type="checkbox" disabled={s.readOnly} checked={story.screenIds.includes(sc.id)} onChange={(e) => set({ screenIds: e.target.checked ? [...story.screenIds, sc.id] : story.screenIds.filter((x) => x !== sc.id) })} />
                {sc.name}
              </label>
            ))}
            {!p.screens.length && <span className="muted small">Design zatím není synchronizovaný.</span>}
          </div>
        </section>
        <PlanningPanel key={story.id} kind="story" id={story.id} />
        </div>

        <section className="card-pane">
          <h3>Zadání</h3>
          <DescriptionEditor key={story.id} kind="story" id={story.id} />
          {!!p.storyArchive?.some((a) => a.replacedBy.includes(story.id)) && <p className="small">Vznikla z: {p.storyArchive.filter((a) => a.replacedBy.includes(story.id)).map((a) => <button key={a.story.id} className="link-btn" onClick={() => s.setFocus({ ...s.focus, storyId: a.story.id })}>{a.story.id} </button>)}</p>}
          <div className="story-sentence-edit">
            <label>Jako<input className="field" value={story.asA} readOnly={s.readOnly} onChange={(e) => set({ asA: e.target.value })} /></label>
            <label>chci<input className="field" value={story.iWant} readOnly={s.readOnly} onChange={(e) => set({ iWant: e.target.value })} /></label>
            <label>abych<input className="field" value={story.soThat} readOnly={s.readOnly} onChange={(e) => set({ soThat: e.target.value })} /></label>
            <label>Epic
              <select className="field" disabled={s.readOnly} value={story.epicId ?? ''} onChange={(e) => set({ epicId: e.target.value || undefined })}>
                <option value="">Bez epicu</option>
                {(p.epics ?? []).map((e) => <option key={e.id} value={e.id}>{e.id} {e.title}</option>)}
              </select>
            </label>
          </div>
          <h3>Kritéria a testy <span className="muted">{tests.filter((t) => t.status === 'passed').length} z {tests.length} testů prošlo</span></h3>
          <textarea className="field criteria" rows={Math.max(3, story.acceptance.length + 1)} readOnly={s.readOnly} placeholder="Jedno kritérium na řádek (Given / When / Then)"
            value={story.acceptance.join('\n')} onChange={(e) => set({ acceptance: e.target.value.split('\n') })} />
          {tests.length > 0 && (
            <div className="test-list">
              {tests.map((t) => (
                <div key={t.title} className="test-row">
                  <StatusIcon shape={t.status === 'passed' ? 'ok' : t.status === 'skipped' ? 'todo' : 'err'} />
                  <span className="grow ell" title={t.error}>{t.title.replace(/^.*›\s*/, '')}</span>
                  <span className="muted small num">{(t.durationMs / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} s</span>
                </div>
              ))}
            </div>
          )}
          <h3>Konzultace</h3>
          <AnchoredThread anchor={story.id} placeholder={`Napsat k ${story.id}…`} />
        </section>

        <section className="card-pane">
          <h3>Tasky a bugy {proposed && <span className="muted">rozpad ke schválení</span>}</h3>
          {!issues.length && <div className="muted small">Story zatím nemá tasky. Rozpad připraví Architekt.</div>}
          {issues.length > 5 && <IssueFilterBar filter={filter} onChange={setFilter} issues={issues} />}
          {[...LAYERS.map((l) => ({ id: l, title: <><Tile glyph={LAYER_UI[l].glyph} tone={LAYER_UI[l].tone} size={18} />{LAYER_LABEL[l]}</>, list: tasks.filter((i) => i.layer === l) })),
            { id: 'bugs', title: <><TypeIcon type="bug" size={18} />Bugy</>, list: bugs }]
            .filter((g) => g.list.length)
            .map((g) => {
              const shown = g.list.filter((i) => matchesFilter(i, filter))
              if (!shown.length) return null
              const key = `${story.id}:${g.id}`
              return (
                <IssueGroup key={g.id} title={g.title} issues={shown} open={groups.isOpen(key, g.list.some((i) => i.status !== 'done'))} onToggle={(o) => groups.toggle(key, o)}>
                  {shown.map((i) => <IssueRow key={i.id} issue={i} onClick={() => { s.setFocus({ ...s.focus, issueId: i.id }); s.setStage('build') }} />)}
                </IssueGroup>
              )
            })}
          {issues.length > 0 && !issues.some((i) => matchesFilter(i, filter)) && <div className="muted small">Filtru neodpovídá žádný task.</div>}
          {proposed && !s.readOnly && (
            <div className="row-gap">
              <ActionButton className="btn primary small" busyLabel="Schvaluji…" onClick={() => s.act(`/stories/${story.id}/breakdown/approve`)}>Schválit rozpad</ActionButton>
              <ActionButton className="btn small" onClick={() => s.act(`/stories/${story.id}/breakdown/reject`)}>Zamítnout</ActionButton>
            </div>
          )}
          {!s.readOnly && (adding ? <NewIssue storyId={story.id} onDone={() => setAdding(false)} /> : <button className="btn small" onClick={() => setAdding(true)}><Glyph name="plus" /> Task nebo bug</button>)}
        </section>
      </div>
    </>
  )
}

const EpicDetail = ({ epic }: { epic: Epic }) => {
  const s = useStudio()
  const stories = s.project.stories.filter((st) => st.epicId === epic.id)
  const set = (patch: Partial<Epic>) => s.update((p) => ({ ...p, epics: (p.epics ?? []).map((e) => e.id === epic.id ? { ...e, ...patch } : e) }))
  return <><div className="pane-bar"><button className="btn" onClick={() => s.setFocus({ ...s.focus, storyId: undefined })}><Glyph name="back" /> Stories</button><TypeIcon type="epic" /><span className="key">{epic.id}</span><h2>Epic</h2><span className="spacer" /><DeleteItemButton kind="epic" id={epic.id} /></div>
    <div className="pane-scroll epic-detail"><section className="card-pane"><label className="review-field">Název epicu<input className="field" readOnly={s.readOnly} value={epic.title} onChange={(e) => set({ title: e.target.value })} /></label><DescriptionEditor key={epic.id} kind="epic" id={epic.id} /></section>
    <PlanningPanel key={epic.id} kind="epic" id={epic.id} />
    <section className="card-pane"><h3>Stories ({stories.length})</h3>{stories.map((st) => <button key={st.id} className="epic-story-link" onClick={() => s.setFocus({ ...s.focus, storyId: st.id })}><TypeIcon type="story" /><span className="key">{st.id}</span>{st.title}<PlanningSummary kind="story" id={st.id} /></button>)}{!stories.length && <p className="muted">Epic zatím nemá žádné stories.</p>}</section></div></>
}

const NewIssue = ({ storyId, onDone }: { storyId: string; onDone: () => void }) => {
  const s = useStudio()
  const repos = reposOf(s.project)
  const [draft, setDraft] = useState<Pick<Issue, 'type' | 'title' | 'layer' | 'repoId'>>({ type: 'task', title: '', layer: 'fe', repoId: repos[0]!.id })
  const add = () => {
    const now = new Date().toISOString()
    s.update((p) => ({ ...p, issues: [...(p.issues ?? []), { ...draft, id: nextKeys(p)[0]!, storyId, description: '', status: 'todo', source: 'manual', files: [], createdAt: now, updatedAt: now }] }))
    onDone()
  }
  return (
    <form className="new-issue" onSubmit={(e) => { e.preventDefault(); if (draft.title.trim()) add() }}>
      <div className="row-gap">
        <select className="field" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Issue['type'] })}><option value="task">Task</option><option value="bug">Bug</option></select>
        <select className="field" value={draft.layer} onChange={(e) => setDraft({ ...draft, layer: e.target.value as Issue['layer'] })}><option value="fe">Frontend</option><option value="be">Backend</option><option value="test">Testy</option><option value="other">Ostatní</option></select>
        {repos.length > 1 && <select className="field" value={draft.repoId} onChange={(e) => setDraft({ ...draft, repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
      </div>
      <input className="field" autoFocus placeholder="Název" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <div className="row-gap"><button className="btn primary small" disabled={!draft.title.trim()}>Přidat</button><button type="button" className="btn small" onClick={onDone}>Zrušit</button></div>
    </form>
  )
}
