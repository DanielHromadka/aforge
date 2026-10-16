// Build: turns the project model into AFORGE_SPEC.md, hands it to Claude Code or Codex – in the local
// workspace, or on a remote worker that gets a git bundle and sends its new commits back – and commits
// the result. One build per project at a time.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildEvent, Project } from '@aforge/shared'
import { applyBundle, createBundle, headOf, implement } from '@aforge/runner'
import { publish } from './events.js'
import { hub } from './hub.js'
import { PLAYWRIGHT_VERSION } from './tests.js'
import { commit, ensureRepo, writeText } from './workspace.js'
import { saveProject, loadProject, workspaceDir } from './store.js'

const running = new Map<string, () => void>()

const STACK_TEXT = {
  backend: {
    dotnet: '.NET 8 – ASP.NET Core Minimal API (C#), EF Core s SQLite pro lokální běh',
    node: 'Node.js 22 + TypeScript + Fastify',
    python: 'Python 3.12 + FastAPI',
  },
  frontend: {
    react: 'React 19 + TypeScript + Vite',
    vue: 'Vue 3 + TypeScript + Vite',
  },
  hosting: {
    'azure-container-apps': 'Azure Container Apps (jeden kontejner s Nginx + backend)',
    aks: 'Azure Kubernetes Service (Deployment + Service + Ingress)',
    'app-service': 'Azure App Service for Containers (Linux)',
    'azure-static-web-apps': 'Azure Static Web Apps (frontend) + Azure Functions / Container Apps (API)',
  },
} as const

export const renderSpec = (p: Project, mode: 'full' | 'incremental'): string => {
  const screens = p.screens
    .map(
      (s) =>
        `### ${s.name} (\`${s.id}\`, ${s.width}×${s.height})\n` +
        (s.elements.length
          ? s.elements
              .map(
                (e) =>
                  `- **${e.kind}** „${e.label}“ @ ${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}×${Math.round(e.h)}` +
                  (e.storyIds.length ? ` – ${e.storyIds.join(', ')}` : '') +
                  (e.note ? ` – _${e.note}_` : ''),
              )
              .join('\n')
          : '_prázdná obrazovka_'),
    )
    .join('\n\n')
  const stories = p.stories
    .map(
      (s) =>
        `### ${s.id}: ${s.title} [${s.priority}]\nJako **${s.asA}** chci **${s.iWant}**, abych **${s.soThat}**.\n` +
        (s.screenIds.length ? `Obrazovky: ${s.screenIds.join(', ')}\n` : '') +
        s.acceptance.map((a) => `- [ ] ${a}`).join('\n'),
    )
    .join('\n\n')
  const blocks = p.blocks.nodes.map((n) => `- \`${n.id}\` **${n.kind}** ${n.label}: ${n.description}${n.storyIds.length ? ` (${n.storyIds.join(', ')})` : ''}`).join('\n')
  const edges = p.blocks.edges
    .map((e) => `- ${e.from} → ${e.to}${e.label ? ` (${e.label})` : ''}`)
    .join('\n')
  const annotations = p.annotations.filter((a) => a.status !== 'resolved')
  const failing = p.testReport?.cases.filter((c) => c.status !== 'passed' && c.status !== 'skipped') ?? []
  return `# ${p.name} – implementační specifikace (generuje aForge)

${p.description || ''}

## Stack
- Backend: ${STACK_TEXT.backend[p.stack.backend]}
- Frontend: ${STACK_TEXT.frontend[p.stack.frontend]}
- Cílový hosting: ${STACK_TEXT.hosting[p.stack.hosting]}

## Běhový kontrakt (povinné)
aForge spouští aplikaci v kontejneru \`aforge-runtime\` (Ubuntu 24.04, Node 22, .NET 8 SDK, Python 3, Nginx).
Pracovní adresář je připojen do \`/workspace\`.

1. \`.aforge/start.sh\` (bash, spouští se jako root): zkopíruje zdroják z \`/workspace\` do \`/app\` (bez node_modules,
   bin, obj, dist – \`rsync -a --exclude …\`), nainstaluje závislosti, sestaví frontend a backend, spustí backend
   na portu **5000** na pozadí a nakonec Nginx v popředí (\`nginx -g 'daemon off;'\`) na portu **80**:
   \`/\` = statický build frontendu se SPA fallbackem, \`/api/\` = proxy na \`http://127.0.0.1:5000\`.
2. Konfigurace Nginx v \`.aforge/nginx.conf\`.
3. E2E testy v \`e2e/\`: vlastní \`package.json\` s \`@playwright/test@${PLAYWRIGHT_VERSION}\` (přesně tato verze),
   \`playwright.config.ts\` s \`baseURL: process.env.BASE_URL\`, \`screenshot: 'on'\`,
   \`outputDir: '../.aforge/test-output'\`, jen projekt chromium. Každý test má v názvu id story, např.
   \`test('[US-3] uživatel se přihlásí', …)\`, a pokrývá její akceptační kritéria. Používej role/label lokátory.
4. \`Dockerfile\` pro produkční nasazení na ${STACK_TEXT.hosting[p.stack.hosting]} a stručný \`README.md\`
   (lokální vývoj, build, nasazení).
5. Nezapisuj nic mimo pracovní adresář a neukládej žádné tajné klíče.

## User stories
${stories || '_zatím žádné_'}

## Wireframy
Souřadnice v px. Rozložení a pojmenování prvků dodrž, vizuální styl zvol čistý a přístupný.

${screens}

## Model bloků
${blocks || '_zatím žádné bloky_'}

${edges ? `### Vazby\n${edges}` : ''}
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

const PROMPT = {
  full: 'Implementuj kompletní aplikaci podle souboru AFORGE_SPEC.md v tomto adresáři. Dodrž přesně běhový kontrakt (.aforge/start.sh, .aforge/nginx.conf, e2e/). Ověř, že se backend i frontend sestaví. Na konci stručně shrň, co jsi udělal a co zbývá.',
  incremental:
    'Aplikace v tomto adresáři už existuje. Aktualizuj ji podle AFORGE_SPEC.md: dopracuj stories, které nejsou implementované, zapracuj otevřené anotace a oprav neúspěšné testy. Neměň nesouvisející kód. Na konci stručně shrň změny.',
}

/** Runs one build to the end; resolves with whether the agent finished successfully. */
const execute = async (projectId: string, mode: 'full' | 'incremental'): Promise<boolean> => {
  const project = await loadProject(projectId)
  const cwd = workspaceDir(projectId)
  await ensureRepo(projectId)
  await writeText(projectId, 'AFORGE_SPEC.md', renderSpec(project, mode))
  await commit(projectId, 'aForge: specifikace pro build')
  const agent = project.stack.agent
  const remote = hub.mode() === 'remote'
  publish(projectId, 'build', 'start', `Spouštím ${agent === 'codex' ? 'Codex' : 'Claude Code'} ${remote ? 'na vzdáleném workeru' : 'lokálně'} (${mode === 'full' ? 'kompletní implementace' : 'inkrementální změny'})…`)
  const onEvent = (e: BuildEvent) => publish(projectId, 'build', e.kind, e.text)
  let ok: boolean
  if (remote) {
    const abort = new AbortController()
    running.set(projectId, () => abort.abort())
    const tmp = await mkdtemp(join(tmpdir(), 'aforge-'))
    try {
      await createBundle(cwd, join(tmp, 'in.bundle'))
      const base = await headOf(cwd)
      const res = await hub.runWithFile(
        { kind: 'implement', agent, prompt: PROMPT[mode], base, message: `aForge build (${agent}, ${mode})` },
        { needs: agent, labels: ['build'], input: await readFile(join(tmp, 'in.bundle')), onEvent, signal: abort.signal },
      )
      if (res.file) {
        await writeFile(join(tmp, 'out.bundle'), res.file)
        const head = await applyBundle(cwd, join(tmp, 'out.bundle'))
        publish(projectId, 'build', 'log', `Změny z workeru načteny (${head.slice(0, 7)}).`)
      } else publish(projectId, 'build', 'log', 'Worker nevytvořil žádné změny.')
      ok = true
    } catch (e) {
      publish(projectId, 'build', 'log', (e as Error).message)
      ok = false
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  } else {
    const job = implement(agent, cwd, PROMPT[mode], onEvent)
    running.set(projectId, job.kill)
    ok = (await job.done) === 0
  }
  running.delete(projectId)
  const hash = await commit(projectId, `aForge build (${agent}, ${mode})`)
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
export const startBuild = (projectId: string, mode: 'full' | 'incremental'): { done: Promise<boolean> } => {
  if (running.has(projectId)) throw new Error('Build už běží')
  running.set(projectId, () => {})
  const done = execute(projectId, mode).catch((e: Error) => {
    running.delete(projectId)
    publish(projectId, 'build', 'error', e.message)
    return false
  })
  return { done }
}

export const stopBuild = (projectId: string) => {
  running.get(projectId)?.()
}

export const isBuilding = (projectId: string) => running.has(projectId)
