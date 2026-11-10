// The steps of the workflow that Claude writes outright (not as proposals): stories from the brief and the
// design, the architecture as Mermaid diagrams, and the refined implementation prompt with the planned code
// changes. Each step reads the brief, every section prompt (its own first) and the project, and its result
// replaces that part of the project – the user edits or regenerates it there.
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { prepareStoryReview, storyReviewBlock, StoryReviewResultSchema } from '@aforge/shared'
import { sectionPromptsOf, workflowInstructions, nextKeys, reposOf, usedKeys, ArchitectureSchema, BuildPlanSchema, EpicSchema, LAYERS, PROMPT_SECTIONS, StorySchema, type AgentRole, type Issue, type Project, type PromptSection, type Stage, type WikiPage } from '@aforge/shared'
import { structured } from './agents.js'
import { buildContext, RUNTIME, SECTION_LABEL } from './context.js'
import { publish } from './events.js'
import { loadChat, loadProject, mutateProject } from './store.js'

export const GENERATE_STEPS = ['stories', 'reorganize', 'split', 'blocks', 'plan', 'wiki'] as const
export type GenerateStep = (typeof GENERATE_STEPS)[number]

const SYSTEM = `Jsi Reactor Agent – člen vývojového týmu (analytik, architekt nebo dokumentarista podle úkolu). Připravuješ
podklady pro jeden krok workflow Reactor: Design (z Figmy) → Stories (epicy a user stories jako v Jiře) → Rozpad
(tasky FE / BE / API / testy do repozitářů projektu a API kontrakt) → Implementace (agent na repozitář) → Náhled →
Testy → Wiki pro lidi. Projekt může mít repozitáře pro web, mobil, desktop, backend nebo knihovnu.

Pravidla:
- Piš česky (kromě kódu, cest a zdrojů Mermaid).
- Zadání projektu a prompty sekcí jsou pokyny uživatele a mají přednost. Prompt právě generované sekce je nejdůležitější.
- Design je ve Figmě: obrazovky = rámce, prvky = vrstvy. Prvky s "work": true jsou ty, na kterých se právě pracuje.
- Stack se nevybírá ručně. Když ho zadání nebo prompty určují, drž se jich. Jinak zvol nejjednodušší vhodný stack,
  který zvládne běhové prostředí: ${RUNTIME}.
- Navazuj na to, co v projektu už je (stories, diagramy, soubory v repozitáři) – nic zbytečně nepřepisuj.`

const TASK: Record<GenerateStep, string> = {
  reorganize: `Jako Analytik proveď revizi backlogu před implementací. Měnit smíš pouze stories uvedené v
<stories_k_revizi>; ostatní jsou jen kontext, abys neduplikoval již existující funkce. Každou vybranou story zařaď
právě do jedné skupiny, i když ji doporučíš ponechat (kind keep). Skupiny jsou nezávislé a schvalují se jednotlivě.
Posuzuj celý obsah, uživatelský cíl, kritéria, závislosti, design a rozpad. Podobná slova sama nestačí ke sloučení.
Rozděluj podle samostatně dodávatelných uživatelských výsledků, nikoli FE/BE vrstev. Nepřidávej nové požadavky.
kind merge = více stories do jedné, split = jedna do více, reshape = související sloučení i rozdělení jako celek,
move = přesun do existujícího epicu, clarify = upřesnění, keep = beze změny (přesná kopie vstupního obsahu).
Ve stories uveď úplné výsledné zadání i kritéria, existující epicId nebo prázdný řetězec. Zachovej vazby screenIds.
Pro KAŽDÉ původní kritérium vrať v coverage sourceId, criterion (index od 0), target (index výsledné story od 0),
targetCriterion (index výsledného kritéria od 0) a note, jak se zachovává. Duplicity mapuj na společné výsledné
kritérium a zdůvodni to v note. Žádný původní požadavek nesmí zmizet. Uveď konkrétní rationale pro každou skupinu.
Zachovej také informace z podrobných popisů (description v Markdownu), HTML a odkazy attachment: na přílohy;
výsledný podrobný popis patří do description. Existující rozpad se po změně uchová v historii; výsledné stories se budou rozpadat znovu.`,
  stories: `Jako Analytik vytvoř úplný seznam epiců (pole "epics") a user stories (pole "stories"). Epic seskupuje
stories jedné oblasti, typicky jedné stránky nebo části designu. Existující epicy a stories zachovej i s klíči a doplň
nebo uprav jen to, co ze zadání, promptů a designu plyne. Nové epicy a stories dostanou další volné klíče projektu
v pořadí (první volný je v modelu jako nextKey). Každá story má epicId, akceptační kritéria ve tvaru Given/When/Then
a v screenIds obrazovky z designu. Do "notes" stručně napiš, co jsi změnil a co v zadání chybí nebo je nejasné.`,
  split: `Jako Architekt rozpadni stories z <stories_k_rozpadu> na tasky do repozitářů projektu (pole "tasks").
Každý task je jedna ucelená práce jednoho agenta v jednom repozitáři: layer "fe" (klient: web, mobil, desktop),
"be" (backend), "other" (build, konfigurace). Klient a backend jsou
samostatné tasky, i když jsou ve stejném repozitáři. Testy nepřidávej – navrhuje je Tester v kroku Testy. V repoId použij id
existujícího repozitáře podle platformy. V "description" napiš konkrétně, co postavit, které obrazovky a kritéria
pokrývá a jaké soubory nebo moduly se změní.
Do "contract" dej úplný API kontrakt projektu jako OpenAPI 3.1 YAML (všechny endpointy, i stávající), když klient
s backendem komunikuje; jinak prázdný řetězec. Existující kontrakt aktualizuj, nepiš ho od nuly.`,
  blocks: `Navrhni architekturu aplikace. Urči stack (frontend, backend, databáze; "–" pro část, která není potřeba)
a zdůvodni ho. Pak diagramy v Mermaid podle potřeby – pro každou věc správný typ:
- flowchart TD: části aplikace (FE stránky a komponenty, BE endpointy, DB, integrace) a jejich vazby – vždy jeden,
- sequenceDiagram: průběh hlavních požadavků a uživatelských toků (FE → BE → DB),
- stateDiagram-v2: workflow se stavy (schvalování, objednávka…), jen když v zadání je,
- erDiagram: datový model, jen když se data ukládají.
Ke každému diagramu popis a pro každý jeho krok, uzel nebo stav logický popis (vstupy, co dělá, výstupy, chyby).
Mermaid musí být syntakticky platný: id uzlů bez mezer a diakritiky, popisky v uvozovkách, bez code fences.
Existující diagramy aktualizuj se stejným id.`,
  plan: `Sestav zpřesněný implementační prompt pro Claude Code / Codex (pole "prompt", Markdown) z promptu této sekce,
zadání projektu, designu, user stories a architektury. Má být samostatný a konkrétní: cíl, stack, co přesně
postavit pro každou story a obrazovku (komponenty, stav, volání API), API kontrakt (metody, cesty, tvar dat
s příkladem), data a jejich zdroj, akceptační kritéria a co se nemá měnit. Repozitář už může obsahovat aplikaci –
pak popiš jen změny. Do "changes" vypiš soubory, které se reálně vytvoří, upraví nebo smažou, s důvodem.
Běhový kontrakt (.aforge/start.sh, .aforge/nginx.conf, e2e/) doplní Reactor sám – soubory podle něj ale do
"changes" patří.`,
  wiki: `Jako Dokumentarista aktualizuj wiki aplikace pro lidi, kteří ji používají (pole "pages"). Jedna stránka
"about" (co aplikace je a pro koho, hlavní části) a jedna na každý epic s hotovými nebo ověřenými stories (id = klíč
epicu). Piš česky, krátce a srozumitelně, bez technických detailů: první odstavec co funkce umí, pak "## Jak na to"
(číslovaný postup) a "## Pravidla" (odrážky z akceptačních kritérií). Popisuj jen to, co je implementované a ověřené
testy. Existující stránky uprav, nepřepisuj zbytečně. Do "changes" krátce vyjmenuj, co se oproti současné verzi
mění; stránku bez změn vynech. Do "sources" klíče stories a bugů, ze kterých jsi vycházel.`,
}

const SplitSchema = z.object({
  contract: z.string().describe('OpenAPI 3.1 YAML of the whole API, or "" when there is none'),
  tasks: z.array(z.object({
    storyId: z.string(),
    title: z.string().describe('Short imperative title in Czech'),
    description: z.string().describe('What exactly to build, in Czech, Markdown'),
    layer: z.enum(LAYERS),
    repoId: z.string(),
  })),
  notes: z.string(),
})
const WikiSchema = z.object({
  pages: z.array(z.object({
    id: z.string().describe('"about" or the epic key'),
    title: z.string(),
    body: z.string().describe('Markdown for people, in Czech'),
    changes: z.array(z.string()).describe('What changes against the current page, in Czech'),
    sources: z.array(z.string()),
  })),
})

const SCHEMA = {
  reorganize: StoryReviewResultSchema,
  stories: z.object({ epics: z.array(EpicSchema), stories: z.array(StorySchema), notes: z.string() }),
  split: SplitSchema,
  blocks: ArchitectureSchema,
  plan: BuildPlanSchema,
  wiki: WikiSchema,
} as const

const STAGE: Record<GenerateStep, Stage> = { stories: 'stories', reorganize: 'stories', split: 'split', blocks: 'split', plan: 'split', wiki: 'wiki' }
const ROLE: Record<GenerateStep, AgentRole> = { stories: 'analyst', reorganize: 'analyst', split: 'architect', blocks: 'architect', plan: 'architect', wiki: 'writer' }

/** Keys the agent invented or reused are replaced by free ones, and story references follow them. */
export const fixKeys = (project: Project, epics: z.infer<typeof EpicSchema>[], stories: z.infer<typeof StorySchema>[]) => {
  const prefix = `${project.key}-`
  const own = new Set([...(project.epics ?? []).map((e) => e.id), ...project.stories.map((s) => s.id)])
  const taken = new Set(usedKeys(project))
  const number = (id: string) => (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? Number(id.slice(prefix.length)) : 0)
  const all = [...epics, ...stories]
  const kept = new Set<string>()
  for (const x of all) if (!kept.has(x.id) && (own.has(x.id) || (number(x.id) > 0 && !taken.has(x.id)))) kept.add(x.id)
  let n = Math.max(0, ...[...taken, ...kept].map(number))
  const renamed = new Map<string, string>()
  const used = new Set<string>()
  const keyOf = (id: string) => {
    if (kept.has(id) && !used.has(id)) { used.add(id); return id }
    const next = `${prefix}${++n}`
    renamed.set(id, next)
    return next
  }
  const outEpics = epics.map((e) => ({ ...e, id: keyOf(e.id) }))
  return {
    epics: outEpics,
    stories: stories.map((st) => ({ ...st, id: keyOf(st.id), epicId: st.epicId ? renamed.get(st.epicId) ?? st.epicId : undefined })),
  }
}

/** The brief and every non-empty section prompt, the one being generated first. */
export const userPrompts = (project: Project, first: PromptSection): string => {
  const order = [first, ...PROMPT_SECTIONS.filter((s) => s !== first)]
  const sections = order
    .map((s) => [s, sectionPromptsOf(project)[s]?.trim()] as const)
    .filter(([s, text]) => text || s === first)
    .map(([s, text]) => `<prompt_sekce sekce="${SECTION_LABEL[s]}"${s === first ? ' generovana="ano"' : ''}>\n${text || '(prázdný)'}\n</prompt_sekce>`)
  return `<zadani_projektu>\n${project.description.trim() || '(prázdné)'}\n</zadani_projektu>\n\n${sections.join('\n\n')}\n\n<workflow_prompts>\n${workflowInstructions(project)}\n</workflow_prompts>`
}

/** Stories a breakdown covers: the asked ones, otherwise those without tasks yet. */
export const splitTargets = (project: Project, storyIds?: string[]) =>
  project.stories.filter((s) => storyIds?.length ? storyIds.includes(s.id) : !(project.issues ?? []).some((i) => i.storyId === s.id && i.type !== 'bug'))

/** The part of the project a step replaces; story statuses belong to builds and tests, so they stay. */
export const patchOf = (project: Project, step: GenerateStep, result: unknown, storyIds?: string[]): Partial<Project> => {
  const generatedAt = new Date().toISOString()
  if (step === 'reorganize') {
    const ids = project.stories.filter((s) => (!storyIds || storyIds.includes(s.id)) && !storyReviewBlock(project, s)).map((s) => s.id)
    const review = prepareStoryReview(project, result, ids, randomUUID(), generatedAt)
    return { storyReviews: [...(project.storyReviews ?? []), review] }
  }
  if (step === 'stories') {
    const status = new Map(project.stories.map((s) => [s.id, s.status]))
    const r = result as z.infer<typeof SCHEMA.stories>
    const fixed = fixKeys(project, r.epics, r.stories)
    return { epics: fixed.epics, stories: fixed.stories.map((s) => {
      const old = project.stories.find((old) => old.id === s.id)
      return { ...s, status: status.get(s.id) ?? s.status, ...(s.description === undefined && old?.description !== undefined ? { description: old.description } : {}) }
    }) }
  }
  if (step === 'split') {
    const r = result as z.infer<typeof SplitSchema>
    const targets = new Set(splitTargets(project, storyIds).map((s) => s.id))
    const repos = reposOf(project)
    // A new breakdown replaces the unapproved one of the same stories; approved work stays.
    const kept = (project.issues ?? []).filter((i) => !(i.status === 'proposed' && i.storyId && targets.has(i.storyId)))
    const tasks = r.tasks.filter((t) => targets.has(t.storyId))
    const keys = nextKeys({ ...project, issues: kept }, tasks.length)
    const issues: Issue[] = tasks.map((t, n) => ({
      id: keys[n]!, type: 'task', storyId: t.storyId, title: t.title, description: t.description, layer: t.layer,
      repoId: repos.some((x) => x.id === t.repoId) ? t.repoId : repos[0]!.id, status: 'proposed', source: 'breakdown', files: [], createdAt: generatedAt, updatedAt: generatedAt,
    }))
    const yaml = r.contract.trim()
    const contract = yaml && yaml !== project.contract?.yaml.trim()
      ? { yaml, version: project.contract?.version ?? 0, status: 'proposed' as const, updatedAt: generatedAt }
      : project.contract
    return { issues: [...kept, ...issues], ...(contract ? { contract } : {}) }
  }
  if (step === 'wiki') {
    const pages = new Map((project.wiki ?? []).map((w) => [w.id, w]))
    for (const page of (result as z.infer<typeof WikiSchema>).pages) {
      if (!page.changes.length) continue
      const old: WikiPage = pages.get(page.id) ?? { id: page.id, title: page.title, body: '', updatedAt: generatedAt, sources: [], history: [] }
      pages.set(page.id, { ...old, draft: { title: page.title, body: page.body, changes: page.changes, sources: page.sources, createdAt: generatedAt } })
    }
    return { wiki: [...pages.values()] }
  }
  if (step === 'blocks') return { architecture: { ...(result as z.infer<typeof ArchitectureSchema>), generatedAt } }
  return { buildPlan: { ...(result as z.infer<typeof BuildPlanSchema>), generatedAt } }
}

const running = new Map<string, GenerateStep>()

export const generationStep = (projectId: string) => running.get(projectId)

export const isGenerating = (projectId: string) => running.has(projectId)

export const generate = async (projectId: string, step: GenerateStep, storyIds?: string[]): Promise<{ patch: Partial<Project>; notes?: string }> => {
  if (running.has(projectId)) throw new Error('Agent už jeden krok připravuje, počkejte na něj.')
  running.set(projectId, step)
  publish(projectId, 'generate', 'start', step)
  try {
    const project = await loadProject(projectId)
    const context = await buildContext(project, { stage: STAGE[step] }, await loadChat(projectId))
    const section: PromptSection = step === 'reorganize' ? 'stories' : step
    const targets = step === 'split' ? splitTargets(project, storyIds) : step === 'reorganize'
      ? project.stories.filter((s) => (!storyIds || storyIds.includes(s.id)) && !storyReviewBlock(project, s)) : []
    if (step === 'split' && !targets.length) throw new Error('Všechny stories už mají tasky. Vyberte story, kterou chcete rozpadnout znovu.')
    if (step === 'reorganize' && !targets.length) throw new Error('Vyberte alespoň jednu story před zahájením implementace.')
    const extra = step === 'split' ? `\n\n<stories_k_rozpadu>\n${targets.map((t) => t.id).join(', ')}\n</stories_k_rozpadu>`
      : step === 'reorganize' ? `\n\n<stories_k_revizi>\n${targets.map((t) => t.id).join(', ')}\n</stories_k_revizi>` : ''
    const prompt = `${context}\n\n${userPrompts(project, section)}${extra}\n\n<ukol krok="${SECTION_LABEL[section]}">\n${TASK[step]}\n</ukol>`
    const result = await structured(SCHEMA[step] as z.ZodType<unknown>, SYSTEM, prompt, { projectId, projectName: project.name, step: SECTION_LABEL[section], role: ROLE[step] })
    // Built and saved on top of the latest model, so edits made while the agent worked are kept.
    let patch: Partial<Project> = {}
    // Review snapshots must describe the input the analyst actually saw, not edits made during its run.
    const review = step === 'reorganize' ? prepareStoryReview(project, result, targets.map((s) => s.id), randomUUID(), new Date().toISOString()) : undefined
    await mutateProject(projectId, (fresh) => {
      patch = review ? { storyReviews: [...(fresh.storyReviews ?? []), review] } : patchOf(fresh, step, result, storyIds)
      return { ...fresh, ...patch }
    }, ROLE[step] === 'analyst' ? 'Analytik' : 'Aplikace')
    publish(projectId, 'generate', 'done', step)
    publish(projectId, 'project', 'changed', '')
    return { patch, notes: step === 'stories' || step === 'split' ? (result as { notes: string }).notes : undefined }
  } catch (e) {
    publish(projectId, 'generate', 'error', (e as Error).message)
    throw e
  } finally {
    running.delete(projectId)
  }
}
