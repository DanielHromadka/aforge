// Full container preview -> Playwright -> file export, using a disposable project and no model calls.
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { run } from '../packages/runner/src/proc.ts'
const dir = await mkdtemp(join(tmpdir(), 'reactor-preview-smoke-'))
const proxy = `reactor-smoke-egress-${randomUUID()}`
let app
try {
  const started = await run('docker', ['run', '-d', '--name', proxy, '--read-only', '--tmpfs', '/tmp', '--tmpfs', '/run', '--tmpfs', '/var/log/squid', '--tmpfs', '/var/spool/squid', '--cap-drop=ALL', '--security-opt=no-new-privileges', 'reactor-egress:latest'])
  if (started.code) throw new Error(started.stderr)
  Object.assign(process.env, { AFORGE_DATA: dir, AFORGE_AUTH: 'off', PORT: '0', AFORGE_AGENT_SANDBOX: 'docker', AFORGE_EGRESS_PROXY: proxy })
  app = (await import('../apps/server/src/index.ts')).app
  const { createProject } = await import('../apps/server/src/store.ts')
  const { ensureRepo, writeText } = await import('../apps/server/src/workspace.ts')
  const { startPreview, previewStatus } = await import('../apps/server/src/preview.ts')
  const { playwrightInContainer } = await import('../apps/server/src/tests.ts')
  const p = await createProject('Production smoke ' + randomUUID().slice(0, 8), '')
  await ensureRepo(p.id)
  await writeText(p.id, '.aforge/start.sh', `#!/bin/bash\nset -eu\nnode -e 'require("node:http").createServer((req,res)=>res.writeHead(200,{"content-type":"text/html"}).end("<!doctype html><html><head><title>Smoke</title></head><body><button>Ready</button></body></html>")).listen(80,"0.0.0.0")'\n`)
  await startPreview(p.id)
  const preview = previewStatus(p.id)
  if (preview.state !== 'running') throw new Error(JSON.stringify(preview))
  const html = await fetch(preview.url).then((r) => r.text())
  if (!html.includes('/__aforge/inspector.js')) throw new Error('Inspector injection missing')
  await writeText(p.id, 'e2e/package.json', JSON.stringify({ type: 'module', dependencies: { '@playwright/test': '1.64.1' } }))
  await writeText(p.id, 'e2e/playwright.config.ts', `import { defineConfig } from '@playwright/test';export default defineConfig({use:{baseURL:process.env.BASE_URL},projects:[{name:'chromium',use:{browserName:'chromium'}}]})`)
  await writeText(p.id, 'e2e/smoke.spec.ts', `import {test,expect} from '@playwright/test';test('preview is reachable',async({page})=>{await page.goto('/');await expect(page.getByRole('button',{name:'Ready'})).toBeVisible()})`)
  let output = ''
  const job = playwrightInContainer(p.id, 'npx playwright test --reporter=json > /workspace/.aforge/smoke-report.json', (line) => { output += line + '\n' })
  if (await job.done !== 0) throw new Error(output)
  const report = JSON.parse(await readFile(join(dir, 'projects', p.id, 'workspace/.aforge/smoke-report.json'), 'utf8'))
  if (report.stats.expected !== 1 || report.stats.unexpected) throw new Error(JSON.stringify(report))
  console.log('Preview container, injected proxy, private network, Chromium test and validated output export passed.')
} finally {
  await app?.close()
  await run('docker', ['rm', '-f', proxy])
  await rm(dir, { recursive: true, force: true })
}
