// Tests: one tree of epics, their stories and the stories' tests. A test is described like a walkthrough –
// page, section, instructions – and runs against the preview with a video. The Tester designs and writes the
// tests of selected stories; a selection of epics, stories or tests runs in one go.
import { useState } from 'react'
import type { Epic, Story, TestCase, Walkthrough } from '@aforge/shared'
import { api, useProjectEvents } from '../api'
import { Icon } from '../icons'
import { ActionButton } from '../components/ActionButton'
import { Glyph, StatusIcon, TypeIcon, type Shape } from '../components/Glyphs'
import { Markdown } from '../components/Markdown'
import { useCollapsed } from '../components/Work'
import { useStudio, type LogLine } from '../studio'
import { LogView } from './BuildStage'
import { DeleteItemButton, EditItemButton } from '../components/ItemActions'
import { PlanningPanel } from '../components/Planning'

/** Results of the e2e suite (older projects and archives). */
const STATUS: Record<TestCase['status'], { label: string; cls: string }> = {
  passed: { label: 'Prošel', cls: 'green' },
  failed: { label: 'Selhal', cls: 'red' },
  timedOut: { label: 'Timeout', cls: 'red' },
  interrupted: { label: 'Přerušen', cls: 'orange' },
  skipped: { label: 'Přeskočen', cls: 'gray' },
}
export { STATUS as TEST_STATUS }

const STATE: Record<Walkthrough['status'], { shape: Shape; label: string }> = {
  draft: { shape: 'todo', label: 'Bez skriptu' },
  generating: { shape: 'run', label: 'Tester píše skript…' },
  ready: { shape: 'todo', label: 'Připraven' },
  recording: { shape: 'run', label: 'Běží…' },
  recorded: { shape: 'ok', label: 'Prošel' },
  failed: { shape: 'err', label: 'Selhal' },
}
const busy = (w: Walkthrough) => w.status === 'generating' || w.status === 'recording'
const nameOf = (w: Walkthrough) => w.title ?? w.section

type Group = { epic: Epic | null; stories: Story[] }

export const TestsStage = () => {
  const s = useStudio()
  const p = s.project
  const tests = p.walkthroughs ?? []
  const groups = useCollapsed()
  const [stories, setStories] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [planning, setPlanning] = useState<Set<string>>(new Set())
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({})
  const [draft, setDraft] = useState<Draft | null>(null)

  // The Tester's progress and each test's run come on their own channel.
  useProjectEvents(p.id, (e) => {
    if (e.channel !== 'walkthrough') return
    const data = e.data as { id?: string; storyId?: string; error?: boolean } | undefined
    if (data?.storyId && (e.kind === 'plan' || e.kind === 'planned')) {
      setPlanning((x) => { const next = new Set(x); if (e.kind === 'plan') next.add(data.storyId!); else next.delete(data.storyId!); return next })
      if (data.error) s.toast(e.text, true)
      return
    }
    if (!data?.id) return
    setLogs((all) => ({ ...all, [data.id!]: [...(e.kind === 'start' ? (all[data.id!] ?? []).slice(-1500) : (all[data.id!] ?? []).slice(-2000)), { kind: e.kind, text: e.text }] }))
  })

  const testsOf = (st: Story) => tests.filter((w) => w.storyIds[0] === st.id)
  const epics = p.epics ?? []
  const tree: Group[] = [
    ...epics.map((epic) => ({ epic, stories: p.stories.filter((st) => st.epicId === epic.id) })),
    { epic: null, stories: p.stories.filter((st) => !st.epicId || !epics.some((e) => e.id === st.epicId)) },
  ].filter((g) => g.epic || g.stories.length)
  const loose = tests.filter((w) => !w.storyIds.length || !p.stories.some((st) => st.id === w.storyIds[0]))

  // Ticking a story or an epic ticks its tests as well; the stories are what tests get written for.
  const setStory = (st: Story, on: boolean) => {
    setStories((x) => { const next = new Set(x); if (on) next.add(st.id); else next.delete(st.id); return next })
    setPicked((x) => { const next = new Set(x); testsOf(st).forEach((w) => (on ? next.add(w.id) : next.delete(w.id))); return next })
  }
  const setTest = (id: string, on: boolean) => setPicked((x) => { const next = new Set(x); if (on) next.add(id); else next.delete(id); return next })
  const storyOn = (st: Story) => stories.has(st.id) || (testsOf(st).length > 0 && testsOf(st).every((w) => picked.has(w.id)))
  const groupOn = (g: Group) => g.stories.length > 0 && g.stories.every(storyOn)

  const chosenStories = p.stories.filter((st) => stories.has(st.id))
  const chosenTests = tests.filter((w) => picked.has(w.id))
  const writing = planning.size > 0 || tests.some((w) => w.status === 'generating')
  const running = tests.some((w) => w.status === 'recording')
  const selected = tests.find((w) => w.id === s.focus.testId)
  const open = (id: string) => { setDraft(null); s.setFocus({ ...s.focus, testId: id }) }
  const summary = (list: Walkthrough[]) => {
    const ok = list.filter((w) => w.status === 'recorded').length
    return list.length ? <span className="row-gap small num"><StatusIcon shape={ok === list.length ? 'ok' : list.some((w) => w.status === 'failed') ? 'err' : 'todo'} size={13} />{ok}/{list.length}</span> : <span className="muted small">bez testů</span>
  }

  const TestRow = ({ w }: { w: Walkthrough }) => (
    <div className={`tree-test ${selected?.id === w.id ? 'current' : ''}`}>
      <input type="checkbox" aria-label={`Vybrat test ${nameOf(w)}`} checked={picked.has(w.id)} onChange={(e) => setTest(w.id, e.target.checked)} />
      <button className="tree-main" onClick={() => open(w.id)}>
        <StatusIcon shape={STATE[w.status].shape} label={STATE[w.status].label} size={14} />
        <span className="ell grow">{nameOf(w)}</span>
        {w.video && <Glyph name="play" size={12} />}
        <span className="muted small mono ell tree-route">{w.route}</span>
      </button>
    </div>
  )

  return (
    <>
      <div className="pane-bar">
        <h2>Testy</h2>
        <span className="spacer" />
        {!s.readOnly && <>
          <button className="btn" onClick={() => setDraft({ ...EMPTY, storyId: chosenStories[0]?.id ?? '' })}><Glyph name="plus" /> Nový test</button>
          <ActionButton disabled={!chosenStories.length} busy={writing} busyLabel="Tester píše testy…" icon={<Glyph name="test" />}
            title="Tester navrhne testy z akceptačních kritérií vybraných stories, napíše je a spustí"
            onClick={() => s.act('/tests/generate', { storyIds: chosenStories.map((st) => st.id) })}>{`Vygenerovat testy${chosenStories.length ? ` (${chosenStories.length})` : ''}`}</ActionButton>
          <ActionButton className="btn primary" disabled={!chosenTests.length} busy={running} busyLabel="Testy běží…" icon={<Icon.play />}
            title="Spustí vybrané testy jeden po druhém, každý s videem; náhled se spustí sám"
            onClick={() => s.act('/tests/run', { ids: chosenTests.map((w) => w.id) })}>{`Spustit${chosenTests.length ? ` (${chosenTests.length})` : ''}`}</ActionButton>
        </>}
      </div>
      <div className="tests-layout">
        <div className="test-tree pane-scroll">
          {!p.stories.length && !loose.length && <div className="empty-line muted">Zatím žádné stories ani testy.</div>}
          {tree.map((g) => {
            const key = `tests:${g.epic?.id ?? 'none'}`
            const all = g.stories.flatMap(testsOf)
            const isOpen = groups.isOpen(key)
            return (
              <section key={key} className="tree-epic">
                <div className="tree-head">
                  <input type="checkbox" aria-label={`Vybrat ${g.epic?.title ?? 'stories bez epicu'}`} checked={groupOn(g)} onChange={(e) => g.stories.forEach((st) => setStory(st, e.target.checked))} />
                  <button className="tree-main" aria-expanded={isOpen} onClick={() => groups.toggle(key, !isOpen)}>
                    <span className={`chev ${isOpen ? 'open' : ''}`} aria-hidden>›</span>
                    {g.epic ? <><TypeIcon type="epic" size={14} /><span className="key">{g.epic.id}</span><b className="ell grow">{g.epic.title}</b></> : <b className="ell grow">Bez epicu</b>}
                    {summary(all)}
                  </button>
                </div>
                {isOpen && g.stories.map((st) => {
                  const own = testsOf(st)
                  const sKey = `tests:${st.id}`
                  const sOpen = groups.isOpen(sKey, own.length <= 6)
                  return (
                    <div key={st.id} className="tree-story">
                      <div className="tree-head">
                        <input type="checkbox" aria-label={`Vybrat ${st.id}`} checked={storyOn(st)} onChange={(e) => setStory(st, e.target.checked)} />
                        <button className="tree-main" aria-expanded={sOpen} onClick={() => groups.toggle(sKey, !sOpen)}>
                          <span className={`chev ${sOpen ? 'open' : ''}`} aria-hidden>›</span>
                          <TypeIcon type="story" size={14} /><span className="key">{st.id}</span><span className="ell grow">{st.title}</span>
                          {planning.has(st.id) ? <span className="row-gap small"><StatusIcon shape="run" size={13} />Tester navrhuje…</span> : summary(own)}
                        </button>
                      </div>
                      {sOpen && own.map((w) => <TestRow key={w.id} w={w} />)}
                    </div>
                  )
                })}
              </section>
            )
          })}
          {loose.length > 0 && (
            <section className="tree-epic">
              <div className="tree-head"><span className="tree-main"><b className="grow">Průchody bez story</b>{summary(loose)}</span></div>
              {loose.map((w) => <TestRow key={w.id} w={w} />)}
            </section>
          )}
        </div>
        <div className="inspector test-detail">
          {draft ? <NewTest draft={draft} setDraft={setDraft} onCreated={open} />
            : selected ? <TestDetail w={selected} log={logs[selected.id] ?? []} />
            : <div className="muted small">Vyberte test. Stories zaškrtněte a dejte Vygenerovat testy, vybrané testy pusťte tlačítkem Spustit.</div>}
        </div>
      </div>
    </>
  )
}

export const TestDetail = ({ w, log }: { w: Walkthrough; log: LogLine[] }) => {
  const s = useStudio()
  const p = s.project
  const story = p.stories.find((st) => st.id === w.storyIds[0])
  const [showLog, setShowLog] = useState(false)
  return (
    <div className="test-detail-body">
      <div className="row-gap"><StatusIcon shape={STATE[w.status].shape} /><span className="small muted">{STATE[w.status].label}</span></div>
      <h3 className="test-title">{nameOf(w)}</h3>
      {story && <button className="link-btn row-gap small" onClick={() => { s.setFocus({ ...s.focus, storyId: story.id }); s.setStage('stories') }}><TypeIcon type="story" size={12} />{story.id} {story.title}</button>}
      <dl className="test-facts">
        <dt>Stránka</dt><dd className="mono">{w.route}</dd>
        <dt>Sekce</dt><dd>{w.section}</dd>
      </dl>
      {w.instructions && <div className="test-instructions"><h4>Pokyny</h4><Markdown text={w.instructions} /></div>}
      {!s.readOnly && <div className="row-gap">
        <ActionButton className="btn primary" busy={busy(w)} busyLabel={STATE[w.status].label} icon={<Icon.play />} onClick={() => s.act(`/walkthroughs/${w.id}/test`)}
          title="Napíše skript, pokud ještě není, a spustí test s videem">Otestovat</ActionButton>
        <EditItemButton kind="test" id={w.id} /><DeleteItemButton kind="test" id={w.id} />
      </div>}
      {w.error && <pre className="log wt-error">{w.error}</pre>}
      <PlanningPanel key={w.id} kind="test" id={w.id} />
      {w.video ? (
        <div className="wt-video">
          <video key={w.recordedAt} controls preload="metadata" src={`/api/projects/${p.id}/walkthroughs/${w.video}?v=${encodeURIComponent(w.recordedAt ?? '')}`} />
          <span className="muted small">Nahráno {w.recordedAt ? new Date(w.recordedAt).toLocaleString('cs') : ''}</span>
        </div>
      ) : <div className="empty-video muted small">Video zatím není.</div>}
      <div className="row-gap small">
        <span className="muted mono ell grow">{w.script}</span>
        {log.length > 0 && <button className="link-btn" onClick={() => setShowLog(!showLog)}>{showLog ? 'Skrýt log' : 'Log'}</button>}
      </div>
      {showLog && <div style={{ height: 220, display: 'flex' }}><LogView lines={log} empty="" /></div>}
    </div>
  )
}

type Draft = { storyId: string; title: string; route: string; section: string; instructions: string }
const EMPTY: Draft = { storyId: '', title: '', route: '/', section: '', instructions: '' }

const NewTest = ({ draft, setDraft, onCreated }: { draft: Draft; setDraft: (d: Draft | null) => void; onCreated: (id: string) => void }) => {
  const s = useStudio()
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const create = async () => {
    try {
      const w = await api<Walkthrough>(`/projects/${s.project.id}/walkthroughs`, {
        body: { title: draft.title, route: draft.route, section: draft.section || draft.title, instructions: draft.instructions, storyIds: draft.storyId ? [draft.storyId] : [] },
      })
      setDraft(null)
      await s.reload()
      onCreated(w.id)
      await s.act(`/walkthroughs/${w.id}/test`)
    } catch (e) {
      s.toast((e as Error).message, true)
    }
  }
  return (
    <form className="new-test" onSubmit={(e) => e.preventDefault()}>
      <h3>Nový test</h3>
      <select className="field" aria-label="Story" value={draft.storyId} onChange={(e) => set({ storyId: e.target.value })}>
        <option value="">Bez story</option>
        {s.project.stories.map((st) => <option key={st.id} value={st.id}>{st.id} {st.title}</option>)}
      </select>
      <input className="field" autoFocus placeholder="Co test ověřuje" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      <input className="field mono" placeholder="/stránka" value={draft.route} onChange={(e) => set({ route: e.target.value })} />
      <input className="field" placeholder="Sekce stránky, nebo CSS selektor" value={draft.section} onChange={(e) => set({ section: e.target.value })} />
      <textarea className="field" rows={5} placeholder="Pokyny: scénář krok za krokem a co se má ověřit" value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} />
      <div className="row-gap">
        <button type="button" className="btn" onClick={() => setDraft(null)}>Zrušit</button>
        <ActionButton className="btn primary" disabled={!draft.title.trim() || !draft.route.startsWith('/')} busyLabel="Zakládám…" icon={<Icon.play />} onClick={create}>Otestovat</ActionButton>
      </div>
    </form>
  )
}
