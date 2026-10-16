// What the agent sees: the whole project model, the workspace layout, open annotations, the last test
// run and what the user is looking at. Built fresh for every request so it is never stale.
import type { ChatMessage, Project, Stage } from '@aforge/shared'
import { fileTree, flatPaths, readText } from './workspace.js'

export interface Focus {
  stage: Stage
  screenId?: string
  elementId?: string
  storyId?: string
  filePath?: string
}

export const CONSULTANT_SYSTEM = `Jsi aForge Agent – seniorní solution architekt, analytik a vývojář v softwarovém domě,
který staví webové aplikace (backend .NET / Node / Python, frontend React / Vue, hosting Azure Container Apps,
AKS, App Service nebo Static Web Apps na Ubuntu kontejnerech).

Pracuješ uvnitř platformy aForge. Projekt má fáze: design (wireframy), stories (user stories s akceptačními
kritérii), blocks (model bloků a vazeb), build (implementace agentem), code, preview (běh v kontejneru,
anotace uživatele) a tests (Playwright testy navázané na stories přes "[US-x]" v názvu).

Pravidla:
- Odpovídej česky, věcně a stručně (pole "reply", Markdown povolen).
- Projekt NIKDY neměníš přímo. Každou změnu navrhni jako položku v "proposals" složenou z operací "ops";
  uživatel ji přijme, nebo odmítne. Jeden návrh = jedna logická změna, ať jde přijímat po částech.
- Zachovávej existující id. Nové story mají id "US-<další číslo>", prvky wireframu "el-<krátký-slug>",
  obrazovky "screen-<slug>", bloky "blk-<slug>", vazby "edge-<slug>", návrhy "p-<slug>".
- U story.upsert / element.upsert / block.upsert posílej celý objekt (všechna pole), ne jen změny.
- Souřadnice prvků jsou v pixelech v rámci obrazovky (obvykle 1280×800). Bloky rozmísti do mřížky (x, y po ~260/140 px).
- "file.write" používej jen na malé cílené úpravy kódu a vždy s celým novým obsahem souboru.
  Větší změny implementace doporuč spustit přes fázi Build.
- Při každé odpovědi zkontroluj konzistenci: stories mezi sebou (duplicity, rozpory, chybějící kritéria),
  stories × wireframy (story bez obrazovky, prvek bez story), stories × bloky, otevřené anotace × stories,
  neúspěšné testy × stories. Nalezené problémy vrať v "conflicts" (error = rozpor, warning = mezera,
  info = doporučení) s id dotčených objektů v "refs". Pokud je vše v pořádku, vrať prázdné pole.
- Když uživatel jen něco chce vědět, "proposals" nech prázdné.`

const truncateNote = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}\n… [zkráceno: soubor má ${text.length} znaků, zobrazeno prvních ${max}]`

export const buildContext = async (project: Project, focus: Focus, chat: ChatMessage[]): Promise<string> => {
  const files = flatPaths(await fileTree(project.id))
  const model = {
    name: project.name,
    description: project.description,
    stack: project.stack,
    stories: project.stories,
    screens: project.screens,
    blocks: project.blocks,
    annotations: project.annotations.filter((a) => a.status !== 'resolved'),
    lastTestRun: project.testReport && {
      ok: project.testReport.ok,
      finishedAt: project.testReport.finishedAt,
      cases: project.testReport.cases.map((c) => ({ title: c.title, status: c.status, error: c.error?.slice(0, 600) })),
    },
  }
  let focused = ''
  if (focus.filePath) {
    try {
      focused = `\n<focused_file path="${focus.filePath}">\n${truncateNote(await readText(project.id, focus.filePath), 60_000)}\n</focused_file>`
    } catch {
      // The file may have been removed since the client opened it.
    }
  }
  const thread = chat
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'Uživatel' : 'Agent'} [${m.stage}]: ${m.text}`)
    .join('\n\n')
  return `<project_model>
${JSON.stringify(model, null, 1)}
</project_model>

<workspace_files count="${files.length}">
${files.slice(0, 600).join('\n')}${files.length > 600 ? `\n… a dalších ${files.length - 600} souborů` : ''}
</workspace_files>
${focused}
<focus>${JSON.stringify(focus)}</focus>

<conversation_so_far>
${thread || '(zatím žádná)'}
</conversation_so_far>`
}

/** Canned requests behind the toolbar buttons; they go through the same consultant contract. */
export const INTENTS: Record<string, string> = {
  check:
    'Proveď důkladnou kontrolu konzistence celého projektu (stories, wireframy, bloky, anotace, testy). Vrať všechny konflikty. Pro opravitelné problémy připrav návrhy.',
  stories:
    'Z popisu projektu, wireframů a anotací navrhni chybějící user stories s akceptačními kritérii ve formátu Given/When/Then. Každá story jako samostatný návrh.',
  blocks:
    'Převeď stories a wireframy na model bloků: stránky (page), komponenty (component), API endpointy (api), entity (entity), workflow kroky (workflow), integrace (integration) a joby (job) včetně vazeb (edges). Každý blok propoj se stories přes storyIds. Vrať jeden návrh s bloky a druhý s vazbami. Existující bloky aktualizuj, nezakládej duplicitně.',
  wireframes:
    'Navrhni wireframy pro stories, které zatím nemají obrazovku. Každá nová obrazovka jako samostatný návrh (screen.upsert s prvky).',
  annotations:
    'Zpracuj otevřené anotace z náhledu: ke každé posuď, zda odpovídá stories, navrhni úpravu stories a/nebo cílenou úpravu kódu a anotaci označ jako vyřešenou (annotation.resolve) v tomtéž návrhu.',
  tests:
    'Rozeber výsledky posledního běhu testů. U neúspěšných testů urči, zda je chyba v implementaci, v testu, nebo v zadání, a navrhni opravy.',
}
