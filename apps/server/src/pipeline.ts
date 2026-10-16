// Pipeline: an orchestrator agent (on a worker labelled "orchestrator", or locally) turns the whole
// project into a plan of phase tasks with dependencies; the hub then runs the plan, handing each task
// to a suitable worker. The orchestrator never talks to other workers itself – everything goes
// through the hub, and model changes still wait for a human unless auto-apply is on.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { PIPELINE_PHASES, type PipelinePhase, type PipelineRun, type PipelineTask, type Stage } from '@aforge/shared'
import { structured } from './agents.js'
import { startBuild, isBuilding } from './build.js'
import { askConsultant, decideProposal } from './chat.js'
import { buildContext } from './context.js'
import { publish } from './events.js'
import { previewStatus, startPreview } from './preview.js'
import { loadChat, loadProject, projectDir } from './store.js'
import { runTests } from './tests.js'
import { fileTree, flatPaths } from './workspace.js'

const PHASES = PIPELINE_PHASES
type Phase = PipelinePhase

export const PlanSchema = z.object({
  summary: z.string().describe('What the plan achieves, in Czech'),
  tasks: z.array(
    z.object({
      id: z.string().describe('Short id like t1'),
      phase: z.enum(PHASES),
      title: z.string(),
      instruction: z.string().describe('Precise, self-contained instruction for the agent doing this task, in Czech'),
      dependsOn: z.array(z.string()),
    }),
  ),
})
type Plan = z.infer<typeof PlanSchema>

const ORCHESTRATOR_SYSTEM = `Jsi orchestrátor vývoje v platformě aForge. Dostaneš celý projekt (stories, wireframy, bloky,
soubory, anotace, testy) a cíl. Sestav co nejkratší plán úloh, které cíl splní. Fáze úloh:
- stories: doplnit/upravit user stories a akceptační kritéria
- wireframes: navrhnout chybějící obrazovky a prvky
- blocks: převést stories a wireframy na model bloků a vazeb
- review: zkontrolovat konzistenci (stories × design × bloky × kód × testy) a navrhnout opravy
- build: implementace agentem v repozitáři (jedna úloha build pokryje celý kód; víc buildů jen když na sebe navazují)
- tests: spustit aplikaci v kontejneru a Playwright testy
Vynech fáze, které už jsou hotové a aktuální. Úlohy, které na sobě nezávisí, nech bez závislosti – poběží
paralelně na různých workerech. Instrukce piš konkrétně a samostatně (worker nevidí ostatní úlohy).`

const STAGE_OF: Record<Phase, Stage> = { stories: 'stories', wireframes: 'design', blocks: 'blocks', review: 'stories', build: 'build', tests: 'tests' }

const runs = new Map<string, { run: PipelineRun; cancelled: boolean }>()

const file = (projectId: string) => join(projectDir(projectId), 'pipeline.json')

export const loadPipeline = async (projectId: string): Promise<PipelineRun | null> => {
  const live = runs.get(projectId)
  if (live) return live.run
  try {
    return JSON.parse(await readFile(file(projectId), 'utf8')) as PipelineRun
  } catch {
    return null
  }
}

const persist = async (projectId: string, run: PipelineRun) => {
  await writeFile(file(projectId), JSON.stringify(run, null, 2))
  publish(projectId, 'pipeline', 'state', run.status, run)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const waitFor = async (check: () => boolean | Promise<boolean>, cancelled: () => boolean, everyMs = 2000) => {
  while (!(await check())) {
    if (cancelled()) throw new Error('Pipeline zrušena')
    await sleep(everyMs)
  }
}

const runTask = async (projectId: string, task: PipelineTask, run: PipelineRun, cancelled: () => boolean) => {
  if (task.phase === 'build') {
    const hasCode = flatPaths(await fileTree(projectId)).includes('.aforge/start.sh')
    await waitFor(() => !isBuilding(projectId), cancelled)
    const ok = await startBuild(projectId, hasCode ? 'incremental' : 'full').done
    if (!ok) throw new Error('Build se nepovedl')
    return
  }
  if (task.phase === 'tests') {
    // Always a fresh container: an earlier build task has usually changed the code since it started.
    await startPreview(projectId)
    if (previewStatus(projectId).state !== 'running') throw new Error(previewStatus(projectId).message ?? 'Aplikace nenaběhla')
    const report = await (await runTests(projectId)).done
    const note = `${report.cases.filter((c) => c.status === 'passed').length}/${report.cases.length} testů prošlo`
    if (!report.ok) throw new Error(note)
    task.note = note
    return
  }
  const [, reply] = await askConsultant(projectId, `[Pipeline · ${task.title}]\n${task.instruction}`, { stage: STAGE_OF[task.phase] })
  if (!reply.proposals.length) return
  if (run.autoApply) {
    // Only model changes are applied automatically; code edits always wait for a person.
    for (const p of reply.proposals) if (!p.ops.some((o) => o.type === 'file.write' || o.type === 'file.delete')) await decideProposal(projectId, reply.id, p.id, true)
    publish(projectId, 'project', 'changed', '')
  }
  const pending = async () => !(await loadChat(projectId)).find((m) => m.id === reply.id)?.proposals.some((p) => p.status === 'pending')
  if (!(await pending())) return
  task.status = 'awaiting'
  task.note = 'Čeká na schválení návrhů v panelu Agent'
  await persist(projectId, run)
  await waitFor(pending, cancelled, 3000)
  task.note = undefined
}

export const startPipeline = async (projectId: string, goal: string, autoApply: boolean) => {
  if (runs.has(projectId)) throw new Error('Pipeline už běží')
  const run: PipelineRun = { id: `run-${Date.now()}`, status: 'planning', goal, summary: '', autoApply, startedAt: new Date().toISOString(), tasks: [] }
  const state = { run, cancelled: false }
  runs.set(projectId, state)
  await persist(projectId, run)
  void (async () => {
    try {
      const project = await loadProject(projectId)
      const context = await buildContext(project, { stage: 'stories' }, [])
      const plan: Plan = await structured(PlanSchema, ORCHESTRATOR_SYSTEM, `${context}\n\n<goal>\n${goal}\n</goal>`, { labels: ['orchestrator'] })
      const ids = new Set(plan.tasks.map((t) => t.id))
      run.summary = plan.summary
      run.tasks = plan.tasks.map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => ids.has(d) && d !== t.id), status: 'pending' }))
      run.status = 'running'
      await persist(projectId, run)

      const active = new Map<string, Promise<void>>()
      // Build and tests use the one workspace and container: never two of them at once.
      const exclusive = (t: PipelineTask) => t.phase === 'build' || t.phase === 'tests'
      for (;;) {
        if (state.cancelled) throw new Error('cancelled')
        for (const t of run.tasks) {
          if (t.status !== 'pending') continue
          const deps = t.dependsOn.map((d) => run.tasks.find((x) => x.id === d)!)
          if (deps.some((d) => d.status === 'failed' || d.status === 'skipped')) {
            t.status = 'skipped'
            t.note = 'Závislost se nepovedla'
            continue
          }
          if (!deps.every((d) => d.status === 'done')) continue
          if (exclusive(t) && run.tasks.some((x) => exclusive(x) && (x.status === 'running' || x.status === 'awaiting'))) continue
          t.status = 'running'
          active.set(
            t.id,
            runTask(projectId, t, run, () => state.cancelled)
              .then(() => void (t.status = 'done'))
              .catch((e: Error) => {
                t.status = 'failed'
                t.note = e.message
              })
              .finally(() => {
                active.delete(t.id)
                void persist(projectId, run)
              }),
          )
        }
        await persist(projectId, run)
        if (!active.size) break
        await Promise.race(active.values())
      }
      run.status = run.tasks.some((t) => t.status === 'failed') ? 'failed' : 'done'
    } catch (e) {
      run.status = state.cancelled ? 'cancelled' : 'failed'
      if (!state.cancelled) run.summary = run.summary || (e as Error).message
      for (const t of run.tasks) if (t.status === 'pending' || t.status === 'running' || t.status === 'awaiting') t.status = 'skipped'
    } finally {
      run.finishedAt = new Date().toISOString()
      runs.delete(projectId)
      await persist(projectId, run)
    }
  })()
  return run
}

export const cancelPipeline = (projectId: string) => {
  const state = runs.get(projectId)
  if (state) state.cancelled = true
}
