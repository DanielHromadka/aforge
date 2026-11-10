// Agentic IDE: the composer plans work per repository, and the Scribe keeps the backlog and the wiki written
// from that work. What it wrote is a trace the user can follow, revert or sort; the code always waits for review.
import { z } from 'zod'
import { nextKeys, type Epic, type Issue, type Layer, type Op, type Project, type Story } from './index.js'

// index.ts re-exports this module, so its values are not initialised yet when the schemas below are built.
const LAYER_VALUES = ['fe', 'be', 'api', 'test', 'other'] as const satisfies readonly Layer[]

/** One line of the trace: a prompt, or what the Scribe or a run made of it. */
export interface TraceEvent {
  id: string
  at: string
  kind: 'prompt' | 'epic' | 'story' | 'criterion' | 'task' | 'wiki' | 'contract' | 'unsorted' | 'proposal'
  /** Key of the item or id of the wiki page. */
  ref?: string
  title: string
  detail?: string
  /** The prompt the event comes from. */
  promptId?: string
  /** Written into the project without asking (it can be reverted); false = waits for a decision. */
  auto: boolean
  revert?: TraceRevert
  reverted?: boolean
  /** An unsorted prompt: stories it may belong to, and the story it would become. */
  candidates?: string[]
  draft?: StoryDraft
  resolved?: boolean
}

export type TraceRevert =
  | { type: 'created'; item: 'epic' | 'story'; id: string }
  | { type: 'story'; before: Story }
  | { type: 'wiki'; page: string; title: string; body: string; existed: boolean }

export interface IdeSettings {
  /** auto = the Scribe writes the backlog and marks it; review = it proposes in the consultant thread. */
  record: 'auto' | 'review'
  /** auto = the Documenter's wiki changes are accepted with a version; review = they wait in Wiki. */
  wiki: 'auto' | 'review'
  /** Dictation in the browser; off by default because some browsers send audio to their vendor. */
  voice: boolean
  /** The story the session currently works on; follow-up prompts extend it. */
  topic?: string
}
export const ideSettingsOf = (p: Pick<Project, 'ide'>): IdeSettings => ({ record: 'auto', wiki: 'auto', voice: false, ...p.ide })
export const hasIde = (p: Pick<Project, 'workflow'>) => !!p.workflow?.steps.some((s) => s.kind === 'ide')
export const TRACE_LIMIT = 400

const StoryDraftSchema = z.object({
  title: z.string(),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  acceptance: z.array(z.string()).describe('Given/When/Then, in Czech'),
  priority: z.enum(['must', 'should', 'could', 'wont']),
})
export type StoryDraft = z.infer<typeof StoryDraftSchema>

export const BacklogSchema = z.object({
  decision: z.enum(['existing', 'new', 'technical', 'none', 'unsure']).describe(
    'existing = the request continues or extends a story in the project (usually the current topic); new = a new user-facing feature; technical = a change without user-visible behaviour (refactoring, performance, build); none = a question or nothing to record; unsure = it may belong to more stories and you cannot tell'),
  storyId: z.string().describe('For "existing": the key of that story; otherwise ""'),
  candidates: z.array(z.string()).describe('For "unsure": keys of up to 3 stories it may belong to; otherwise []'),
  addCriteria: z.array(z.string()).describe('For "existing": acceptance criteria the request adds (Given/When/Then); [] when it adds none'),
  epicId: z.string().describe('For "new" and "unsure": key of an existing epic, "new" for a new epic, or ""'),
  epic: z.object({ title: z.string(), description: z.string() }).describe('Used only when epicId is "new"'),
  story: StoryDraftSchema.describe('For "new" and "unsure": the story the request describes; otherwise any placeholder'),
})
export type Backlog = z.infer<typeof BacklogSchema>

export const IdePlanSchema = z.object({
  reply: z.string().describe('Short answer to the user in Czech: what the agents will do, per repository'),
  backlog: BacklogSchema,
  tasks: z.array(z.object({
    repoId: z.string().describe('Id of one of the project repositories'),
    layer: z.enum(LAYER_VALUES).describe('fe = client, be = backend, test = automated tests, other = build or configuration; never api'),
    title: z.string().describe('Short imperative title in Czech'),
    description: z.string().describe('What exactly to change in this repository, in Czech, Markdown'),
  })).describe('At most one task per repository and layer; none when nothing is to be implemented'),
  contract: z.string().describe('The full updated OpenAPI 3.1 YAML when the request changes the API between repositories, otherwise ""'),
})
export type IdePlan = z.infer<typeof IdePlanSchema>

/** Czech plural of „kritérium“. */
export const criteria = (n: number) => `${n} ${n === 1 ? 'kritérium' : n >= 2 && n <= 4 ? 'kritéria' : 'kritérií'}`

const merge = (list: string[], add: string[]) => [...list, ...add.filter((a) => a.trim() && !list.some((x) => x.trim() === a.trim()))]

export interface BacklogResult {
  /** Model ops of the change, for a proposal in review mode. */
  ops: Op[]
  events: Omit<TraceEvent, 'id' | 'at' | 'auto'>[]
  /** The story the prompt's work belongs to (new keys are already allocated). */
  storyId?: string
  /** Text for the prompt line of the trace. */
  summary: string
}

/** What the Scribe's decision means for the project, without changing it yet. */
export const backlogChange = (p: Project, b: Backlog, promptId: string): BacklogResult => {
  const existing = b.decision === 'existing' ? p.stories.find((s) => s.id === b.storyId) : undefined
  if (existing) {
    const acceptance = merge(existing.acceptance, b.addCriteria)
    const added = acceptance.length - existing.acceptance.length
    if (!added) return { ops: [], events: [], storyId: existing.id, summary: `Navazuje na ${existing.id} ${existing.title}` }
    return {
      ops: [{ type: 'story.upsert', story: { ...existing, acceptance } }],
      events: [{ kind: 'criterion', ref: existing.id, title: `${existing.id} ${existing.title}`, detail: `+${criteria(added)}: ${acceptance.slice(-added).join(' · ')}`, promptId, revert: { type: 'story', before: existing } }],
      storyId: existing.id,
      summary: `Stejné téma → doplněno do ${existing.id}`,
    }
  }
  if (b.decision === 'technical') return { ops: [], events: [], summary: 'Technická změna, bez story' }
  if (b.decision === 'none') return { ops: [], events: [], summary: 'Bez dopadu na backlog' }
  if (b.decision === 'unsure' || b.decision === 'existing') {
    const candidates = b.candidates.filter((id) => p.stories.some((s) => s.id === id)).slice(0, 3)
    return { ops: [], events: [{ kind: 'unsorted', title: 'Nezařazeno', detail: candidates.length ? `Možná ${candidates.join(', ')}, nebo nová story` : 'Nová story, nebo neevidovat', promptId, candidates, draft: b.story }], summary: 'Nezařazeno' }
  }
  return newStory(p, b.story, b.epicId, b.epic, promptId)
}

/** A new story, under an existing epic or a new one. */
export const newStory = (p: Project, draft: StoryDraft, epicId: string, epicDraft: { title: string; description: string } | undefined, promptId: string): BacklogResult => {
  const createEpic = epicId === 'new' && !!epicDraft?.title.trim()
  const keys = nextKeys(p, createEpic ? 2 : 1)
  const epic: Epic | undefined = createEpic ? { id: keys[0]!, title: epicDraft!.title, description: epicDraft!.description, screenIds: [] } : undefined
  const story: Story = {
    id: keys[createEpic ? 1 : 0]!, epicId: epic?.id ?? ((p.epics ?? []).some((e) => e.id === epicId) ? epicId : undefined),
    title: draft.title, asA: draft.asA, iWant: draft.iWant, soThat: draft.soThat, acceptance: draft.acceptance, priority: draft.priority, status: 'ready', screenIds: [],
  }
  const epicTitle = epic?.title ?? (p.epics ?? []).find((e) => e.id === story.epicId)?.title
  return {
    ops: [...(epic ? [{ type: 'epic.upsert' as const, epic }] : []), { type: 'story.upsert', story }],
    events: [
      ...(epic ? [{ kind: 'epic' as const, ref: epic.id, title: `${epic.id} ${epic.title}`, detail: 'Nový epic', promptId, revert: { type: 'created' as const, item: 'epic' as const, id: epic.id } }] : []),
      { kind: 'story', ref: story.id, title: `${story.id} ${story.title}`, detail: `${criteria(story.acceptance.length)} z promptu`, promptId, revert: { type: 'created', item: 'story', id: story.id } },
    ],
    storyId: story.id,
    summary: `Nové téma → nová story${epicTitle ? ` v epicu ${epicTitle}` : ''}`,
  }
}

/** Appends events, newest last, keeping the trace bounded. */
export const withTrace = (p: Project, events: TraceEvent[]): Project => ({ ...p, trace: [...(p.trace ?? []), ...events].slice(-TRACE_LIMIT) })

/** Puts back what a trace event changed; the key of a removed item stays reserved. */
export const revertTrace = (p: Project, eventId: string): Project => {
  const event = p.trace?.find((e) => e.id === eventId)
  if (!event?.revert || event.reverted) throw new Error('Tento záznam nejde vrátit.')
  const r = event.revert
  let next = p
  if (r.type === 'created' && r.item === 'story') {
    if ((p.issues ?? []).some((i) => i.storyId === r.id && i.status === 'running')) throw new Error('Na story právě pracuje agent. Nejdřív ho zastavte.')
    next = { ...p, stories: p.stories.filter((s) => s.id !== r.id), issues: p.issues?.map((i) => (i.storyId === r.id ? { ...i, storyId: undefined } : i)), deletedKeys: [...(p.deletedKeys ?? []), r.id] }
  } else if (r.type === 'created') {
    next = { ...p, epics: (p.epics ?? []).filter((e) => e.id !== r.id), stories: p.stories.map((s) => (s.epicId === r.id ? { ...s, epicId: undefined } : s)), deletedKeys: [...(p.deletedKeys ?? []), r.id] }
  } else if (r.type === 'story') {
    if (!p.stories.some((s) => s.id === r.before.id)) throw new Error('Story už v projektu není.')
    next = { ...p, stories: p.stories.map((s) => (s.id === r.before.id ? { ...r.before, description: s.description } : s)) }
  } else {
    const now = new Date().toISOString()
    next = {
      ...p,
      wiki: r.existed
        ? (p.wiki ?? []).map((w) => (w.id === r.page ? { ...w, title: r.title, body: r.body, updatedAt: now, history: [{ body: w.body, at: w.updatedAt }, ...w.history].slice(0, 30) } : w))
        : (p.wiki ?? []).filter((w) => w.id !== r.page),
    }
  }
  return { ...next, trace: next.trace?.map((e) => (e.id === eventId ? { ...e, reverted: true } : e)) }
}

/** Links the work of a prompt to a story once the user sorted it. */
export const linkPromptWork = (issues: Issue[] | undefined, promptId: string, storyId: string | undefined) =>
  issues?.map((i) => (i.promptId === promptId && !i.storyId ? { ...i, storyId } : i))
