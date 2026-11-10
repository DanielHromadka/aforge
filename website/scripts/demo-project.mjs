// Writes a made-up demo project (a bakery e-shop) into a fresh data folder, so the screenshots show no real
// projects, people or hosts. Usage: node website/scripts/demo-project.mjs <data-dir>
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const data = process.argv[2]
if (!data) throw new Error('Usage: node demo-project.mjs <data-dir>')
const id = 'kvasek'
const root = join(data, 'projects', id)
rmSync(data, { recursive: true, force: true })

const t = (min) => new Date(Date.UTC(2026, 10, 10, 8, min)).toISOString()
const story = (n, epic, title, asA, iWant, soThat, acceptance, status = 'ready') =>
  ({ id: `KV-${n}`, epicId: `KV-${epic}`, title, asA, iWant, soThat, acceptance, priority: 'must', status, screenIds: [] })
const issue = (n, storyId, title, layer, repoId, status, files = [], extra = {}) => ({
  id: `KV-${n}`, type: 'task', storyId, title, description: `${title}.\n\nPokrývá kritéria story ${storyId}.`, layer, repoId, status,
  source: 'breakdown', files, createdAt: t(n), updatedAt: t(n + 1), ...extra,
})

const contract = `openapi: 3.1.0
info: { title: Kvásek API, version: '3' }
paths:
  /api/products:
    get: { summary: Seznam pečiva, responses: { '200': { description: Produkty } } }
  /api/cart:
    get: { summary: Obsah košíku, responses: { '200': { description: Košík } } }
  /api/coupons/validate:
    post: { summary: Ověří slevový kód, responses: { '200': { description: Sleva }, '422': { description: Neplatný kód } } }
  /api/orders:
    post: { summary: Vytvoří objednávku s vyzvednutím, responses: { '201': { description: Objednávka } } }
`

const stories = [
  story(4, 1, 'Katalog pečiva podle dne', 'zákazník', 'vidět, co se dnes peče', 'si vyberu čerstvé', ['Given dnešní nabídka When otevřu katalog Then vidím jen pečivo na dnešek', 'Given vyprodaný produkt When ho zobrazím Then je označený jako vyprodaný'], 'verified'),
  story(5, 1, 'Detail produktu s alergeny', 'zákazník s alergií', 'vidět složení a alergeny', 'nakoupím bezpečně', ['Given produkt When otevřu detail Then vidím alergeny podle EU'], 'verified'),
  story(6, 2, 'Košík a množství', 'zákazník', 'měnit počet kusů v košíku', 'nakoupím pro celou rodinu', ['Given košík When změním množství Then se přepočte cena', 'Given 0 kusů When potvrdím Then položka zmizí'], 'implemented'),
  story(7, 2, 'Slevové kódy v košíku', 'zákazník', 'zadat slevový kód', 'zaplatím méně', ['Given platný kód When ho zadám Then cena klesne', 'Given použitý kód When ho zadám znovu Then ho systém odmítne', 'Given sleva When otevřu rekapitulaci Then vidím ušetřenou částku']),
  story(8, 3, 'Vyzvednutí na prodejně', 'zákazník', 'zvolit čas vyzvednutí', 'nemusím čekat ve frontě', ['Given objednávka When zvolím čas Then nabídne jen otevírací dobu', 'Given plný slot When ho vyberu Then nabídne nejbližší volný']),
  story(9, 3, 'Potvrzení objednávky e-mailem', 'zákazník', 'dostat potvrzení e-mailem', 'vím, kdy si pro pečivo přijít', ['Given dokončená objednávka When se uloží Then odejde e-mail s časem vyzvednutí']),
  story(10, 3, 'Přehled objednávek pro pekaře', 'pekař', 'vidět ranní objednávky po hodinách', 'vím, kolik čeho upéct', ['Given objednávky When otevřu přehled Then jsou seskupené po hodinách vyzvednutí']),
]

const issues = [
  issue(11, 'KV-4', 'Katalog s dnešní nabídkou', 'fe', 'main', 'done', [{ path: 'src/catalog/Catalog.tsx', added: 84, removed: 0 }]),
  issue(12, 'KV-4', 'Endpoint dnešní nabídky', 'be', 'api', 'done', [{ path: 'Products/ProductEndpoints.cs', added: 41, removed: 0 }]),
  issue(13, 'KV-5', 'Detail produktu a alergeny', 'fe', 'main', 'done', [{ path: 'src/catalog/ProductDetail.tsx', added: 62, removed: 3 }]),
  issue(14, 'KV-6', 'Košík s množstvím', 'fe', 'main', 'done', [{ path: 'src/cart/Cart.tsx', added: 77, removed: 0 }]),
  issue(15, 'KV-6', 'API košíku', 'be', 'api', 'done', [{ path: 'Cart/CartEndpoints.cs', added: 58, removed: 0 }]),
  issue(16, 'KV-7', 'Pole pro slevový kód a výpočet ceny', 'fe', 'main', 'review', [{ path: 'src/cart/Cart.tsx', added: 18, removed: 3 }, { path: 'src/cart/CouponField.tsx', added: 46, removed: 0 }, { path: 'src/api.ts', added: 9, removed: 0 }], { source: 'ide', promptId: 'p1' }),
  issue(17, 'KV-7', 'Validace slevového kódu', 'be', 'api', 'running', [], { source: 'ide', promptId: 'p1' }),
  issue(18, 'KV-7', 'Testy uplatnění kódu', 'test', 'main', 'todo', [], { source: 'ide', promptId: 'p1' }),
  issue(19, 'KV-8', 'Výběr času vyzvednutí', 'fe', 'main', 'proposed'),
  issue(20, 'KV-8', 'Sloty podle otevírací doby', 'be', 'api', 'proposed'),
  issue(21, 'KV-6', 'Nulové množství nesmaže položku', 'fe', 'main', 'todo', [], { type: 'bug', source: 'test', testTitle: '[KV-6] položka s nulou zmizí' }),
]

const wiki = [
  { id: 'about', title: 'Kvásek', body: 'Kvásek je e-shop rodinné pekárny. Zákazník si večer objedná pečivo na ráno a vyzvedne si ho na prodejně bez čekání.\n\n## Hlavní části\n- **Katalog** s dnešní nabídkou a alergeny\n- **Košík** s množstvím a slevovými kódy\n- **Objednávky** s časem vyzvednutí', updatedAt: t(40), sources: ['KV-4', 'KV-5', 'KV-6'], history: [] },
  { id: 'KV-1', title: 'Katalog', body: 'Katalog ukazuje jen pečivo, které se ten den peče. Vyprodané kusy zůstávají vidět, ale nejdou přidat do košíku.\n\n## Jak na to\n1. Otevřete **Katalog**.\n2. Vyberte produkt a podívejte se na složení.\n3. Přidejte ho do košíku.\n\n## Pravidla\n- Nabídka se mění každý den v 18:00.\n- Alergeny jsou uvedené podle nařízení EU.', updatedAt: t(42), sources: ['KV-4', 'KV-5'], history: [{ body: 'Katalog ukazuje dnešní pečivo.', at: t(20) }] },
  { id: 'KV-2', title: 'Košík', body: 'V košíku měníte počet kusů a cena se hned přepočítá.', updatedAt: t(44), sources: ['KV-6'], history: [],
    draft: { title: 'Košík', body: 'V košíku měníte počet kusů a cena se hned přepočítá. Slevový kód zadáte pod seznamem položek.\n\n## Pravidla\n- Kód jde použít jen jednou na objednávku.', changes: ['Slevové kódy', 'Pravidlo jednoho použití'], sources: ['KV-7'], createdAt: t(55) } },
]

const testCase = (title, status, ms, error) => ({ title, storyIds: [title.match(/\[(KV-\d+)\]/)[1]], status, durationMs: ms, screenshots: [], ...(error ? { error } : {}) })
const walk = (n, title, storyId, status = 'recorded') => ({ id: `wt-${n}`, kind: 'test', title, route: '/', section: 'main', storyIds: [storyId], instructions: title, script: `e2e/walkthroughs/test-${n}.spec.ts`, status, createdAt: t(30), updatedAt: t(31), recordedAt: t(31) })

const trace = [
  { id: 'e1', at: t(50), kind: 'prompt', title: 'Přidej do košíku slevové kódy. Procentní i pevná částka, kód jen jednou na objednávku.', detail: 'Nové téma → nová story v epicu Košík', promptId: 'p1', auto: true },
  { id: 'e2', at: t(50), kind: 'story', ref: 'KV-7', title: 'KV-7 Slevové kódy v košíku', detail: '2 kritéria z promptu', promptId: 'p1', auto: true, revert: { type: 'created', item: 'story', id: 'KV-7' } },
  { id: 'e3', at: t(51), kind: 'task', ref: 'KV-16', title: 'KV-16 web · Pole pro slevový kód a výpočet ceny', detail: 'Agent repozitáře začne, jakmile je volný', promptId: 'p1', auto: true },
  { id: 'e4', at: t(51), kind: 'task', ref: 'KV-17', title: 'KV-17 api · Validace slevového kódu', detail: 'Agent repozitáře začne, jakmile je volný', promptId: 'p1', auto: true },
  { id: 'e5', at: t(51), kind: 'contract', title: 'API kontrakt v3', detail: 'Zapsán do repozitářů', promptId: 'p1', auto: true },
  { id: 'e6', at: t(56), kind: 'prompt', title: 'Slevu ukaž i v rekapitulaci objednávky.', detail: 'Stejné téma → doplněno do KV-7', promptId: 'p2', auto: true },
  { id: 'e7', at: t(56), kind: 'criterion', ref: 'KV-7', title: 'KV-7 Slevové kódy v košíku', detail: '+1 kritérium: Given sleva When otevřu rekapitulaci Then vidím ušetřenou částku', promptId: 'p2', auto: true, revert: { type: 'story', before: { ...stories[3], acceptance: stories[3].acceptance.slice(0, 2) } } },
  { id: 'e8', at: t(58), kind: 'wiki', ref: 'KV-1', title: 'Wiki · Katalog', detail: 'Pravidla nabídky a alergeny', auto: true, revert: { type: 'wiki', page: 'KV-1', title: 'Katalog', body: 'Katalog ukazuje dnešní pečivo.', existed: true } },
  { id: 'e9', at: t(59), kind: 'prompt', title: 'Zrychli načítání produktů.', detail: 'Nezařazeno', promptId: 'p3', auto: true },
  { id: 'e10', at: t(59), kind: 'unsorted', title: 'Nezařazeno', detail: 'Možná KV-4, nebo nová story', promptId: 'p3', auto: false, candidates: ['KV-4'], draft: { title: 'Rychlý katalog', asA: 'zákazník', iWant: 'rychle načtený katalog', soThat: 'nečekám', acceptance: ['Given katalog When se načte Then do 1 s'], priority: 'should' } },
]

const project = {
  id, name: 'Kvásek', description: 'E-shop rodinné pekárny: objednávka pečiva večer, vyzvednutí ráno bez fronty. Web v Reactu, backend v .NET.',
  createdAt: t(0), updatedAt: t(60), key: 'KV', stack: { agent: 'claude' },
  epics: [
    { id: 'KV-1', title: 'Katalog', description: 'Dnešní nabídka, detail a alergeny.', screenIds: [] },
    { id: 'KV-2', title: 'Košík', description: 'Množství, slevy a rekapitulace.', screenIds: [] },
    { id: 'KV-3', title: 'Objednávky', description: 'Vyzvednutí na prodejně a potvrzení.', screenIds: [] },
  ],
  stories, issues,
  repos: [{ id: 'main', name: 'web', platform: 'web' }, { id: 'api', name: 'api', platform: 'backend' }],
  contract: { yaml: contract, version: 3, status: 'approved', updatedAt: t(51) },
  wiki, screens: [], prompts: {}, annotations: [],
  workflow: { preset: 'enterprise', retained: [], steps: ['overview', 'design', 'stories', 'split', 'build', 'preview', 'tests', 'wiki'].map((kind) => ({ id: kind, kind, label: { overview: 'Přehled', design: 'Design', stories: 'Stories', split: 'Rozpad', build: 'Implementace', preview: 'Náhled', tests: 'Testy', wiki: 'Wiki' }[kind], prompt: '' })) },
  architecture: {
    generatedAt: t(10), summary: 'React SPA za Nginx volá ASP.NET Core Minimal API; data v SQLite.',
    stack: { frontend: 'React 19 + TypeScript + Vite', backend: '.NET 8 Minimal API', database: 'SQLite (soubor)', reason: 'Ze zadání: web v Reactu, backend v .NET.' },
    diagrams: [{ id: 'dg-architecture', title: 'Části aplikace', type: 'flowchart', storyIds: ['KV-4', 'KV-6', 'KV-8'], description: 'Klient, API a databáze.', steps: [{ name: 'Web', description: 'Katalog, košík a objednávka.' }, { name: 'API', description: 'Produkty, košík, slevy a objednávky.' }, { name: 'DB', description: 'SQLite soubor.' }],
      mermaid: 'flowchart TD\n  web["Web (React)"] -->|REST| api["API (.NET)"]\n  api --> db[("SQLite")]\n  api --> mail["E-mail"]' }],
  },
  testReport: { startedAt: t(30), finishedAt: t(31), ok: false, log: '', cases: [
    testCase('[KV-4] katalog ukazuje dnešní nabídku', 'passed', 1820), testCase('[KV-4] vyprodaný produkt je označený', 'passed', 1240),
    testCase('[KV-5] detail ukazuje alergeny', 'passed', 990), testCase('[KV-6] změna množství přepočte cenu', 'passed', 1410),
    testCase('[KV-6] položka s nulou zmizí', 'failed', 2210, 'Expected the row to be removed, it still shows quantity 0'),
  ] },
  walkthroughs: [walk(1, 'Katalog ukazuje dnešní nabídku', 'KV-4'), walk(2, 'Detail ukazuje alergeny', 'KV-5'), walk(3, 'Změna množství přepočte cenu', 'KV-6'), walk(4, 'Položka s nulou zmizí', 'KV-6', 'failed')],
  ide: { record: 'auto', wiki: 'auto', voice: false, topic: 'KV-7' },
  trace,
}

const chat = [
  { id: 'c1', role: 'user', text: trace[0].title, stage: 'ide', proposals: [], conflicts: [], createdAt: t(50) },
  { id: 'c2', role: 'agent', text: 'Rozdělím to na dva souběžné běhy: **web** (pole pro kód, výpočet a zobrazení slevy) a **api** (entita kódu a `POST /api/coupons/validate`). Kontrakt jsem doplnil na v3; testy napíše Tester, až budou obě části hotové.', stage: 'ide', proposals: [], conflicts: [], issueIds: ['KV-16', 'KV-17', 'KV-18'], createdAt: t(51) },
  { id: 'c3', role: 'user', text: trace[5].title, stage: 'ide', proposals: [], conflicts: [], createdAt: t(56) },
  { id: 'c4', role: 'agent', text: 'Doplnil jsem kritérium do KV-7 a FE vývojář to zapracuje v rámci KV-16.', stage: 'ide', proposals: [], conflicts: [], issueIds: [], createdAt: t(56) },
]

const files = {
  main: {
    'package.json': '{\n  "name": "kvasek-web",\n  "private": true,\n  "type": "module",\n  "scripts": { "dev": "vite", "build": "vite build" }\n}\n',
    'src/api.ts': "export const validateCoupon = (code: string) =>\n  fetch('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code }) }).then((r) => r.json())\n",
    'src/cart/Cart.tsx': `import { useState } from 'react'
import { useCart } from './useCart'
import { CouponField } from './CouponField'
import { applyCoupon, type Coupon } from './pricing'
import { Panel, Total } from '../ui'

export function Cart() {
  const { items, total } = useCart()
  const [coupon, setCoupon] = useState<Coupon | null>(null)
  const discounted = coupon ? applyCoupon(total, coupon) : total
  return (
    <Panel title="Košík">
      {items.map((item) => <CartRow key={item.id} item={item} />)}
      <CouponField onApply={setCoupon} />
      <Total value={discounted} before={coupon ? total : undefined} />
    </Panel>
  )
}
`,
    'src/cart/CouponField.tsx': "export function CouponField({ onApply }: { onApply: (c: Coupon) => void }) {\n  return <form>…</form>\n}\n",
    'src/catalog/Catalog.tsx': 'export function Catalog() {\n  return null\n}\n',
    'src/catalog/ProductDetail.tsx': 'export function ProductDetail() {\n  return null\n}\n',
    'e2e/cart.spec.ts': "import { test } from '@playwright/test'\n\ntest('[KV-6] změna množství přepočte cenu', async () => {})\n",
  },
  api: {
    'Program.cs': 'var app = WebApplication.CreateBuilder(args).Build();\napp.MapProducts();\napp.MapCart();\napp.MapCoupons();\napp.Run();\n',
    'Products/ProductEndpoints.cs': 'public static class ProductEndpoints { }\n',
    'Cart/CartEndpoints.cs': 'public static class CartEndpoints { }\n',
    'Coupons/Coupon.cs': 'public record Coupon(string Code, decimal Percent, decimal Amount, bool Used);\n',
  },
}

const write = (dir, rel, text) => { const f = join(dir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text) }
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Reactor', '-c', 'user.email=demo@reactor.invalid', ...args], { cwd, stdio: 'ignore' })
// The reviewed task's change is a real commit, so its diff opens like any other.
const before = { 'src/cart/Cart.tsx': files.main['src/cart/Cart.tsx'].replace("import { CouponField } from './CouponField'\n", '').replace("import { applyCoupon, type Coupon } from './pricing'\n", '')
  .replace("  const [coupon, setCoupon] = useState<Coupon | null>(null)\n  const discounted = coupon ? applyCoupon(total, coupon) : total\n", '').replace('      <CouponField onApply={setCoupon} />\n', '').replace('<Total value={discounted} before={coupon ? total : undefined} />', '<Total value={total} />'),
  'src/api.ts': '' }
const head = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim()
for (const [repo, list] of Object.entries(files)) {
  const dir = repo === 'main' ? join(root, 'workspace') : join(root, 'repos', repo)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  for (const [rel, text] of Object.entries(list)) if (repo !== 'main' || rel !== 'src/cart/CouponField.tsx') write(dir, rel, repo === 'main' && before[rel] !== undefined ? before[rel] : text)
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'Demo')
  if (repo !== 'main') continue
  const base = head(dir)
  for (const rel of [...Object.keys(before), 'src/cart/CouponField.tsx']) write(dir, rel, list[rel])
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'KV-16 Pole pro slevový kód a výpočet ceny')
  project.issues.find((i) => i.id === 'KV-16').commits = { base, head: head(dir) }
}
write(root, 'project.json', JSON.stringify(project, null, 1))
write(root, 'chat.json', JSON.stringify(chat))
console.log(root)
