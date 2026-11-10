// Agentic IDE on the server. One structured call plans the prompt's work per repository and, as the Scribe,
// decides where the prompt belongs in the backlog. The tasks queue in their repositories; the backlog change is
// written at once (marked in the trace, revertible) or proposed in the consultant thread. Accepted work makes
// the Documenter update the wiki.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  applyOps, backlogChange, hasIde, ideSettingsOf, IdePlanSchema, linkPromptWork, newStory, nextKeys, reposOf, revertTrace, withTrace,
  type ChatMessage, type Issue, type Project, type TraceEvent,
} from '@aforge/shared'
import { structured } from './agents.js'
import { appendChat } from './chat.js'
import { buildContext, RUNTIME } from './context.js'
import { publish } from './events.js'
import { generate, isGenerating } from './generate.js'
import { loadChat, loadProject, mutateProject } from './store.js'
import { onIssueAccepted, startIssues, writeContract } from './tasks.js'

const now = () => new Date().toISOString()

const SYSTEM = `Jsi plánovač Agentního IDE platformy Reactor a zároveň jeho Zapisovatel.
Vývojář píše požadavky přímo do IDE. Každý repozitář projektu má svého agenta (Claude Code / Codex), který
implementuje tasky v něm; repozitáře běží souběžně. Ty:
1. rozdělíš požadavek na tasky po repozitářích (pole "tasks"): v každém repozitáři nejvýš jeden task na vrstvu,
   konkrétní popis, co změnit. Testy (layer "test") přidej jen tam, kde je repozitář s e2e testy nebo to uživatel chce.
   Na otázky a požadavky bez změny kódu vrať prázdné "tasks".
2. jako Zapisovatel rozhodneš, kam požadavek patří v backlogu (pole "backlog"). Nový uživatelský záměr = nová story,
   pokračování aktuálního tématu = doplnění kritérií existující story. Když si nejsi jistý, vrať "unsure" –
   nikdy nehádej. Nezakládej duplicity.
3. když se mění API mezi klientem a backendem, vrať v "contract" celý aktualizovaný OpenAPI kontrakt.
Piš česky (kromě kódu a cest). Běhové prostředí: ${RUNTIME}.`

export const IdeRunSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  filePath: z.string().max(500).optional(),
  repo: z.string().max(80).optional(),
  /** An element picked in the running app (Ponor): the request is about it. */
  element: z.object({ selector: z.string().max(500), text: z.string().max(300), route: z.string().max(300) }).optional(),
})

const event = (e: Omit<TraceEvent, 'id' | 'at'>, at: string): TraceEvent => ({ ...e, id: randomUUID(), at })

const announce = (projectId: string, events: TraceEvent[]) => {
  publish(projectId, 'project', 'changed', '')
  if (events.length) publish(projectId, 'ide', 'trace', '', events)
}

/** A prompt in Agent mode: plan, record and start the agents. */
export const runIde = async (projectId: string, body: unknown) => {
  const req = IdeRunSchema.parse(body)
  const project = await loadProject(projectId)
  const settings = ideSettingsOf(project)
  const topic = project.stories.find((s) => s.id === settings.topic)
  const context = await buildContext(project, { stage: 'ide', filePath: req.filePath, repo: req.repo }, await loadChat(projectId))
  const prompt = `${context}

<aktualni_tema>
${topic ? JSON.stringify({ id: topic.id, title: topic.title, acceptance: topic.acceptance }) : '(žádné – session zatím nemá téma)'}
</aktualni_tema>
${req.element ? `\n<vybrany_prvek route="${req.element.route}" selector="${req.element.selector}">\n${req.element.text}\n</vybrany_prvek>\n` : ''}
<pozadavek>
${req.text}
</pozadavek>`
  const plan = await structured(IdePlanSchema, SYSTEM, prompt, { projectId, projectName: project.name, step: 'IDE · plán', role: 'architect' })

  const promptId = randomUUID()
  const at = now()
  let created: Issue[] = []
  let events: TraceEvent[] = []
  let proposal: ChatMessage['proposals'][number] | undefined
  let contractChanged = false
  const saved = await mutateProject(projectId, (fresh) => {
    const s = ideSettingsOf(fresh)
    const change = backlogChange(fresh, plan.backlog, promptId)
    const auto = s.record === 'auto'
    // In review mode the story keys stay reserved for the proposal: the tasks number after them.
    const planned = applyOps(fresh, change.ops)
    let p = auto ? planned : fresh
    const storyId = auto || fresh.stories.some((x) => x.id === change.storyId) ? change.storyId : undefined
    const repos = reposOf(p)
    const tasks = plan.tasks.filter((t) => t.layer !== 'api')
    const keys = nextKeys(planned, tasks.length)
    created = tasks.map((t, n) => ({
      id: keys[n]!, type: 'task', storyId, title: t.title, description: `${t.description}\n\n> Z IDE: ${req.text.slice(0, 1500)}`, layer: t.layer,
      repoId: repos.some((r) => r.id === t.repoId) ? t.repoId : repos[0]!.id, status: 'todo', source: 'ide', promptId, files: [], createdAt: at, updatedAt: at,
    }))
    const yaml = plan.contract.trim()
    contractChanged = !!yaml && yaml !== fresh.contract?.yaml.trim()
    const contract = contractChanged ? { yaml, version: fresh.contract?.version ?? 0, status: 'proposed' as const, updatedAt: at } : fresh.contract
    events = [
      event({ kind: 'prompt', title: req.text.slice(0, 300), detail: change.summary, promptId, auto: true }, at),
      ...(auto
        ? change.events.map((e) => event({ ...e, auto: e.kind !== 'unsorted' }, at))
        : change.ops.length ? [event({ kind: 'proposal', title: 'Návrh do backlogu čeká v konzultantovi', detail: change.events.map((e) => e.title).join(' · '), promptId, auto: false }, at)]
        : change.events.map((e) => event({ ...e, auto: false }, at))),
      ...created.map((i) => event({ kind: 'task', ref: i.id, title: `${i.id} ${repos.find((r) => r.id === i.repoId)?.name ?? i.repoId} · ${i.title}`, detail: 'Agent repozitáře začne, jakmile je volný', promptId, auto: true }, at)),
      ...(contractChanged ? [event({ kind: 'contract', title: `API kontrakt v${(fresh.contract?.version ?? 0) + 1}`, detail: auto ? 'Zapsán do repozitářů' : 'Čeká na schválení v Rozpadu', promptId, auto }, at)] : []),
    ]
    if (!auto && change.ops.length) proposal = {
      id: `p-scribe-${promptId}`, title: `Zapisovatel: ${change.events.map((e) => e.title).join(', ')}`, rationale: `Z promptu v IDE: „${req.text.slice(0, 300)}“`, ops: change.ops, status: 'pending',
    }
    p = { ...p, issues: [...(p.issues ?? []), ...created], contract, ide: { ...s, topic: storyId ?? s.topic } }
    return withTrace(p, events)
  }, 'Zapisovatel')
  if (contractChanged && ideSettingsOf(saved).record === 'auto') await writeContract(projectId)
  const msgs: ChatMessage[] = [
    { id: randomUUID(), role: 'user', text: req.text, stage: 'ide', proposals: [], conflicts: [], createdAt: at },
    { id: randomUUID(), role: 'agent', text: plan.reply, stage: 'ide', proposals: proposal ? [proposal] : [], conflicts: [], issueIds: created.map((i) => i.id), createdAt: now() },
  ]
  await appendChat(projectId, msgs)
  announce(projectId, events)
  if (created.length) await startIssues(projectId, created.map((i) => i.id))
  return { messages: msgs, issueIds: created.map((i) => i.id) }
}

export const InlineSchema = z.object({
  repo: z.string().max(80),
  path: z.string().min(1).max(500),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  selection: z.string().max(40_000),
  instruction: z.string().trim().min(1).max(4000),
})

/** ⌘K: a targeted change of the selected code, straight to the repository's agent without planning. */
export const runInline = async (projectId: string, body: unknown) => {
  const req = InlineSchema.parse(body)
  const at = now()
  let issue: Issue | undefined
  let events: TraceEvent[] = []
  await mutateProject(projectId, (p) => {
    const repo = reposOf(p).find((r) => r.id === req.repo)
    if (!repo) throw new Error('Repozitář nenalezen')
    const topic = ideSettingsOf(p).topic
    issue = {
      id: nextKeys(p)[0]!, type: 'task', storyId: p.stories.some((s) => s.id === topic) ? topic : undefined,
      title: `${req.path.split('/').pop()}: ${req.instruction.slice(0, 80)}`,
      description: `Cílená úprava v souboru \`${req.path}\`, řádky ${req.startLine}–${req.endLine}:\n\n${req.instruction}\n\nVybraný kód:\n\n\`\`\`\n${req.selection}\n\`\`\`\n\nMěň jen to, co pokyn vyžaduje.`,
      layer: repo.platform === 'backend' || repo.platform === 'library' ? 'be' : 'fe', repoId: repo.id, status: 'todo', source: 'ide', files: [], createdAt: at, updatedAt: at,
    }
    events = [event({ kind: 'task', ref: issue.id, title: `${issue.id} ${repo.name} · ${issue.title}`, detail: '⌘K v editoru', auto: true }, at)]
    return withTrace({ ...p, issues: [...(p.issues ?? []), issue] }, events)
  }, 'Zapisovatel')
  announce(projectId, events)
  await startIssues(projectId, [issue!.id])
  return { issueId: issue!.id }
}

export const revertEvent = async (projectId: string, eventId: string) => {
  const saved = await mutateProject(projectId, (p) => {
    const next = revertTrace(p, eventId)
    const r = p.trace?.find((e) => e.id === eventId)?.revert
    const s = ideSettingsOf(next)
    return r?.type === 'created' && r.id === s.topic ? { ...next, ide: { ...s, topic: undefined } } : next
  }, 'Zapisovatel')
  publish(projectId, 'project', 'changed', '')
  return saved
}

export const AssignSchema = z.object({ target: z.string().min(1).max(40) })

/** Sorts an unsorted prompt: into a story, as a new story, or not recorded at all. */
export const assignEvent = async (projectId: string, eventId: string, body: unknown) => {
  const { target } = AssignSchema.parse(body)
  const at = now()
  let added: TraceEvent[] = []
  const saved = await mutateProject(projectId, (p) => {
    const e = p.trace?.find((x) => x.id === eventId)
    if (!e || e.kind !== 'unsorted' || e.resolved) throw new Error('Záznam už je zařazený.')
    const resolve = (patch: Partial<TraceEvent>) => (x: TraceEvent) => (x.id === eventId ? { ...x, resolved: true, ...patch } : x)
    const s = ideSettingsOf(p)
    if (target === 'ignore') return { ...p, trace: p.trace!.map(resolve({ detail: 'Neevidováno' })) }
    if (target === 'new') {
      if (!e.draft) throw new Error('K záznamu chybí návrh story.')
      const change = newStory(p, e.draft, '', undefined, e.promptId ?? eventId)
      added = change.events.map((x) => event({ ...x, auto: true }, at))
      const next = applyOps(p, change.ops)
      return withTrace({ ...next, issues: linkPromptWork(next.issues, e.promptId ?? '', change.storyId), trace: next.trace?.map(resolve({ ref: change.storyId, detail: `Nová story ${change.storyId}` })), ide: { ...s, topic: change.storyId } }, added)
    }
    if (!p.stories.some((x) => x.id === target)) throw new Error('Story nenalezena.')
    return { ...p, issues: linkPromptWork(p.issues, e.promptId ?? '', target), trace: p.trace!.map(resolve({ ref: target, detail: `Zařazeno do ${target}` })), ide: { ...s, topic: target } }
  }, 'Zapisovatel')
  announce(projectId, added)
  return saved
}

// ---- the Documenter after accepted IDE work ------------------------------------------------

const wikiTimers = new Map<string, NodeJS.Timeout>()

/** Several accepts in a row make one wiki update. */
export const scheduleWiki = (projectId: string, delay = Number(process.env.AFORGE_WIKI_DELAY_MS ?? 20_000), attempt = 0) => {
  clearTimeout(wikiTimers.get(projectId))
  const timer = setTimeout(() => { wikiTimers.delete(projectId); void writeWiki(projectId, attempt) }, delay)
  timer.unref()
  wikiTimers.set(projectId, timer)
}

export const writeWiki = async (projectId: string, attempt = 0) => {
  if (isGenerating(projectId)) {
    if (attempt < 5) scheduleWiki(projectId, 30_000, attempt + 1)
    return
  }
  try {
    await generate(projectId, 'wiki')
    const at = now()
    let events: TraceEvent[] = []
    await mutateProject(projectId, (p) => {
      const auto = ideSettingsOf(p).wiki === 'auto'
      events = []
      const wiki = (p.wiki ?? []).map((w) => {
        if (!w.draft) return w
        events.push(event({
          kind: 'wiki', ref: w.id, title: `Wiki · ${w.draft.title}`, detail: w.draft.changes.join(' · ') || undefined, auto,
          ...(auto ? { revert: { type: 'wiki' as const, page: w.id, title: w.title, body: w.body, existed: !!w.body } } : {}),
        }, at))
        if (!auto) return w
        return { ...w, title: w.draft.title, body: w.draft.body, sources: w.draft.sources, updatedAt: at, draft: undefined, history: [...(w.body ? [{ body: w.body, at: w.updatedAt }] : []), ...w.history].slice(0, 30) }
      })
      return withTrace({ ...p, wiki }, events)
    }, 'Dokumentarista')
    announce(projectId, events)
  } catch (e) {
    publish(projectId, 'ide', 'error', `Wiki se nepodařilo aktualizovat: ${(e as Error).message}`)
  }
}

/** A story whose IDE work is all accepted is described in the wiki. */
export const wikiDue = (project: Project, issueId: string) => {
  const issue = project.issues?.find((i) => i.id === issueId)
  if (!hasIde(project) || issue?.source !== 'ide' || !issue.storyId) return false
  return (project.issues ?? []).filter((i) => i.storyId === issue.storyId && i.type !== 'bug').every((i) => i.status === 'done')
}

onIssueAccepted((projectId, project, issueId) => { if (wikiDue(project, issueId)) scheduleWiki(projectId) })
