// The project at a glance: how stories move through the steps, what waits for the user and who of the team
// is working on what.
import { STORY_STAGES, type Stage } from '@aforge/shared'
import { useStudio } from '../studio'
import { useHub } from '../components/Workers'
import { Composer } from '../components/AgentPanel'
import { StatusIcon, Tile, TypeIcon, type Shape, type TypeName } from '../components/Glyphs'
import { openBugs, projectRuns, stageOf, STORY_STAGE_UI, TeamList } from '../components/Work'

interface Attention { key: string; shape: Shape; type?: TypeName; title: string; detail: string; action: string; go: () => void }

export const OverviewStage = () => {
  const s = useStudio()
  const p = s.project
  const { hub } = useHub()
  const runs = hub ? projectRuns(hub.runs, p) : []
  const go = (stage: Stage, storyId?: string) => { s.setFocus({ ...s.focus, storyId }); s.setStage(stage) }
  const counts = STORY_STAGES.map((st) => [st, p.stories.filter((x) => stageOf(p, x) === st).length] as const)
  const bugs = openBugs(p)

  const attention: Attention[] = [
    ...p.stories.filter((x) => stageOf(p, x) === 'split').map((x): Attention => ({
      key: `split-${x.id}`, shape: 'wait', type: 'story', title: `${x.id} ${x.title}`, detail: 'rozpad ke schválení', action: 'Projít', go: () => go('split', x.id),
    })),
    ...(p.contract?.status === 'proposed' ? [{ key: 'contract', shape: 'wait' as const, title: 'API kontrakt', detail: 'změna ke schválení', action: 'Projít', go: () => go('split') }] : []),
    ...(p.issues ?? []).filter((i) => i.status === 'review').map((i): Attention => ({
      key: i.id, shape: 'wait', type: i.type, title: `${i.id} ${i.title}`, detail: 'hotovo, čeká na revizi', action: 'Revize', go: () => { s.setFocus({ ...s.focus, issueId: i.id }); s.setStage('build') },
    })),
    ...bugs.filter((b) => b.status === 'todo' || b.status === 'failed').map((b): Attention => ({
      key: b.id, shape: 'err', type: 'bug', title: `${b.id} ${b.title}`, detail: b.source === 'test' ? 'bug ze selhaného testu' : b.source === 'annotation' ? 'bug z anotace v náhledu' : 'bug', action: 'Otevřít', go: () => go('stories', b.storyId),
    })),
    ...(p.wiki ?? []).filter((w) => w.draft).map((w): Attention => ({
      key: `wiki-${w.id}`, shape: 'wait', title: `Wiki: ${w.draft!.title}`, detail: 'změny ke schválení', action: 'Projít', go: () => go('wiki'),
    })),
  ]

  return (
    <div className="overview">
      <section className="card-pane">
        <h3>Průchod stories <span className="muted">{(p.epics ?? []).length} epiků · {p.stories.length} stories · {bugs.length} bugů</span></h3>
        <div className="flow-counts">
          {counts.map(([st, n]) => {
            const ui = STORY_STAGE_UI[st]
            return (
              <div key={st} className="flow-count">
                <span className="row-gap"><Tile glyph={ui.glyph} tone={ui.tone} />{ui.label}</span>
                <span className="big num">{n}</span>
                <span className="bar"><i style={{ width: `${p.stories.length ? (n / p.stories.length) * 100 : 0}%`, background: ui.tone }} /></span>
              </div>
            )
          })}
        </div>
        <h3>Čeká na vás {attention.length > 0 && <span className="muted">{attention.length}</span>}</h3>
        <div className="attention">
          {!attention.length && <div className="muted empty-line">{p.stories.length ? 'Nic nečeká.' : 'Projekt je prázdný. Začněte designem nebo stories.'}</div>}
          {attention.map((a) => (
            <div key={a.key} className="attention-row">
              <StatusIcon shape={a.shape} />
              {a.type && <TypeIcon type={a.type} />}
              <span className="grow ell"><b>{a.title}</b> <span className="muted">· {a.detail}</span></span>
              <button className="btn small" onClick={a.go}>{a.action}</button>
            </div>
          ))}
        </div>
      </section>
      <section className="card-pane team-pane">
        <h3>Tým</h3>
        <TeamList runs={runs} />
        <div className="grow" />
        {!s.readOnly && <Composer placeholder="Zeptat se týmu…" onSend={(text) => void s.askAgent({ text })} />}
      </section>
    </div>
  )
}
