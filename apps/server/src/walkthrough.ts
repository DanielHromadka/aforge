// Walkthroughs: the implementing agent writes a Playwright script that clicks through one section of the app,
// then it runs against the preview container like the e2e suite and the video is kept in the project data dir.
// The server owns `project.walkthroughs` (the client's autosave never overwrites them).
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { nextKeys, workflowOf, type BuildEvent, type Issue, type Walkthrough } from '@aforge/shared'
import { structured } from './agents.js'
import { buildContext } from './context.js'
import { generate, isGenerating } from './generate.js'
import { exclusive, isBuilding, runAgent } from './build.js'
import { publish } from './events.js'
import { hub } from './hub.js'
import { ensurePreviewRunning } from './preview.js'
import { listWorkingSessions, loadProject, mutateProject, projectDir, saveProject, workspaceDir } from './store.js'
import { playwrightInContainer, testsRunning } from './tests.js'
import { CURSOR_HELPER, WALKTHROUGH_CONFIG, WALKTHROUGH_DIR, cursorHelper, parseWalkthroughReport, scriptSlug, testScriptsPrompt, walkthroughConfig, walkthroughPrompt, walkthroughSlug } from './walkthrough-lib.js'
import { commit, ensureRepo, writeText } from './workspace.js'

const jobs = new Set<string>()
const planning = new Set<string>()
export const isPlanningTests = (projectId: string) => planning.has(projectId)
const BUSY: Walkthrough['status'][] = ['generating', 'recording']

export const videoDir = (projectId: string) => join(projectDir(projectId), 'walkthroughs')

const say = (projectId: string, id: string, kind: string, text: string) => publish(projectId, 'walkthrough', kind, text, { id })

/** Changes one walkthrough (null removes it) on the latest model – jobs run long, the model moves meanwhile. */
const patch = async (projectId: string, id: string, fn: (w: Walkthrough) => Walkthrough | null) => {
  let next: Walkthrough | null = null
  await mutateProject(projectId, (p) => {
    const list = p.walkthroughs ?? []
    const current = list.find((w) => w.id === id)
    if (!current) throw new Error('Průchod neexistuje')
    next = fn(current)
    const done = next
    return { ...p, walkthroughs: done ? list.map((w) => (w.id === id ? { ...done, updatedAt: new Date().toISOString() } : w)) : list.filter((w) => w.id !== id) }
  })
  publish(projectId, 'project', 'changed', '')
  return next
}

const find = async (projectId: string, id: string) => {
  const w = (await loadProject(projectId)).walkthroughs?.find((x) => x.id === id)
  if (!w) throw new Error('Průchod neexistuje')
  if (jobs.has(id)) throw new Error('Průchod právě běží')
  return w
}

/** The config and cursor helper are ours; rewriting them each time undoes accidental edits. */
const writeSupport = async (projectId: string) => {
  await writeText(projectId, WALKTHROUGH_CONFIG, walkthroughConfig)
  await writeText(projectId, CURSOR_HELPER, cursorHelper)
}

export const createWalkthrough = async (
  projectId: string,
  input: { route?: string; section?: string; storyIds?: string[]; instructions?: string; title?: string; kind?: Walkthrough['kind'] },
): Promise<Walkthrough> => {
  const route = String(input.route ?? '').trim()
  const section = String(input.section ?? '').trim()
  if (!/^\/\S*$/.test(route) || route.length > 300) throw new Error('Route musí začínat lomítkem, např. /rezervace')
  if (!section || section.length > 500) throw new Error('Popište sekci (CSS selektor nebo slovní popis)')
  const p = await loadProject(projectId)
  const list = p.walkthroughs ?? []
  const known = new Set(p.stories.map((s) => s.id))
  const title = String(input.title ?? '').trim().slice(0, 200) || undefined
  const slug = walkthroughSlug(route, title ?? section, list.map((w) => scriptSlug(w.script) ?? ''))
  const now = new Date().toISOString()
  const w: Walkthrough = {
    id: `wt-${randomUUID().slice(0, 8)}`,
    kind: input.kind === 'walkthrough' ? 'walkthrough' : 'test',
    ...(title ? { title } : {}),
    route,
    section,
    storyIds: (input.storyIds ?? []).filter((id) => known.has(id)),
    instructions: String(input.instructions ?? '').slice(0, 2000),
    script: `${WALKTHROUGH_DIR}/${slug}.spec.ts`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  await saveProject({ ...p, walkthroughs: [...list, w] })
  publish(projectId, 'project', 'changed', '')
  return w
}

/** Has the agent write the script (under the build lock), then records it, starting the preview if needed. */
export const generateWalkthrough = async (projectId: string, id: string): Promise<{ done: Promise<boolean> }> => {
  const w = await find(projectId, id)
  const project = await loadProject(projectId)
  const agent = project.stack.agent
  const done = exclusive(projectId, 'Právě běží build nebo jiné generování', async (setKill) => {
    jobs.add(id)
    try {
      await patch(projectId, id, (x) => ({ ...x, status: 'generating', error: undefined }))
      await ensureRepo(projectId)
      await writeSupport(projectId)
      await commit(projectId, 'Reactor: podklady pro průchod aplikací')
      say(projectId, id, 'start', `${agent === 'codex' ? 'Codex' : 'Claude Code'} píše skript ${w.script} ${hub.mode() === 'remote' ? 'na vzdáleném workeru' : 'lokálně'}…`)
      const onEvent = (e: BuildEvent) => say(projectId, id, e.kind, e.text)
      const prompt = w.kind === 'test' ? testScriptsPrompt([w], project) : walkthroughPrompt(w, project)
      const ok = await runAgent(projectId, { agent, prompt, message: `Reactor: průchod ${w.script}`, onEvent, setKill, role: 'tester' })
      await commit(projectId, `Reactor: průchod ${w.script}`)
      const written = existsSync(join(workspaceDir(projectId), w.script))
      const error = !ok ? 'Agent skript nedokončil.' : !written ? `Agent nevytvořil ${w.script}.` : undefined
      await patch(projectId, id, (x) => ({ ...x, status: error ? 'failed' : 'ready', error }))
      say(projectId, id, error ? 'error' : 'done', error ?? 'Skript je připravený.')
      return !error
    } finally {
      jobs.delete(id)
    }
  }).catch(async (e: Error) => {
    await patch(projectId, id, (x) => ({ ...x, status: 'failed', error: e.message })).catch(() => {})
    say(projectId, id, 'error', e.message)
    return false
  })
  return {
    done: done.then(async (ok) => (ok ? (await recordWalkthrough(projectId, id)).done : ok)),
  }
}

/** Runs the script in the Playwright container against the preview and keeps the video. */
export const recordWalkthrough = async (projectId: string, id: string): Promise<{ done: Promise<boolean> }> => {
  const w = await find(projectId, id)
  const slug = scriptSlug(w.script)
  const ws = workspaceDir(projectId)
  if (!slug) throw new Error('Neplatná cesta skriptu')
  if (!existsSync(join(ws, w.script))) throw new Error('Skript zatím neexistuje – nejdřív ho vygenerujte.')
  if (!existsSync(join(ws, 'e2e/package.json'))) throw new Error('Chybí e2e/package.json – nejdřív proběhne build s testy.')
  // Both would `npm install` in e2e/ at once, and a build may be rewriting the script.
  if (testsRunning(projectId)) throw new Error('Počkejte, až doběhnou testy.')
  if (isBuilding(projectId)) throw new Error('Počkejte, až doběhne build.')
  jobs.add(id)
  const run = async (): Promise<boolean> => {
    await patch(projectId, id, (x) => ({ ...x, status: 'recording', error: undefined }))
    await ensurePreviewRunning(projectId, (text) => say(projectId, id, 'start', text))
    await writeSupport(projectId)
    await rm(join(ws, '.aforge/walkthrough-output'), { recursive: true, force: true })
    await rm(join(ws, '.aforge/walkthrough-results.json'), { force: true })
    say(projectId, id, 'start', `Nahrávám ${w.script} v Playwright kontejneru…`)
    let tail = ''
    const job = playwrightInContainer(
      projectId,
      `npx playwright test --config walkthrough.config.ts --reporter=json walkthroughs/${slug}.spec.ts > /workspace/.aforge/walkthrough-results.json`,
      (line) => {
        tail = (tail + line + '\n').slice(-4000)
        say(projectId, id, 'log', line)
      },
    )
    await job.done
    let result: ReturnType<typeof parseWalkthroughReport>
    try {
      result = parseWalkthroughReport(JSON.parse(await readFile(join(ws, '.aforge/walkthrough-results.json'), 'utf8')))
    } catch {
      result = { ok: false, error: `Výsledek běhu nejde přečíst.\n${tail.slice(-1500)}` }
    }
    let video: string | undefined
    if (result.video && existsSync(join(ws, result.video))) {
      await mkdir(videoDir(projectId), { recursive: true })
      video = `${id}.webm`
      await copyFile(join(ws, result.video), join(videoDir(projectId), video))
    }
    const error = result.ok ? (video ? undefined : 'Běh prošel, ale video se nevytvořilo.') : result.error
    const recordedAt = video ? new Date().toISOString() : undefined
    await patch(projectId, id, (x) => ({ ...x, status: error ? 'failed' : 'recorded', error, video: video ?? x.video, recordedAt: recordedAt ?? x.recordedAt }))
    say(projectId, id, error ? 'error' : 'done', error ? `${w.kind === 'test' ? 'Test' : 'Průchod'} selhal${video ? ' (video uloženo)' : ''}.` : w.kind === 'test' ? 'Test prošel.' : 'Video je nahrané.')
    if (w.kind === 'test') await afterTest(projectId, id, !error, error)
    return !error
  }
  const done = run()
    .catch(async (e: Error) => {
      await patch(projectId, id, (x) => ({ ...x, status: 'failed', error: e.message })).catch(() => {})
      say(projectId, id, 'error', e.message)
      return false
    })
    .finally(() => jobs.delete(id))
  return { done }
}

/** One action for the user: write the script when there is none yet, then record the video. */
export const testWalkthrough = async (projectId: string, id: string) => {
  const w = await find(projectId, id)
  return existsSync(join(workspaceDir(projectId), w.script)) ? recordWalkthrough(projectId, id) : generateWalkthrough(projectId, id)
}

/** After a restart no job is running, so statuses left at generating/recording are stale. */
export const recoverWalkthroughs = async () => {
  for (const { id } of await listWorkingSessions()) {
    const p = await loadProject(id)
    if (!p.walkthroughs?.some((w) => BUSY.includes(w.status))) continue
    await saveProject({
      ...p,
      walkthroughs: p.walkthroughs.map((w) => (BUSY.includes(w.status) ? { ...w, status: 'failed', error: 'Přerušeno restartem serveru.' } : w)),
    })
  }
}

// ---- tests: designed from the stories, written in one run per story, run in bulk -----------------------

const PlanSchema = z.object({
  tests: z.array(z.object({
    storyId: z.string(),
    title: z.string().describe('What the test checks, short, in Czech'),
    route: z.string().describe('App route to open, starting with /'),
    section: z.string().describe('The part of the page: a CSS selector or a plain description'),
    instructions: z.string().describe('The scenario step by step and the expected result to verify, in Czech'),
  })),
})

const TESTER = `Jsi Tester v týmu Reactor. Ke každé story navrhneš automatické testy běžící aplikace: typicky jeden test na
akceptační kritérium, blízká kritéria smíš spojit. Každý test má název (co ověřuje), stránku (route od /), sekci
stránky a pokyny: scénář krok za krokem s konkrétními daty a očekávaný výsledek, který se ověří. Vycházej ze
zdrojáku aplikace a designu, ať route a sekce sedí. Existující testy story neopakuj. Piš česky.`

/** The Tester designs the tests of the stories; they are created without scripts yet. */
const planTests = async (projectId: string, storyIds: string[]) => {
  const project = await loadProject(projectId)
  const stories = project.stories.filter((s) => storyIds.includes(s.id))
  const existing = (project.walkthroughs ?? []).filter((w) => w.storyIds.some((id) => storyIds.includes(id)))
  const context = await buildContext(project, { stage: 'tests' }, [])
  const prompt = `${context}\n\n<stories_k_testum>\n${stories.map((s) => `${s.id}: ${s.title}\n${s.acceptance.map((a) => `- ${a}`).join('\n')}`).join('\n\n')}\n</stories_k_testum>\n\n<existujici_testy>\n${existing.map((w) => `${w.storyIds.join(',')}: ${w.title ?? w.section}`).join('\n') || '(žádné)'}\n</existujici_testy>`
  const plan = await structured(PlanSchema, TESTER, prompt, { projectId, projectName: project.name, step: `Návrh testů · ${storyIds.join(', ')}`, role: 'tester' })
  const created: Walkthrough[] = []
  for (const t of plan.tests.filter((x) => storyIds.includes(x.storyId))) {
    const route = t.route.startsWith('/') ? t.route : `/${t.route}`
    created.push(await createWalkthrough(projectId, { kind: 'test', title: t.title, route, section: t.section || t.title, instructions: t.instructions, storyIds: [t.storyId] }))
  }
  return created
}

/** One agent run writes the scripts of several tests. */
const writeScripts = (projectId: string, tests: Walkthrough[]) =>
  exclusive(projectId, 'Právě běží build nebo jiné generování', async (setKill) => {
    const project = await loadProject(projectId)
    for (const w of tests) { jobs.add(w.id); await patch(projectId, w.id, (x) => ({ ...x, status: 'generating', error: undefined })) }
    try {
      await ensureRepo(projectId)
      await writeSupport(projectId)
      await commit(projectId, 'Reactor: podklady pro testy')
      const onEvent = (e: BuildEvent) => tests.forEach((w) => say(projectId, w.id, e.kind, e.text))
      const ok = await runAgent(projectId, { agent: project.stack.agent, prompt: testScriptsPrompt(tests, project), message: `Reactor: testy ${tests.map((w) => w.storyIds[0]).filter(Boolean).join(', ')}`, step: `Psaní testů · ${tests.length}`, role: 'tester', onEvent, setKill })
      await commit(projectId, 'Reactor: skripty testů')
      for (const w of tests) {
        const error = existsSync(join(workspaceDir(projectId), w.script)) ? undefined : ok ? `Agent nevytvořil ${w.script}.` : 'Agent skripty nedokončil.'
        await patch(projectId, w.id, (x) => ({ ...x, status: error ? 'failed' : 'ready', error }))
      }
    } finally {
      tests.forEach((w) => jobs.delete(w.id))
    }
  })

/** A failing test files a bug under its story; a story is verified when all its tests pass. */
const afterTest = (projectId: string, id: string, passed: boolean, error?: string) =>
  mutateProject(projectId, (p) => {
    const w = p.walkthroughs?.find((x) => x.id === id)
    if (!w) return p
    const now = new Date().toISOString()
    const storyId = w.storyIds[0]
    const key = `test:${w.id}`
    let issues = (p.issues ?? []).map((i): Issue => (i.testTitle === key && i.status !== 'done' && passed ? { ...i, status: 'done', updatedAt: now } : i))
    if (!passed && !issues.some((i) => i.testTitle === key && i.status !== 'done')) {
      const work = issues.find((i) => i.storyId === storyId && i.type === 'task' && (i.layer === 'fe' || i.layer === 'be'))
      issues = [...issues, {
        id: nextKeys({ ...p, issues })[0]!, type: 'bug', storyId, title: `Selhal test: ${w.title ?? w.section}`.slice(0, 140), description: (error ?? 'Test selhal.').slice(0, 3000),
        layer: work?.layer ?? 'fe', repoId: work?.repoId ?? 'main', status: 'todo', source: 'test', testTitle: key, files: [], createdAt: now, updatedAt: now,
      }]
    }
    const tests = (p.walkthroughs ?? []).filter((x) => x.kind === 'test' && x.storyIds.includes(storyId ?? ''))
    const allPassed = tests.length > 0 && tests.every((x) => x.status === 'recorded')
    const stories = p.stories.map((s) => (s.id !== storyId ? s : allPassed ? { ...s, status: 'verified' as const } : !passed && s.status === 'verified' ? { ...s, status: 'implemented' as const } : s))
    return { ...p, issues, stories }
  })

/** Runs the given tests one after another; the writer then updates the wiki if a story got verified. */
export const runTestItems = async (projectId: string, ids: string[]) => {
  for (const id of ids) {
    // A test without a script gets one written first; testWalkthrough then records it.
    const run = await testWalkthrough(projectId, id).catch((e: Error) => { say(projectId, id, 'error', e.message); return null })
    await run?.done
  }
  const p = await loadProject(projectId)
  if (p.stories.some((s) => s.status === 'verified') && workflowOf(p).steps.some((s) => s.kind === 'wiki') && !isGenerating(projectId))
    void generate(projectId, 'wiki').catch((e: Error) => publish(projectId, 'generate', 'error', e.message))
}

/** For each story: the Tester designs its tests, writes their scripts in one run, and they run right away. */
export const generateStoryTests = async (projectId: string, storyIds: string[]) => {
  if (planning.has(projectId)) throw new Error('Tester už připravuje testy tohoto projektu.')
  planning.add(projectId)
  try {
  for (const storyId of storyIds) {
    publish(projectId, 'walkthrough', 'plan', `Tester navrhuje testy ${storyId}…`, { storyId })
    try {
      const tests = await planTests(projectId, [storyId])
      publish(projectId, 'walkthrough', 'planned', `${storyId}: ${tests.length} testů`, { storyId })
      if (!tests.length) continue
      await writeScripts(projectId, tests)
      const ready = ((await loadProject(projectId)).walkthroughs ?? []).filter((w) => tests.some((t) => t.id === w.id) && w.status === 'ready')
      await runTestItems(projectId, ready.map((w) => w.id))
    } catch (e) {
      publish(projectId, 'walkthrough', 'planned', (e as Error).message, { storyId, error: true })
    }
  }
  } finally { planning.delete(projectId) }
}
