// Captures the website and README images from a running dev server on the demo project (demo-project.mjs).
// The agents' runs, their log and the running preview are answered here, so nothing real runs and no real
// project, host or person shows up.
//
//   node website/scripts/demo-project.mjs /tmp/reactor-demo
//   AFORGE_AUTH=off AFORGE_DATA=/tmp/reactor-demo npm run dev
//   node website/scripts/screenshots.cjs [name prefix]     # then website/scripts/optimize.sh
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const BASE = process.env.REACTOR_URL ?? 'http://localhost:5310'
const API = process.env.REACTOR_API ?? 'http://127.0.0.1:4310'
const OUT = join(__dirname, 'raw')
const P = 'kvasek'
const APP = 'http://kvasek.demo/'
const only = process.argv[2] ?? ''
const at = (min) => new Date(Date.UTC(2026, 10, 10, 8, min)).toISOString()

const run = (id, role, issueId, step, state, extra = {}) => ({
  id, role, issueId, agent: 'claude', location: extra.workerId ? 'remote' : 'local', host: extra.workerId ?? 'reactor', projectId: P, projectName: 'Kvásek',
  step, state, startedAt: at(51), ...(state === 'running' ? {} : { finishedAt: at(54) }), usage: { model: 'claude-opus-5-5', contextTokens: 63_000, contextWindow: 200_000, costUsd: 0.84 }, ...extra,
})
const hub = {
  relay: 'wss://relay.example', mode: 'remote', connected: true, modelMetrics: {},
  workers: [
    { id: 'w1', name: 'build-01', online: true, caps: { claude: true, codex: true, docker: true, git: true }, telemetry: true, labels: ['build'], running: 1, maxJobs: 2, since: at(0), createdAt: at(0) },
    { id: 'w2', name: 'review-01', online: true, caps: { claude: true, codex: false, docker: false, git: true }, telemetry: true, labels: ['orchestrator', 'review'], running: 0, maxJobs: 1, since: at(0), createdAt: at(0) },
  ],
  runs: [
    run('r3', 'be', 'KV-17', 'KV-17 · Validace slevového kódu', 'running', { workerId: 'build-01', activity: 'dotnet build' }),
    run('r2', 'fe', 'KV-16', 'KV-16 · Pole pro slevový kód a výpočet ceny', 'done'),
    run('r1', 'architect', undefined, 'IDE · plán', 'done', { usage: { model: 'claude-opus-5-5', contextTokens: 41_000, contextWindow: 200_000, costUsd: 0.31 } }),
  ],
}
const log = (issueId, lines) => lines.map(([kind, text], n) => ({ channel: 'build', kind, text, at: at(51 + n / 10), data: { issueId } }))
const record = { events: [
  ...log('KV-16', [['start', 'KV-16 Pole pro slevový kód a výpočet ceny'], ['tool', 'Read src/cart/Cart.tsx'], ['tool', 'Read src/api.ts'], ['text', 'Přidám pole pro kód a přepočet ceny se slevou.'], ['tool', 'Write src/cart/CouponField.tsx'], ['tool', 'Edit src/cart/Cart.tsx'], ['tool', 'Edit src/api.ts'], ['tool', '$ npm run typecheck'], ['log', '✓ 0 chyb'], ['done', 'KV-16 čeká na revizi.']]),
  ...log('KV-17', [['start', 'KV-17 Validace slevového kódu'], ['tool', 'Read Program.cs'], ['tool', 'Write Coupons/Coupon.cs'], ['tool', 'Write Coupons/CouponEndpoints.cs'], ['tool', 'Edit Program.cs'], ['tool', '$ dotnet build'], ['log', 'Build succeeded.'], ['tool', '$ dotnet test']]),
] }

const put = async (patch) => {
  const p = await (await fetch(`${API}/api/projects/${P}`)).json()
  const res = await fetch(`${API}/api/projects/${P}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, ...patch(p) }) })
  if (!res.ok) throw new Error(await res.text())
}
const steps = (kinds) => kinds.map((kind) => ({ id: kind, kind, label: { ide: 'IDE', overview: 'Přehled', design: 'Design', stories: 'Stories', split: 'Rozpad', build: 'Implementace', preview: 'Náhled', tests: 'Testy', wiki: 'Wiki' }[kind], prompt: '' }))
// The server fails runs left over from before its start; the demo's backend agent is still at work.
const running = (p) => ({ issues: p.issues.map((i) => (i.id === 'KV-17' ? { ...i, status: 'running', updatedAt: new Date().toISOString() } : i)) })
const enterprise = () => put((p) => ({ ...running(p), workflow: { preset: 'enterprise', retained: [], steps: steps(['overview', 'design', 'stories', 'split', 'build', 'preview', 'tests', 'wiki']) } }))
const ide = () => put((p) => ({ ...running(p), workflow: { preset: 'ide', retained: [], steps: steps(['ide', 'preview', 'tests', 'wiki']) } }))

const openCart = async (page) => {
  await page.locator('.ide-row', { hasText: 'src' }).first().click()
  await page.locator('.ide-row', { hasText: 'cart' }).first().click()
  await page.locator('.ide-row', { hasText: 'Cart.tsx' }).first().click()
  await page.waitForSelector('.monaco-editor')
}

const SHOTS = [
  { name: 'hero', before: enterprise, path: 'stories' },
  { name: 'overview', path: 'overview' },
  { name: 'split', path: 'split' },
  { name: 'implement', path: 'build/KV-16' },
  { name: 'preview', path: 'preview' },
  { name: 'tests', path: 'tests' },
  { name: 'wiki', path: 'wiki/KV-1' },
  { name: 'agents', path: 'agents' },
  { name: 'ide', before: ide, path: 'ide', act: async (page) => { await openCart(page); await page.getByRole('button', { name: 'Zobrazit diff' }).click(); await page.waitForTimeout(800) } },
  { name: 'trace', path: 'ide', act: async (page) => { await openCart(page); await page.locator('.ide-trace-pill').click() } },
  { name: 'ponor', path: 'ide', act: async (page) => { await page.locator('.ide-status button', { hasText: 'Ponor' }).click(); await page.waitForTimeout(1500) } },
  { name: 'dark', path: 'ide', dark: true, act: openCart },
  { name: 'board-dark', before: enterprise, path: 'stories', dark: true },
]

;(async () => {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  const demo = readFileSync(join(__dirname, 'demo-app.html'))
  for (const shot of SHOTS) {
    if (shot.before) await shot.before()
    if (only && !shot.name.startsWith(only)) continue
    const page = await browser.newPage({ viewport: { width: 1440, height: 878 }, deviceScaleFactor: 2, colorScheme: shot.dark ? 'dark' : 'light' })
    await page.addInitScript(() => { localStorage.setItem('aforge.agentOpen', '0'); localStorage.setItem('aforge.ide.cols', '3') })
    await page.route(`**/api/projects/${P}/preview`, (r) => r.fulfill({ json: { state: 'running', url: APP, log: '' } }))
    await page.route('**/api/hub', (r) => r.fulfill({ json: hub }))
    await page.route(`**/api/projects/${P}/session-record`, (r) => r.fulfill({ json: record }))
    await page.route(`**/api/projects/${P}/events`, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': demo\n\n' }))
    await page.route(`${APP}**`, (r) => r.fulfill({ contentType: 'text/html', body: demo }))
    await page.goto(`${BASE}/p/${P}/${shot.path}`, { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    if (shot.act) await shot.act(page)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(OUT, `${shot.name}.png`) })
    console.log(shot.name)
    await page.close()
  }
  // The icon: the app's own mark, rendered large.
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
  await page.goto(`${BASE}/brand/reactor.svg`)
  await page.screenshot({ path: join(OUT, 'icon.png'), omitBackground: true })
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
