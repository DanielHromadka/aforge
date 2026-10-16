// Runs the generated Playwright suite (e2e/) in the official Playwright image on the app's network
// and maps the results back to stories through the "[US-x]" ids in the test titles.
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { storyIdsInTitle, type TestCase, type TestReport } from '@aforge/shared'
import { publish } from './events.js'
import { containerName, networkName, previewStatus } from './preview.js'
import { streamLines } from './proc.js'
import { loadProject, saveProject, workspaceDir } from './store.js'

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

const running = new Set<string>()

export const runTests = async (projectId: string) => {
  if (running.has(projectId)) throw new Error('Testy už běží')
  if (previewStatus(projectId).state !== 'running') throw new Error('Nejdřív spusťte aplikaci v náhledu.')
  running.add(projectId)
  const startedAt = new Date().toISOString()
  const ws = workspaceDir(projectId)
  await rm(join(ws, '.aforge/test-output'), { recursive: true, force: true })
  let log = ''
  publish(projectId, 'tests', 'start', 'Spouštím Playwright v kontejneru…')
  const job = streamLines(
    'docker',
    [
      'run', '--rm',
      '--network', networkName(projectId),
      '-v', `${ws}:/workspace`,
      '-w', '/workspace/e2e',
      '-e', `BASE_URL=http://${containerName(projectId)}`,
      '-e', 'CI=1',
      IMAGE,
      'bash', '-lc',
      'npm install --no-audit --no-fund >/dev/null && npx playwright test --reporter=json > /workspace/.aforge/test-results.json; echo "exit $?"',
    ],
    {},
    (line) => {
      log = (log + line + '\n').slice(-40_000)
      publish(projectId, 'tests', 'log', line)
    },
  )
  void job.done.then(async () => {
    running.delete(projectId)
    let cases: TestCase[] = []
    try {
      cases = parseReport(JSON.parse(await readFile(join(ws, '.aforge/test-results.json'), 'utf8')))
    } catch (err) {
      log += `\nVýsledky nejdou přečíst: ${String(err)}`
    }
    const report: TestReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: cases.length > 0 && cases.every((c) => c.status === 'passed' || c.status === 'skipped'),
      cases,
      log,
    }
    const project = await loadProject(projectId)
    const verified = new Set(cases.filter((c) => c.status === 'passed').flatMap((c) => c.storyIds))
    const failed = new Set(cases.filter((c) => c.status !== 'passed' && c.status !== 'skipped').flatMap((c) => c.storyIds))
    await saveProject({
      ...project,
      testReport: report,
      stories: project.stories.map((s) =>
        verified.has(s.id) && !failed.has(s.id)
          ? { ...s, status: 'verified' }
          : failed.has(s.id) && s.status === 'verified'
            ? { ...s, status: 'implemented' }
            : s,
      ),
    })
    publish(projectId, 'project', 'changed', '')
    publish(projectId, 'tests', report.ok ? 'done' : 'error', `${cases.filter((c) => c.status === 'passed').length}/${cases.length} testů prošlo.`)
  })
}
