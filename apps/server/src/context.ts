// What the agent sees: the whole project model, the workspace layout, open annotations, the last test
// run and what the user is looking at. Built fresh for every request so it is never stale.
import { sectionPromptsOf, designOutline, nextKeys, reposOf, type ChatMessage, type Project, type PromptSection, type Stage } from '@aforge/shared'
import { fileTree, flatPaths, readText } from './workspace.js'
import { attachmentContext } from './attachments.js'

export interface Focus {
  stepId?: string
  stage: Stage
  screenId?: string
  elementId?: string
  storyId?: string
  filePath?: string
  /** Repository of the focused file; the workspace when absent. */
  repo?: string
  /** The thread belongs to this story or issue. */
  anchor?: string
}

export const CONSULTANT_SYSTEM = `Jsi Reactor Agent – seniorní solution architekt, analytik a vývojář v softwarovém domě,
který vyvíjí webové, mobilní i desktopové aplikace, backendy a knihovny.

Pracuješ uvnitř platformy Reactor. Práce je řazená jako v Jiře: epic → story (s akceptačními kritérii) → task a bug
(a sub-task). Klíče mají tvar <KLÍČ>-<číslo>, např. RZ-12, a sdílejí jedno číslování. Task má vrstvu (fe, be, api,
test, other) a repozitář projektu; každý repozitář má platformu (web, mobile, desktop, backend, library) a svého
agenta. Repozitáře spojuje API kontrakt (OpenAPI). Tok: design (z Figmy) → stories → rozpad na tasky
(Architekt) → implementace (agent na repozitář) → náhled (anotace) → testy (navázané na stories přes "[KLÍČ-n]"
v názvu; selhaný test založí bug) → wiki pro lidi (Dokumentarista).

Pravidla:
- Odpovídej česky, věcně a stručně (pole "reply", Markdown povolen).
- Projekt NIKDY neměníš přímo. Každou změnu navrhni jako položku v "proposals" složenou z operací "ops";
  uživatel ji přijme, nebo odmítne. Jeden návrh = jedna logická změna, ať jde přijímat po částech.
- Zachovávej existující id. Nové epicy a story dostanou další volný klíč projektu (viz nextKey v modelu),
  nové tasky a bugy přes "issue.upsert" s id "new", diagramy "dg-<slug>", návrhy "p-<slug>".
- Zadání projektu (description) a prompty sekcí (prompts) jsou pokyny uživatele – mají přednost před tvými
  předpoklady. Stack se nevybírá ručně: vychází ze zadání, jinak z architektury (architecture.stack).
- Design (obrazovky = rámce, prvky = vrstvy) vzniká jen ve Figmě a do Reactoru se synchronizuje. Obrazovky ani
  prvky nezakládej, neměň ani nemaž – design úpravy doporuč slovně (udělají se ve Figmě). K existujícímu
  prvku smíš přes "element.annotate" doplnit poznámku (chování, validace, data), vazbu na stories a příznak
  "work" (true = na prvku se pracuje, má přednost v dalším buildu). V kontextu vidíš horní vrstvy rámců
  a všechny anotované prvky; "work": true jsou prvky, na kterých uživatel právě chce pracovat.
- U story.upsert / diagram.upsert posílej celý objekt (všechna pole), ne jen změny. Diagram je zdroj Mermaid
  odpovídající jeho typu (flowchart / sequence / state / er / class) a ke každému kroku má logický popis.
- "file.write" používej jen na malé cílené úpravy kódu a vždy s celým novým obsahem souboru.
  Větší změny implementace doporuč spustit přes fázi Build.
- Při každé odpovědi zkontroluj konzistenci: stories mezi sebou (duplicity, rozpory, chybějící kritéria),
  stories × design (story bez obrazovky, rozpracovaný prvek bez story), stories × architektura, otevřené anotace × stories,
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
    prompts: sectionPromptsOf(project),
    workflow: project.workflow && { preset: project.workflow.preset, steps: project.workflow.steps },
    activeWorkflowStep: project.workflow?.steps.find((s) => s.id === focus.stepId),
    implementingAgent: project.stack.agent,
    key: project.key,
    nextKey: nextKeys(project)[0],
    repos: reposOf(project),
    epics: project.epics,
    stories: project.stories,
    attachments: await attachmentContext(project),
    tests: (project.walkthroughs ?? []).map(({ id, title, section, route, instructions, storyIds, status }) => ({ id, title, section, route, instructions, storyIds, status })),
    issues: (project.issues ?? []).map(({ files, ...i }) => ({ ...i, files: files.map((f) => f.path) })),
    contract: project.contract && { version: project.contract.version, status: project.contract.status, yaml: project.contract.yaml.slice(0, 20_000) },
    wiki: (project.wiki ?? []).map((w) => ({ id: w.id, title: w.title, updatedAt: w.updatedAt })),
    figma: project.figma,
    screens: project.screens.map(({ elements, image: _image, ...screen }) => ({
      ...screen,
      layers: elements.length,
      elements: designOutline({ ...screen, elements }).map(({ figmaId: _f, ...e }) => e),
    })),
    architecture: project.architecture,
    buildPlan: project.buildPlan,
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
      focused = `\n<focused_file path="${focus.filePath}">\n${truncateNote(await readText(project.id, focus.filePath, focus.repo && focus.repo !== 'main' && reposOf(project).some((r) => r.id === focus.repo) ? focus.repo : undefined), 60_000)}\n</focused_file>`
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

export const SECTION_LABEL: Record<PromptSection, string> = {
  prompt: 'Prompt',
  design: 'Design',
  stories: 'Stories',
  split: 'Rozpad na tasky',
  wiki: 'Wiki',
  blocks: 'Build › Bloky',
  plan: 'Build › Implementační prompt',
  code: 'Kód',
  preview: 'Náhled',
  tests: 'Testy',
}

/** What the runtime can run; the agent chooses a stack inside it. */
export const RUNTIME = `kontejner aforge-runtime (Ubuntu 24.04, Node 22, .NET 8 SDK, Python 3, Nginx): jeden kontejner,
frontend jako statický build za Nginx, backend na portu 5000 za /api/, databáze jen vestavěná (SQLite, soubor nebo
v paměti) – externí služby (Postgres, Redis…) v běhu nejsou`

/** Canned requests behind the toolbar buttons; they go through the same consultant contract. */
export const INTENTS: Record<string, string> = {
  check:
    'Proveď důkladnou kontrolu konzistence celého projektu (zadání, stories, design, architektura, anotace, testy). Vrať všechny konflikty. Pro opravitelné problémy připrav návrhy.',
  stories:
    'Z popisu projektu, designu z Figmy a anotací navrhni chybějící user stories s akceptačními kritérii ve formátu Given/When/Then. Každá story jako samostatný návrh.',
  blocks:
    'Navrhni nebo aktualizuj architekturu jako diagramy Mermaid (diagram.upsert): celek FE/BE/DB jako flowchart, hlavní průběhy jako sequence, stavová workflow jako state, data jako er. Ke každému kroku logický popis a vazba na stories.',
  design:
    'Projdi design synchronizovaný z Figmy. K obrazovkám přiřaď stories (screenIds v story.upsert), ke klíčovým prvkům doplň poznámky a vazby na stories (element.annotate). Upozorni na stories bez obrazovky, obrazovky bez stories a na to, co v designu chybí – to se doplní ve Figmě.',
  annotations:
    'Zpracuj otevřené anotace z náhledu: ke každé posuď, zda odpovídá stories, navrhni úpravu stories a/nebo cílenou úpravu kódu a anotaci označ jako vyřešenou (annotation.resolve) v tomtéž návrhu.',
  tests:
    'Rozeber výsledky posledního běhu testů. U neúspěšných testů urči, zda je chyba v implementaci, v testu, nebo v zadání, a navrhni opravy.',
  story:
    'Projdi vybranou story: jsou kritéria úplná a testovatelná, sedí na design, chybí rozpad nebo jsou otevřené bugy? Navrhni úpravy.',
}
