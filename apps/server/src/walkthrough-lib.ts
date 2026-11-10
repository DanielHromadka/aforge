// Pure parts of walkthroughs (recorded click-throughs of the running app): naming, the agent prompt, the
// files Reactor itself keeps in e2e/, and reading Playwright's JSON report. No I/O, so it is unit-tested.
import { activeAttachments, attachmentWorkspacePath, markdownForAgents, type Project, type Walkthrough } from '@aforge/shared'

const attachmentPrompt = (p: Project) => activeAttachments(p).length
  ? `\nPodklady zadání jsou dostupné v repozitáři (podle potřeby je přečti):\n${activeAttachments(p).map((a) => `- ${a.name}: ${attachmentWorkspacePath(a)}`).join('\n')}\n` : ''

export const WALKTHROUGH_DIR = 'e2e/walkthroughs'
export const WALKTHROUGH_CONFIG = 'e2e/walkthrough.config.ts'
export const CURSOR_HELPER = `${WALKTHROUGH_DIR}/_cursor.ts`

const SCRIPT_RE = /^e2e\/walkthroughs\/([a-z0-9-]{1,60})\.spec\.ts$/

const slugify = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/, '')

/** "/rezervace" + "formulář nové rezervace" → "rezervace-formular-nove-rezervace", unique among `taken` slugs. */
export const walkthroughSlug = (route: string, section: string, taken: string[]): string => {
  const base = slugify(`${route} ${section}`) || 'pruchod'
  let slug = base
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`
  return slug
}

/** The slug of a script path, or null when the path is not one of ours – it ends up in a container command. */
export const scriptSlug = (script: string): string | null => SCRIPT_RE.exec(script)?.[1] ?? null

/** Recordings are served by name, so only plain names like "wt-1a2b3c4d.webm" are accepted. */
export const isVideoFile = (name: string) => /^[\w-]{1,80}\.webm$/.test(name)

/** One HTTP byte range ("bytes=0-", "bytes=10-20", "bytes=-500") within `size`; null when unsatisfiable. */
export const parseRange = (header: string, size: number): { start: number; end: number } | null => {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2]) || size <= 0) return null
  let start: number
  let end: number
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start <= end && start < size ? { start, end } : null
}

interface PwResult {
  status: string
  error?: { message?: string }
  errors?: { message?: string }[]
  attachments?: { name: string; path?: string; contentType: string }[]
}
interface PwSuite {
  specs?: { tests: { results: PwResult[] }[] }[]
  suites?: PwSuite[]
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

/** Outcome of a walkthrough run: did the script pass, and where the video is (relative to the workspace). */
export const parseWalkthroughReport = (json: { suites?: PwSuite[]; errors?: { message?: string }[] }): { ok: boolean; video?: string; error?: string } => {
  const results: PwResult[] = []
  const walk = (s: PwSuite) => {
    for (const spec of s.specs ?? []) for (const t of spec.tests) if (t.results.at(-1)) results.push(t.results.at(-1)!)
    s.suites?.forEach(walk)
  }
  json.suites?.forEach(walk)
  const last = results[0]
  if (!last) return { ok: false, error: stripAnsi(json.errors?.[0]?.message ?? 'Skript neobsahuje žádný test.').slice(0, 2000) }
  const video = last.attachments?.find((a) => a.contentType === 'video/webm' && a.path)?.path
  const message = last.error?.message ?? last.errors?.[0]?.message
  return {
    ok: last.status === 'passed',
    // Paths in the report are the container's; the workspace is mounted at /workspace.
    video: video?.startsWith('/workspace/') && !video.includes('..') ? video.slice('/workspace/'.length) : undefined,
    error: last.status === 'passed' ? undefined : stripAnsi(message ?? `Stav: ${last.status}`).slice(0, 2000),
  }
}

/** Playwright config for recordings only; the normal suite never loads it. */
export const walkthroughConfig = `// Spravuje Reactor: nahrávání průchodů aplikací (video), odděleně od testů.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './walkthroughs',
  outputDir: '../.aforge/walkthrough-output',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL,
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } }],
})
`

/** Helpers the generated scripts import; Playwright's own pointer is invisible in videos, so we draw one. */
export const cursorHelper = `// Spravuje Reactor: viditelný kurzor a zvýraznění pro videa průchodů.
import type { Locator, Page } from '@playwright/test'

export const PAUSE = 600

export const pause = (page: Page, ms = PAUSE) => page.waitForTimeout(ms)

/** Call before page.goto: draws a cursor that follows the mouse and shrinks on click. */
export const installCursor = (page: Page) =>
  page.addInitScript(() => {
    const add = () => {
      if (document.getElementById('__aforge_cursor')) return
      const c = document.createElement('div')
      c.id = '__aforge_cursor'
      c.style.cssText =
        'position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
        'background:rgba(255,59,48,.3);border:2px solid #ff3b30;box-shadow:0 0 0 4px rgba(255,59,48,.15);' +
        'z-index:2147483647;pointer-events:none;transition:transform .12s ease'
      document.documentElement.appendChild(c)
      document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
      document.addEventListener('mousedown', () => { c.style.transform = 'scale(.65)' }, true)
      document.addEventListener('mouseup', () => { c.style.transform = '' }, true)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add)
    else add()
  })

/** Briefly outlines an element so the viewer sees what is being shown. */
export const highlight = (target: Locator, ms = 1200) =>
  target.evaluate((el, ms) => {
    const s = (el as HTMLElement).style
    const prev = [s.outline, s.outlineOffset]
    s.outline = '3px solid #ff3b30'
    s.outlineOffset = '2px'
    setTimeout(() => { s.outline = prev[0]; s.outlineOffset = prev[1] }, ms)
  }, ms)

/** Scrolls smoothly until the section sits in the middle of the viewport, then outlines it. */
export const showSection = async (page: Page, section: Locator) => {
  await section.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  await pause(page, 900)
  await highlight(section, 1800)
  await pause(page, 1200)
}

/** Glides the cursor onto the element (which hovers it) and outlines it. */
export const pointAt = async (page: Page, target: Locator) => {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
  await highlight(target)
  await pause(page)
}

export const clickOn = async (page: Page, target: Locator) => {
  await pointAt(page, target)
  await target.click()
  await pause(page)
}

/** Types like a person, so the video shows the text appearing. */
export const typeInto = async (page: Page, target: Locator, text: string) => {
  await pointAt(page, target)
  await target.click()
  await target.fill('')
  await target.pressSequentially(text, { delay: 45 })
  await pause(page)
}
`

const SAFE_HELPERS = 'installCursor, showSection, pointAt, clickOn, typeInto, pause'

/** The precise brief for the implementing agent: write one script, nothing else. */
export const walkthroughPrompt = (w: Walkthrough, project: Project): string => {
  const stories = project.stories.filter((s) => w.storyIds.includes(s.id))
  const tags = w.storyIds.map((id) => `[${id}]`).join(' ')
  const title = `${tags ? `${tags} ` : ''}Průchod: ${w.section.replace(/['\\\n]/g, ' ').slice(0, 80)} @walkthrough`
  return `Napiš Playwright skript, který nahraje video průchodu jednou sekcí běžící aplikace v tomto adresáři.

Cíl
- Stránka (route): ${w.route}
${attachmentPrompt(project)}
- Sekce: ${w.section}
  (Pokud jde o CSS selektor, použij page.locator s ním. Pokud je to slovní popis, najdi sekci ve zdrojovém kódu frontendu
  a vyber pro ni stabilní lokátor – role/název, label, nadpis, data-testid; zdroják NEMĚŇ.)
${stories.length ? `- Související stories:\n${stories.map((s) => `  - ${s.id}: ${s.title} – jako ${s.asA} chci ${s.iWant}, abych ${s.soThat}\n${markdownForAgents(project, s.description ?? '')}`).join('\n')}\n` : ''}${w.instructions.trim() ? `- Doplňující pokyny uživatele: ${w.instructions.trim()}\n` : ''}
Pravidla (povinná)
1. Vytvoř nebo přepiš JEN soubor \`${w.script}\`. Žádný jiný soubor neměň ani nevytvářej. Skript nespouštěj –
   aplikace běží v kontejneru a Reactor ho spustí sám (config \`${WALKTHROUGH_CONFIG}\`, baseURL je nastavená).
2. Importy: \`import { test } from '@playwright/test'\` a \`import { ${SAFE_HELPERS} } from './_cursor'\`
   (soubor \`${CURSOR_HELPER}\` už existuje – přečti si ho, neměň ho). Na pohyb a kliky používej jen tyto helpery,
   ať jsou kliky ve videu vidět (kurzor, zvýraznění, pauzy ~600 ms).
3. Přesně jeden test s názvem \`'${title}'\` (tag @walkthrough musí zůstat, odděluje průchod od testů).
4. Postup: \`await installCursor(page)\` PŘED \`page.goto('${w.route}')\`, pak \`await page.waitForLoadState('networkidle')\`,
   najdi sekci, \`await showSection(page, sekce)\` a projdi její interaktivní prvky jeden po druhém v pořadí, jak jdou
   vizuálně (shora dolů, zleva doprava): tlačítka, odkazy, záložky, přepínače, checkboxy, selecty, textová pole.
   - textová pole: \`typeInto\` s realistickými českými ukázkovými daty (jméno Jana Nováková, e-mail jana.novakova@example.cz,
     telefon +420 601 234 567, datum v budoucnu ve formátu, který pole čeká, smysluplné poznámky),
   - selecty: \`pointAt\` a pak \`selectOption\` s rozumnou hodnotou, checkboxy/přepínače: \`clickOn\`,
   - bezpečná tlačítka, záložky a rozbalovací prvky: \`clickOn\`; když se otevře dialog nebo menu, ukaž jeho obsah
     (\`pointAt\` na hlavní prvky) a zavři ho (Escape nebo tlačítko Zavřít/Zrušit), než budeš pokračovat.
5. NIKDY neklikej na destruktivní ani odesílací akce – Smazat, Odstranit, Odeslat, Uložit, Potvrdit, Zaplatit,
   Objednat, Odhlásit, tlačítka type=submit, odkazy, které odvedou pryč ze stránky – pokud to výslovně nepovolují
   doplňující pokyny výše. Na takové prvky jen najeď \`pointAt\`.
6. Robustnost: lokátory vždy v rámci sekce (\`sekce.getByRole(…)\`, \`sekce.getByLabel(…)\`), nepovinné prvky obal
   \`if (await loc.count())\` a u seznamů vezmi \`.first()\`. Žádné \`expect\` kromě toho, že je sekce viditelná, žádné
   pevné čekání delší než 1500 ms, celý průchod do ~90 sekund.
7. Na konci \`await pause(page, 1500)\`, ať video nekončí uprostřed akce.

Na konci stručně napiš, které prvky skript prochází a které jen ukazuje.`
}

/** The brief for one agent run writing the scripts of several tests: they perform a scenario and verify it. */
export const testScriptsPrompt = (tests: Walkthrough[], project: Project): string => {
  const brief = (w: Walkthrough, n: number) => {
    const stories = project.stories.filter((s) => w.storyIds.includes(s.id))
    const tags = w.storyIds.map((id) => `[${id}]`).join(' ')
    const name = `${tags ? `${tags} ` : ''}${(w.title ?? w.section).replace(/['\\\n]/g, ' ').slice(0, 90)} @walkthrough`
    return `${n}. Soubor \`${w.script}\`, test \`'${name}'\`
   - Stránka (route): ${w.route}
   - Sekce: ${w.section}
${stories.map((s) => `   - Story ${s.id}: ${s.title}\n${markdownForAgents(project, s.description ?? '')}\n${s.acceptance.map((a) => `     - ${a}`).join('\n')}`).join('\n')}
   - Scénář a očekávaný výsledek: ${w.instructions.trim() || 'ověř kritéria story výše'}`
  }
  return `Napiš automatické testy běžící aplikace v tomto adresáři jako Playwright skripty, které se nahrávají na video.

Testy
${tests.map((w, i) => brief(w, i + 1)).join('\n\n')}
${attachmentPrompt(project)}

Pravidla (povinná)
1. Vytvoř nebo přepiš JEN soubory uvedené výše. Nic jiného neměň. Skripty nespouštěj – aplikace běží v kontejneru
   a Reactor je spustí sám (config \`${WALKTHROUGH_CONFIG}\`, baseURL je nastavená).
2. Importy: \`import { test, expect } from '@playwright/test'\` a \`import { ${SAFE_HELPERS} } from './_cursor'\`
   (soubor \`${CURSOR_HELPER}\` už existuje – přečti si ho, neměň ho). Na pohyb, kliky a psaní používej tyto helpery,
   ať je scénář ve videu vidět.
3. V každém souboru přesně jeden test s uvedeným názvem (tag @walkthrough nech, odděluje nahrávané testy od sady e2e).
4. Postup: \`await installCursor(page)\` PŘED \`page.goto(route)\`, pak \`await page.waitForLoadState('networkidle')\`,
   najdi sekci (CSS selektor, nebo podle popisu stabilní lokátor ze zdrojáku frontendu; zdroják NEMĚŇ),
   \`await showSection(page, sekce)\` a proveď scénář krok za krokem: \`typeInto\` s realistickými českými daty,
   \`clickOn\`, \`pointAt\` + \`selectOption\`. Formuláře odesílej a data vytvářej, když to scénář potřebuje –
   běží to proti testovací instanci.
5. Ověření: \`expect\` (toBeVisible, toHaveText, toContainText, toHaveCount, toBeDisabled…) přesně podle očekávaného
   výsledku. Test musí selhat, když aplikace kritérium nesplňuje. Neověřuj nic, co scénář neříká.
6. Robustnost: role a label lokátory v rámci sekce, žádné pevné čekání delší než 1500 ms, celý test do ~90 sekund.
7. Na konci \`await pause(page, 1500)\`, ať video nekončí uprostřed akce.

Na konci stručně napiš, co který test ověřuje.`
}
