// Archive readers expose navigation and original text, without mounting editor / execution actions.
import { useEffect, useState } from 'react'
import type { AgentRun, PipelineRun, PreviewStatus } from '@aforge/shared'
import { api, type HubEvent } from '../api'
import { useStudio } from '../studio'
import { Markdown } from '../components/Markdown'
import { Mermaid } from '../components/Mermaid'
import { AgentRuns } from '../components/AgentRuns'
import { CodeStage } from './CodeStage'
import { STORY_PRIORITY, STORY_STATUS } from './StoriesStage'
import { TEST_STATUS } from './TestsStage'
import { STATE_LABEL } from './PreviewStage'

type Record = { capturedAt: string; preview: PreviewStatus; events: HubEvent[]; runs: AgentRun[] }
const Text = ({ text, empty = 'Bez uloženého obsahu.' }: { text?: string; empty?: string }) => text ? <div className="archive-text"><Markdown text={text} /></div> : <p className="muted">{empty}</p>

export const ArchivedStage = () => {
  const s = useStudio(); const p = s.project
  const [record, setRecord] = useState<Record>()
  const [pipeline, setPipeline] = useState<PipelineRun>()
  const [error, setError] = useState('')
  useEffect(() => {
    void api<Record>(`/projects/${p.id}/session-record`).then(setRecord).catch((e: Error) => setError(e.message))
    void api<PipelineRun>(`/projects/${p.id}/pipeline`).then((r) => { if (r.id) setPipeline(r) }).catch((e: Error) => setError(e.message))
  }, [p.id])
  if (s.stage === 'code') return <CodeStage />
  return <>
    <div className="pane-bar"><h2>{s.activeStep.label}</h2><span className="chip gray">Pouze pro čtení</span></div>
    <div className="pane-scroll archive-flow">
      {error && <p role="alert">{error}</p>}
      {s.stage === 'prompt' && <Text text={s.activeStep.prompt} empty="Prompt tohoto kroku je prázdný." />}
      {s.stage === 'design' && <>
        {p.figma && <p>Figma: <a href={p.figma.url} target="_blank" rel="noreferrer">Otevřít zdrojový soubor</a> · synchronizováno {new Date(p.figma.syncedAt).toLocaleString('cs-CZ')}</p>}
        {!p.screens.length && <p className="muted">V uloženém stavu není žádný design.</p>}
        {p.screens.map((screen) => <section className="archive-section" key={screen.id}><h3>{screen.name}</h3><p className="muted">{screen.width} × {screen.height}</p>{screen.image && <a href={`/api/projects/${p.id}/figma/${screen.image}`} target="_blank" rel="noreferrer"><img className="archive-design" src={`/api/projects/${p.id}/figma/${screen.image}`} alt={screen.name} /></a>}
          <details><summary>Vrstvy a poznámky ({screen.elements.length})</summary>{screen.elements.map((e) => <div className="archive-layer" key={e.id}><strong>{e.name}</strong> · {e.type}{e.work ? ' · Rozpracováno' : ''}<p>{e.text}</p>{e.note && <p>{e.note}</p>}<small>{e.storyIds.join(', ')} · {e.x}, {e.y} · {e.w} × {e.h}</small></div>)}</details>
        </section>)}
      </>}
      {s.stage === 'stories' && <><h3>Zadání session</h3><Text text={p.description} />{p.epics?.map((epic) => <section key={epic.id} className="archive-section"><h3>{epic.id} · {epic.title}</h3><Markdown text={epic.description} /></section>)}{!p.stories.length && <p className="muted">Bez user stories.</p>}{p.stories.map((st) => <section key={st.id} className="story-card"><div className="story-head"><span className="chip gray">{st.id}</span><strong>{st.title}</strong><span className="chip gray">{STORY_PRIORITY[st.priority].label} · {STORY_STATUS[st.status].label}</span></div><p>Jako <b>{st.asA}</b> chci <b>{st.iWant}</b>, abych <b>{st.soThat}</b>.</p>{st.description && <Markdown text={st.description} />}<ul>{st.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul><p className="muted">{st.screenIds.map((id) => p.screens.find((sc) => sc.id === id)?.name ?? id).join(', ')}</p></section>)}</>}
      {s.stage === 'build' && <>
        <div className="segmented"><button className={s.buildPart === 'blocks' ? 'active' : ''} onClick={() => s.setBuildPart('blocks')}>1 · Bloky</button><button className={s.buildPart === 'plan' ? 'active' : ''} onClick={() => s.setBuildPart('plan')}>2 · Implementace</button></div>
        {s.buildPart === 'blocks' ? <>{p.architecture ? <><h3>Architektura</h3><p>{p.architecture.summary}</p><dl>{Object.entries(p.architecture.stack).map(([key, value]) => <div key={key}><dt>{{ frontend: 'Frontend', backend: 'Backend', database: 'Databáze', reason: 'Zdůvodnění' }[key]}</dt><dd>{value}</dd></div>)}</dl>{p.architecture.diagrams.map((d) => <section key={d.id} className="archive-section"><h3>{d.title}</h3><p>{d.description}</p><Mermaid source={d.mermaid} /><details><summary>Zdroj diagramu</summary><pre className="archive-pre">{d.mermaid}</pre></details><dl>{d.steps.map((step, i) => <div key={i}><dt>{step.name}</dt><dd>{step.description}</dd></div>)}</dl><p className="muted">{d.storyIds.join(', ')}</p></section>)}</> : <p className="muted">Architektura nebyla připravena.</p>}</> : <><h3>Implementační prompt</h3><Text text={p.buildPlan?.prompt} /><h3>Plán změn</h3>{p.buildPlan?.changes.map((c, i) => <p key={i}><b>{c.path}</b> · {{ create: 'Nový soubor', modify: 'Úprava', delete: 'Odstranění' }[c.action]}<br />{c.reason}</p>)}<h3>Log buildu</h3><pre className="archive-pre">{record?.events.filter((e) => e.channel === 'build').map((e) => e.text).join('\n') || 'Bez uloženého logu.'}</pre></>}
        {pipeline && <details><summary>Pipeline · {pipeline.status}</summary><p>{pipeline.goal}</p><p>{pipeline.summary}</p>{pipeline.tasks.map((t) => <section key={t.id}><h4>{t.id} · {t.title} · {t.status}</h4><Text text={t.instruction} /><p>{t.note}</p></section>)}</details>}
        {!!record?.runs.length && <details><summary>Běhy agentů a spotřeba ({record.runs.length})</summary><AgentRuns runs={record.runs} projectId={p.session?.snapshot?.sessionId ?? p.id} /></details>}
      </>}
      {s.stage === 'preview' && <><h3>Uložený stav náhledu</h3><p>{record?.capturedAt && new Date(record.capturedAt).toLocaleString('cs-CZ')} · {record ? STATE_LABEL[record.preview.state] : 'Bez záznamu'}</p><p className="muted">Archiv uchovává stav a log náhledu, anotace a dostupné snímky z testů. Živý iframe ani proces kontejneru se nearchivují.</p><pre className="archive-pre">{record?.preview.log || 'Bez uloženého logu náhledu.'}</pre><h3>Anotace</h3>{p.annotations.map((a) => <section key={a.id} className="archive-section"><strong>{a.route} · {a.target}</strong><p>{a.text}</p><Text text={a.comment} /><small>{a.status} · {new Date(a.createdAt).toLocaleString('cs-CZ')}</small></section>)}{p.testReport?.cases.flatMap((c) => c.screenshots.map((path) => <img className="archive-design" key={`${c.title}-${path}`} src={`/api/projects/${p.id}/raw?path=${encodeURIComponent(path)}`} alt={`Uložený test: ${c.title}`} />))}</>}
      {s.stage === 'tests' && <><h3>Výsledky testů</h3>{p.testReport ? <><p>{p.testReport.ok ? 'Testy prošly' : 'Testy neprošly'} · {new Date(p.testReport.finishedAt).toLocaleString('cs-CZ')}</p>{p.testReport.cases.map((c, i) => <section key={i} className="archive-section"><strong>{c.title}</strong><p>{TEST_STATUS[c.status].label} · {c.durationMs} ms · {c.storyIds.join(', ')}</p>{c.error && <pre className="archive-pre">{c.error}</pre>}{c.screenshots.map((path) => <a key={path} href={`/api/projects/${p.id}/raw?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer"><img className="archive-design" src={`/api/projects/${p.id}/raw?path=${encodeURIComponent(path)}`} alt={c.title} /></a>)}</section>)}<details><summary>Log testů</summary><pre className="archive-pre">{p.testReport.log}</pre></details></> : <p className="muted">Žádné uložené výsledky testů.</p>}<h3>Průchody aplikací</h3>{p.walkthroughs?.map((w) => <section className="archive-section" key={w.id}><h4>{w.route} · {w.section}</h4><p>{w.instructions}</p><p>{w.script} · {w.status} · {w.storyIds.join(', ')}</p>{w.error && <p>{w.error}</p>}{w.video && <video controls preload="metadata" src={`/api/projects/${p.id}/walkthroughs/${w.video}`} />}</section>)}</>}
    </div>
  </>
}

export const ArchivedAgent = () => {
  const s = useStudio()
  return <div className="agent-log archive-chat"><h3>Uložená konverzace</h3>{!s.chat.length && <p className="muted">Bez konverzace.</p>}{s.chat.map((m) => <section key={m.id} className={`msg ${m.role}`}><small>{m.role === 'user' ? 'Uživatel' : 'Agent'} · {new Date(m.createdAt).toLocaleString('cs-CZ')}</small><Markdown text={m.text} />{m.conflicts.map((c) => <p key={c.id}>{c.severity} · {c.message} · {c.refs.join(', ')}</p>)}{m.proposals.map((p) => <details key={p.id}><summary>{p.title} · {p.status}</summary><p>{p.rationale}</p><pre className="archive-pre">{JSON.stringify(p.ops, null, 2)}</pre></details>)}</section>)}</div>
}

export const ArchivedActivity = () => {
  const s = useStudio()
  const [record, setRecord] = useState<Record>()
  const [error, setError] = useState('')
  useEffect(() => { void api<Record>(`/projects/${s.project.id}/session-record`).then(setRecord).catch((e: Error) => setError(e.message)) }, [s.project.id])
  return <><div className="pane-bar"><h2>Uložená aktivita a běhy</h2><span className="chip gray">Pouze pro čtení</span></div><div className="pane-scroll archive-flow">{error && <p role="alert">{error}</p>}{record && <><AgentRuns runs={record.runs} projectId={s.project.session?.snapshot?.sessionId ?? s.project.id} /><h3>Časová osa</h3>{record.events.map((event, i) => <details key={i} className="session-event"><summary>{new Date(event.at).toLocaleString('cs-CZ')} · {event.text.slice(0, 100) || 'Aktualizace stavu'}</summary><pre className="archive-pre">{event.text}</pre></details>)}</>}</div></>
}
