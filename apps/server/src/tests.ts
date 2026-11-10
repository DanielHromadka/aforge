// Runs the generated Playwright suite (e2e/) in the official Playwright image on the app's network,
// maps the results back to stories through the "[KEY-n]" keys in the test titles, files a bug for every
// failing test and lets the writer update the wiki once something passes.
import { readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { nextKeys, storyIdsInTitle, workflowOf, type Issue, type Project, type TestCase, type TestReport } from '@aforge/shared'
import { generate, isGenerating } from './generate.js'
import { publish } from './events.js'
import { containerName, ensurePreviewRunning, networkName } from './preview.js'
import { streamLines, containerRestrictions, proxyArgs, run, sandboxProcess } from '@aforge/runner'
import { loadProject, mutateProject, workspaceDir } from './store.js'

export const PLAYWRIGHT_VERSION = '1.64.1'
const IMAGE = `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble`

interface PwResult {
  status: TestCase['status']
  duration: number
  error?: { message?: string }
  attachments?: { name: string; path?: string; contentType: string }[]
}
interface PwSuite {
  title: string
  specs?: { title: string; tests: { results: PwResult[] }[] }[]
  suites?: PwSuite[]
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

export const parseReport = (json: { suites?: PwSuite[] }): TestCase[] => {
  const out: TestCase[] = []
  const walk = (suite: PwSuite, prefix: string[]) => {
    for (const spec of suite.specs ?? []) {
      const title = [...prefix, spec.title].filter(Boolean).join(' › ')
      for (const t of spec.tests) {
        const last = t.results.at(-1)
        if (!last) continue
        out.push({
          title,
          storyIds: storyIdsInTitle(title),
          status: last.status,
          durationMs: last.duration,
          error: last.error?.message ? stripAnsi(last.error.message) : undefined,
          screenshots: (last.attachments ?? [])
            .filter((a) => a.contentType.startsWith('image/') && a.path)
            .map((a) => a.path!.replace(/^\/workspace\//, '')),
        })
      }
    }
    for (const s of suite.suites ?? []) walk(s, [...prefix, s.title.endsWith('.ts') ? '' : s.title])
  }
  for (const s of json.suites ?? []) walk(s, [])
  return out
}

/** Runs `command` in e2e/ of the workspace inside the Playwright image, on the app's network with BASE_URL set. */
export const playwrightInContainer = (projectId: string, command: string, onLine: (line: string) => void) => {
  if (process.env.AFORGE_AGENT_SANDBOX === 'docker' || process.env.NODE_ENV === 'production') return sandboxProcess('bash', ['-lc', `cd /workspace/e2e && npm install --no-audit --no-fund >/dev/null && ${command}`], workspaceDir(projectId), undefined, onLine, { model: false, image: process.env.AFORGE_TEST_IMAGE ?? 'reactor-playwright:latest', network: networkName(projectId), env: { BASE_URL: `http://${containerName(projectId)}`, CI: '1', NO_PROXY: `localhost,127.0.0.1,${containerName(projectId)}` } })
  const name = `aforge-test-${randomUUID()}`
  const job = streamLines(
    'docker',
    [
      'run', '--rm', '--init', '--name', name, ...containerRestrictions, ...proxyArgs(),
      '--label', 'aforge.managed=true', '--label', 'aforge.kind=test',
      '-e', `NO_PROXY=localhost,127.0.0.1,${containerName(projectId)}`,
      '-v', `${workspaceDir(projectId)}/.git:/workspace/.git:ro`,
      '--network', networkName(projectId),
      '-v', `${workspaceDir(projectId)}:/workspace`,
      '-w', '/workspace/e2e',
      '-e', `BASE_URL=http://${containerName(projectId)}`,
      '-e', 'CI=1',
      IMAGE,
      // `command` is built from constants and validated slugs only (never free user text); bash is needed for the redirect.
      'bash', '-lc',
      `npm install --no-audit --no-fund >/dev/null && ${command}; echo "exit $?"`,
    ],
    {},
    onLine,
  )
  return { kill: () => { job.kill(); void run('docker', ['rm', '-f', name]) }, done: job.done.finally(() => run('docker', ['rm', '-f', name])) }
}

const failed = (c: TestCase) => c.status !== 'passed' && c.status !== 'skipped'

/** A bug per failing test (one per test, under its first story); a bug whose test passes again is done. */
export const syncTestBugs = (project: Project, cases: TestCase[]): Issue[] => {
  const now = new Date().toISOString()
  const issues = (project.issues ?? []).map((i) => {
    const c = i.type === 'bug' && i.source === 'test' && i.status !== 'done' ? cases.find((x) => x.title === i.testTitle) : undefined
    return c?.status === 'passed' && i.status !== 'running' ? { ...i, status: 'done' as const, updatedAt: now } : i
  })
  const open = new Set(issues.filter((i) => i.type === 'bug' && i.status !== 'done').map((i) => i.testTitle))
  const fresh = cases.filter((c) => failed(c) && !open.has(c.title))
  const keys = nextKeys({ ...project, issues }, fresh.length)
  return [...issues, ...fresh.map((c, n): Issue => {
    const storyId = c.storyIds[0]
    const work = issues.find((i) => i.storyId === storyId && i.type === 'task' && (i.layer === 'fe' || i.layer === 'be'))
    return {
      id: keys[n]!, type: 'bug', storyId, title: c.title.replace(/\[[A-Z][A-Z0-9]*-\d+\]\s*/g, '').slice(0, 140), description: (c.error ?? 'Test selhal.').slice(0, 3000),
      layer: work?.layer ?? 'fe', repoId: work?.repoId ?? 'main', status: 'todo', source: 'test', testTitle: c.title, files: [], createdAt: now, updatedAt: now,
    }
  })]
}

const running = new Set<string>()

export const testsRunning = (projectId: string) => running.has(projectId)

/** Starts a run; the returned promise settles with the report when it ends. */
/** Runs the suite, or only the tests of the given stories; starts the preview first when it is off. */
export const runTests = async (projectId: string, storyIds?: string[]): Promise<{ done: Promise<TestReport> }> => {
  if (running.has(projectId)) throw new Error('Testy už běží')
  // Keys go into the command line, so only well-formed ones pass.
  const keys = (storyIds ?? []).filter((k) => /^[A-Z][A-Z0-9]{0,9}-\d+$/.test(k))
  running.add(projectId)
  const startedAt = new Date().toISOString()
  const ws = workspaceDir(projectId)
  await rm(join(ws, '.aforge/test-output'), { recursive: true, force: true })
  let log = ''
  publish(projectId, 'tests', 'start', keys.length ? `Spouštím testy stories ${keys.join(', ')}…` : 'Spouštím všechny testy…')
  const done = (async () => {
    await ensurePreviewRunning(projectId, (text) => publish(projectId, 'tests', 'log', text))
    const grep = keys.length ? ` --grep "\\[(${keys.join('|')})\\]"` : ''
    const job = playwrightInContainer(
      projectId,
      // Walkthroughs (e2e/walkthroughs, tagged @walkthrough) are recordings, not part of the suite.
      `npx playwright test --grep-invert @walkthrough${grep} --reporter=json > /workspace/.aforge/test-results.json`,
      (line) => {
        log = (log + line + '\n').slice(-40_000)
        publish(projectId, 'tests', 'log', line)
      },
    )
    await job.done
    let cases: TestCase[] = []
    try {
      cases = parseReport(JSON.parse(await readFile(join(ws, '.aforge/test-results.json'), 'utf8')))
    } catch (err) {
      log += `\nVýsledky nejdou přečíst: ${String(err)}`
    }
    // A run of some stories replaces only their results; the rest of the last report stays.
    const kept = keys.length ? (await loadProject(projectId)).testReport?.cases.filter((c) => !c.storyIds.some((k) => keys.includes(k))) ?? [] : []
    const all = [...kept, ...cases]
    const report: TestReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: all.length > 0 && all.every((c) => c.status === 'passed' || c.status === 'skipped'),
      cases: all,
      log,
    }
    const verified = new Set(cases.filter((c) => c.status === 'passed').flatMap((c) => c.storyIds))
    const failed = new Set(cases.filter((c) => c.status !== 'passed' && c.status !== 'skipped').flatMap((c) => c.storyIds))
    const project = await mutateProject(projectId, (project) => ({
      ...project,
      testReport: report,
      issues: syncTestBugs(project, cases),
      stories: project.stories.map((s) =>
        verified.has(s.id) && !failed.has(s.id)
          ? { ...s, status: 'verified' }
          : failed.has(s.id) && s.status === 'verified'
            ? { ...s, status: 'implemented' }
            : s,
      ),
    }))
    publish(projectId, 'project', 'changed', '')
    publish(projectId, 'tests', report.ok ? 'done' : 'error', `${cases.filter((c) => c.status === 'passed').length}/${cases.length} testů prošlo.`)
    // The last step: once something is verified, the writer proposes the wiki update.
    if (verified.size && workflowOf(project).steps.some((s) => s.kind === 'wiki') && !isGenerating(projectId))
      void generate(projectId, 'wiki').catch((e: Error) => publish(projectId, 'generate', 'error', e.message))
    return report
  })()
    .catch((e: Error) => { publish(projectId, 'tests', 'error', e.message); throw e })
    .finally(() => running.delete(projectId))
  return { done }
}
