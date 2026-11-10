// Build: turns the project model into AFORGE_SPEC.md, hands it to Claude Code or Codex – in a local
// repository of the project, or on a remote worker that gets a git bundle and sends its new commits back –
// and commits the result. One agent per repository at a time, so the repositories of a project run in parallel.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeAttachments, attachmentWorkspacePath, markdownForAgents, sectionPromptsOf, workflowInstructions, designOutline, elementDepths, reposOf, LAYER_LABEL, PLATFORM_LABEL, type AgentRole, type Architecture, type BuildEvent, type DesignElement, type Issue, type Project } from '@aforge/shared'
import { applyBundle, createBundle, headOf, implement, run } from '@aforge/runner'
import { publish } from './events.js'
import { hub } from './hub.js'
import { PLAYWRIGHT_VERSION } from './tests.js'
import { commit, ensureRepo, fileTree, flatPaths, writeText, safePath } from './workspace.js'
import { RUNTIME } from './context.js'
import { agentRuns } from './agent-runs.js'
import { saveProject, loadProject, projectDir } from './store.js'
import { repoDir } from './project-locations.js'
import { stageAttachments } from './attachments.js'

/** Running agents by project and repository. */
const running = new Map<string, () => void>()
const runKey = (projectId: string, repo = 'main') => `${projectId}\u0000${repo}`
const projectOf = (key: string) => key.split('\u0000')[0]

/** The part of the spec that is one task: what this agent does, in which repository. */
export const renderTask = (p: Project, issue: Issue): string => {
  const story = p.stories.find((s) => s.id === issue.storyId)
  const repo = reposOf(p).find((r) => r.id === issue.repoId)
  return `
## Tvůj task: ${issue.id} ${issue.title}
Typ: ${issue.type === 'bug' ? 'bug' : 'task'} · vrstva: ${LAYER_LABEL[issue.layer]} · repozitář: ${repo?.name ?? issue.repoId} (${repo ? PLATFORM_LABEL[repo.platform] : ''})
${story ? `Story: ${story.id} ${story.title}\n${markdownForAgents(p, story.description ?? '')}\n${story.acceptance.map((a) => `- [ ] ${a}`).join('\n')}\n` : ''}
${issue.description}
${issue.testTitle ? `\nSelhaný test: ${issue.testTitle}\n` : ''}${issue.feedback ? `\n### Připomínky z revize (zapracuj)\n${issue.feedback}\n` : ''}
Pracuj jen na tomto tasku a jen v tomto repozitáři. Ostatní tasky dělají jiní agenti souběžně.
${p.contract?.status === 'approved' ? 'API kontrakt je v contract/openapi.yaml – drž se ho přesně; klient do hotového backendu volá mock z kontraktu.\n' : ''}`
}

export const renderSpec = (p: Project, mode: 'full' | 'incremental'): string => {
  const line = (e: DesignElement) =>
    `**${e.kind}** „${e.text ?? e.name}“ (${e.type}) @ ${e.x},${e.y} ${e.w}×${e.h}` +
    (e.storyIds.length ? ` – ${e.storyIds.join(', ')}` : '') +
    (e.note ? ` – _${e.note}_` : '') +
    (e.work ? ' – **rozpracováno**' : '')
  const screens = p.screens
    .map((s) => {
      const depths = elementDepths(s)
      const outline = designOutline(s, 3, 400)
      return (
        `### ${s.name} (\`${s.id}\`, ${s.width}×${s.height})\n` +
        (s.image ? `Vzhled: \`.aforge/design/${s.image}\`\n\n` : '') +
        (outline.length ? outline.map((e) => `${'  '.repeat(depths.get(e.id) ?? 0)}- ${line(e)}`).join('\n') : '_prázdný rámec_')
      )
    })
    .join('\n\n')
  const work = p.screens.flatMap((s) => s.elements.filter((e) => e.work).map((e) => `- ${s.name} › ${line(e)} (\`${e.id}\`)`))
  const epics = new Map((p.epics ?? []).map((e) => [e.id, e]))
  const repos = reposOf(p)
  const stories = p.stories
    .map(
      (s) =>
        `### ${s.id}: ${s.title} [${s.priority}]${s.epicId && epics.has(s.epicId) ? ` · epic ${s.epicId} ${epics.get(s.epicId)!.title}` : ''}\nJako **${s.asA}** chci **${s.iWant}**, abych **${s.soThat}**.\n` +
        (s.screenIds.length ? `Obrazovky: ${s.screenIds.join(', ')}\n` : '') +
        markdownForAgents(p, s.description ?? '') + '\n' + s.acceptance.map((a) => `- [ ] ${a}`).join('\n'),
    )
    .join('\n\n')
  const arch = p.architecture
  const diagrams = (arch?.diagrams ?? [])
    .map(
      (d) =>
        `### ${d.title} (${d.type})\n${d.description}\n\n\`\`\`mermaid\n${d.mermaid}\n\`\`\`\n` +
        d.steps.map((st) => `- **${st.name}**: ${st.description}`).join('\n') +
        (d.storyIds.length ? `\n\nStories: ${d.storyIds.join(', ')}` : ''),
    )
    .join('\n\n')
  const plan = p.buildPlan
  const changes = plan?.changes.map((c) => `- \`${c.path}\` – ${{ create: 'vytvořit', modify: 'upravit', delete: 'smazat' }[c.action]}: ${c.reason}`).join('\n')
  const annotations = p.annotations.filter((a) => a.status !== 'resolved')
  const failing = p.testReport?.cases.filter((c) => c.status !== 'passed' && c.status !== 'skipped') ?? []
  return `# ${p.name} – implementační specifikace (generuje Reactor)

## Popisy epiců
${[...epics.values()].map((e) => `### ${e.id}: ${e.title}\n${markdownForAgents(p, e.description)}`).join('\n\n')}

## Přílohy zadání
${activeAttachments(p).map((a) => `- ${a.itemId}: ${a.name} → \`${attachmentWorkspacePath(a)}\` (${a.mime}, ${a.size} B)`).join('\n') || 'Bez příloh.'}

## Zadání projektu
${p.description || '_bez zadání_'}

## Pokyny kroků workflow (aktuální pokyny uživatele mají přednost před starším generovaným plánem)
${workflowInstructions(p) || '_bez doplňujících pokynů_'}

## Doplňující prompty sekcí
${Object.entries(sectionPromptsOf(p)).filter(([, text]) => text?.trim()).map(([section, text]) => `### ${section}\n${text}`).join('\n\n')}
${plan ? `\n## Implementační prompt (hlavní pokyn – řiď se jím)\n${plan.prompt}\n` : ''}${changes ? `\n## Plánované změny v kódu\n${changes}\n` : ''}
## Stack
${stackText(arch)}

## Repozitáře projektu
${repos.map((r) => `- \`${r.id}\` ${r.name} – ${PLATFORM_LABEL[r.platform]}${r.id === 'main' ? ' (hlavní, v náhledu /workspace)' : ` (v náhledu /repos/${r.id})`}`).join('\n')}

## Běhový kontrakt (povinné)
Reactor spouští aplikaci v kontejneru \`aforge-runtime\` (Ubuntu 24.04, Node 22, .NET 8 SDK, Python 3, Nginx).
Pracovní adresář je připojen do \`/workspace\`.

${repos.length > 1 ? `Projekt má více repozitářů. Hlavní je připojen do \`/workspace\`, ostatní do \`/repos/<id>\` (jen pro čtení).
Reactor nejdřív spustí \`.aforge/start.sh\` každého vedlejšího repozitáře na pozadí (backend tak běží na portu 5000,
zdroják si zkopíruje do \`/srv/<id>\`), pak start.sh hlavního repozitáře, který servíruje port 80. Repozitáře
platformy mobil, desktop a knihovna start.sh nemají – náhled pro ně zatím není.

` : ''}1. \`.aforge/start.sh\` (bash, spouští se jako root): zkopíruje zdroják z \`/workspace\` do \`/app\` (bez node_modules,
   bin, obj, dist – \`rsync -a --exclude …\`), nainstaluje závislosti, sestaví frontend a backend, spustí backend
   na portu **5000** na pozadí a nakonec Nginx v popředí (\`nginx -g 'daemon off;'\`) na portu **80**:
   \`/\` = statický build frontendu se SPA fallbackem, \`/api/\` = proxy na \`http://127.0.0.1:5000\`.
2. Konfigurace Nginx v \`.aforge/nginx.conf\`. Startovací skript ji před spuštěním Nginx zkopíruje
   do \`/etc/nginx/sites-available/default\`, aktivuje příkazem
   \`ln -sfn /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default\` a ověří \`nginx -t\`.
3. E2E testy v \`e2e/\`: vlastní \`package.json\` s \`@playwright/test@${PLAYWRIGHT_VERSION}\` (přesně tato verze),
   \`playwright.config.ts\` s \`baseURL: process.env.BASE_URL\`, \`screenshot: 'on'\`,
   \`outputDir: '../.aforge/test-output'\`, \`testIgnore: ['**/walkthroughs/**']\`, jen projekt chromium. Každý test
   má v názvu klíč story, např. \`test('[${p.key ?? 'US'}-3] uživatel se přihlásí', …)\`, a pokrývá její akceptační kritéria.
   Používej role/label lokátory. \`e2e/walkthroughs/\` a \`e2e/walkthrough.config.ts\` spravuje Reactor (videa
   průchodů aplikací) – neměň je a nedávej tam testy.
4. \`Dockerfile\` pro produkční nasazení v kontejneru a stručný \`README.md\` (lokální vývoj, build, nasazení).
5. Nezapisuj nic mimo pracovní adresář a neukládej žádné tajné klíče.

## User stories
${stories || '_zatím žádné_'}

## Design (z Figmy)
Každá obrazovka je rámec z Figmy, vnořený seznam jsou jeho vrstvy (souřadnice v px v rámci rámce).
Vzhled (barvy, typografie, rozestupy) převezmi z vyrenderovaných náhledů rámců v \`.aforge/design/\`,
strukturu a texty ze seznamu vrstev.

${screens || '_design zatím není synchronizovaný_'}
${work.length ? `\n## Rozpracované prvky (přednost v této iteraci)\n${work.join('\n')}\n` : ''}
## Architektura
${arch ? `${arch.summary}\n\n${diagrams}` : '_architektura zatím není navržená_'}
${
  mode === 'incremental' && annotations.length
    ? `\n## Otevřené anotace z náhledu (zapracuj)\n${annotations.map((a) => `- \`${a.target}\` na \`${a.route}\` („${a.text.slice(0, 80)}“): ${a.comment}`).join('\n')}\n`
    : ''
}${
  mode === 'incremental' && failing.length
    ? `\n## Neúspěšné testy z posledního běhu (oprav)\n${failing.map((c) => `- ${c.title}: ${(c.error ?? '').slice(0, 400)}`).join('\n')}\n`
    : ''
}`
}

const stackText = (arch?: Architecture) =>
  arch
    ? `- Frontend: ${arch.stack.frontend}\n- Backend: ${arch.stack.backend}\n- Databáze: ${arch.stack.database}\n\nDůvod: ${arch.stack.reason}`
    : `Stack nebyl určen: zvol nejjednodušší vhodný podle zadání; běhové prostředí je ${RUNTIME}.`

/** The workspace already holds an application, not just what Reactor writes into it. */
export const hasApp = async (projectId: string): Promise<boolean> =>
  flatPaths(await fileTree(projectId)).some((f) => !/^(\.aforge\/|\.git\/|AFORGE_SPEC\.md$|e2e\/walkthrough)/.test(f))

const PROMPT = {
  full: 'Implementuj kompletní aplikaci podle souboru AFORGE_SPEC.md v tomto adresáři – hlavní je sekce Implementační prompt a Plánované změny, architektura a design jsou podklad. Dodrž přesně běhový kontrakt (.aforge/start.sh, .aforge/nginx.conf, e2e/). Ověř, že se backend i frontend sestaví. Na konci stručně shrň, co jsi udělal a co zbývá.',
  incremental:
    'Aplikace v tomto adresáři už existuje. Aktualizuj ji podle AFORGE_SPEC.md – hlavní je sekce Implementační prompt a Plánované změny: dopracuj stories, které nejsou implementované, přednostně rozpracované prvky designu, zapracuj otevřené anotace a oprav neúspěšné testy. Neměň nesouvisející kód. Na konci stručně shrň změny.',
}

/** The rendered frames go into the repository, so the implementing agent can look at them. */
const copyDesign = async (project: Project, repo?: string) => {
  const target = safePath(project.id, '.aforge/design', repo)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const s of project.screens) {
    const source = s.image && join(projectDir(project.id), 'figma', s.image)
    if (source && existsSync(source)) await copyFile(source, join(target, s.image!))
  }
}

/**
 * Runs the implementing agent on the workspace – locally, or on a remote worker that gets a git bundle and
 * sends its new commits back – and resolves with whether it finished. `setKill` receives the way to stop it.
 */
export const runAgent = async (
  projectId: string,
  opts: { agent: Project['stack']['agent']; prompt: string; message: string; step?: string; repo?: string; role?: AgentRole; issueId?: string; onEvent: (e: BuildEvent) => void; setKill: (kill: () => void) => void },
): Promise<boolean> => {
  const cwd = repoDir(projectId, opts.repo)
  const { agent, prompt } = opts
  const project = await loadProject(projectId)
  if (project.attachments?.length) {
    await stageAttachments(project, opts.repo)
    const paths = activeAttachments(project).map(attachmentWorkspacePath)
    if (paths.length) {
      const added = await run('git', ['add', '-f', '--', ...paths], { cwd })
      if (added.code !== 0) throw new Error('Přílohy nelze připravit pro implementaci.')
    }
    await commit(projectId, 'Reactor: přílohy zadání', opts.repo)
  }
  const id = agentRuns.start({ projectId, projectName: project.name, step: opts.step ?? opts.message, role: opts.role ?? 'fe', issueId: opts.issueId }, agent, hub.mode() === 'remote' ? 'remote' : 'local')
  const onEvent = (e: BuildEvent) => { agentRuns.event(id, e); if (e.kind !== 'usage') opts.onEvent(e) }
  let cancelled = false
  if (hub.mode() !== 'remote') {
    try {
      const job = implement(agent, cwd, prompt, onEvent)
      opts.setKill(() => { cancelled = true; job.kill() })
      const ok = (await job.done) === 0
      agentRuns.finish(id, cancelled ? 'cancelled' : ok ? 'done' : 'failed')
      return ok && !cancelled
    } catch (e) { agentRuns.finish(id, 'failed', (e as Error).message); throw e }
  }
  const abort = new AbortController()
  opts.setKill(() => { cancelled = true; abort.abort() })
  const tmp = await mkdtemp(join(tmpdir(), 'aforge-'))
  const log = (text: string) => onEvent({ kind: 'log', text, at: new Date().toISOString() })
  try {
    await createBundle(cwd, join(tmp, 'in.bundle'))
    const base = await headOf(cwd)
    const res = await hub.runWithFile(
      { kind: 'implement', agent, prompt, base, message: opts.message },
      { needs: agent, labels: ['build'], runId: id, input: await readFile(join(tmp, 'in.bundle')), onEvent, signal: abort.signal },
    )
    if (res.file) {
      await writeFile(join(tmp, 'out.bundle'), res.file)
      const head = await applyBundle(cwd, join(tmp, 'out.bundle'))
      log(`Změny z workeru načteny (${head.slice(0, 7)}).`)
    } else log('Worker nevytvořil žádné změny.')
    agentRuns.finish(id, cancelled ? 'cancelled' : 'done')
    return !cancelled
  } catch (e) {
    log((e as Error).message)
    agentRuns.finish(id, cancelled ? 'cancelled' : 'failed', (e as Error).message)
    return false
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** One agent job per repository at a time: builds, tasks and walkthrough scripts all commit into it. */
export const exclusive = <T>(projectId: string, busy: string, job: (setKill: (kill: () => void) => void) => Promise<T>, repo?: string): Promise<T> => {
  const key = runKey(projectId, repo)
  if (running.has(key)) throw new Error(busy)
  running.set(key, () => {})
  return job((kill) => running.set(key, kill)).finally(() => running.delete(key))
}

export const isRepoBusy = (projectId: string, repo?: string) => running.has(runKey(projectId, repo))

/** Runs one build to the end; resolves with whether the agent finished successfully. */
const execute = async (projectId: string, mode: 'full' | 'incremental', setKill: (kill: () => void) => void, step?: string, workflowStepId?: string): Promise<boolean> => {
  const project = await loadProject(projectId)
  await ensureRepo(projectId)
  const activeStep = project.workflow?.steps.find((s) => s.id === workflowStepId)
  const activeInstruction = activeStep ? `\n\n## Právě prováděný krok: ${activeStep.label}\n${activeStep.prompt || 'Pokračuj podle kontextu session.'}` : ''
  await writeText(projectId, 'AFORGE_SPEC.md', renderSpec(project, mode) + activeInstruction)
  await copyDesign(project)
  await commit(projectId, 'Reactor: specifikace pro build')
  const agent = project.stack.agent
  publish(projectId, 'build', 'start', `Spouštím ${agent === 'codex' ? 'Codex' : 'Claude Code'} ${hub.mode() === 'remote' ? 'na vzdáleném workeru' : 'lokálně'} (${mode === 'full' ? 'kompletní implementace' : 'inkrementální změny'})…`)
  const onEvent = (e: BuildEvent) => publish(projectId, 'build', e.kind, e.text)
  const ok = await runAgent(projectId, { agent, prompt: PROMPT[mode], message: `Reactor build (${agent}, ${mode})`, step: step ?? (activeStep ? `Workflow · ${activeStep.label}` : undefined) ?? `Build · ${mode === 'full' ? 'Kompletní implementace' : 'Inkrementální změny'}`, onEvent, setKill, role: 'fe' })
  const hash = await commit(projectId, `Reactor build (${agent}, ${mode})`)
  if (ok) {
    // Stories that were ready are now implemented; verification is the test run's job.
    const fresh = await loadProject(projectId)
    await saveProject({
      ...fresh,
      stories: fresh.stories.map((s) => (s.status === 'ready' || s.status === 'draft' ? { ...s, status: 'implemented' } : s)),
      annotations: mode === 'incremental' ? fresh.annotations.map((a) => (a.status === 'open' ? { ...a, status: 'sent' } : a)) : fresh.annotations,
    })
    publish(projectId, 'project', 'changed', '')
  }
  publish(projectId, 'build', ok ? 'done' : 'error', ok ? `Build dokončen${hash ? `, commit ${hash}` : ''}.` : 'Agent build nedokončil.')
  return ok
}

/** Starts a build; the returned promise settles when it ends (the pipeline waits for it, the API does not). */
export const startBuild = (projectId: string, mode: 'full' | 'incremental', step?: string, workflowStepId?: string): { done: Promise<boolean> } => {
  const done = exclusive(projectId, 'Build nebo generování průchodu už běží', (setKill) => execute(projectId, mode, setKill, step, workflowStepId)).catch((e: Error) => {
    publish(projectId, 'build', 'error', e.message)
    return false
  })
  return { done }
}

export const stopBuild = (projectId: string, repo?: string) => {
  for (const [key, kill] of running) if (projectOf(key) === projectId && (!repo || key === runKey(projectId, repo))) kill()
}

export const isBuilding = (projectId: string) => [...running.keys()].some((key) => projectOf(key) === projectId)
