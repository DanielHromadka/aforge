// Domain model shared by the server and the web app. The zod schemas double as the JSON schema the
// agent must answer in, so a field added here is immediately part of the agent contract.
import { z } from 'zod'
import type { StoryArchive, StoryReview } from './story-review.js'
import type { ItemPlanning } from './planning.js'
import type { DescriptionRevision, ProjectAttachment } from './descriptions.js'
export * from './story-review.js'
export * from './items.js'
export * from './planning.js'
export * from './descriptions.js'
export * from './ide.js'
import type { IdeSettings, TraceEvent } from './ide.js'

/** Steps of a workflow. `build` is the implementation of tasks; `prompt` is a custom prompt-only step. */
export const STAGES = ['overview', 'design', 'stories', 'split', 'build', 'code', 'preview', 'tests', 'wiki', 'prompt', 'ide'] as const
export type Stage = (typeof STAGES)[number]

export const STEP_TITLES: Record<Stage, string> = {
  overview: 'Přehled', design: 'Design', stories: 'Stories', split: 'Rozpad', build: 'Implementace', code: 'Kód',
  preview: 'Náhled', tests: 'Testy', wiki: 'Wiki', prompt: 'Prompt', ide: 'IDE',
}
export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  kind: z.enum(STAGES),
  label: z.string().trim().min(1).max(80),
  prompt: z.string().max(200_000),
})
export const WorkflowSchema = z.object({
  preset: z.enum(['vibe', 'developer', 'ide', 'enterprise', 'custom']),
  steps: z.array(WorkflowStepSchema).min(1).max(24),
  /** Removed steps retain their prompts and can be added again. */
  retained: z.array(WorkflowStepSchema).max(200).default([]),
}).superRefine((w, ctx) => {
  const ids = w.steps.map((s) => s.id)
  const kinds = w.steps.filter((s) => s.kind !== 'prompt').map((s) => s.kind)
  if (new Set(ids).size !== ids.length || new Set(kinds).size !== kinds.length)
    ctx.addIssue({ code: 'custom', message: 'Každý krok musí mít jedinečné ID; vestavěný krok smí být ve workflow jen jednou.' })
})
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>
export type Workflow = z.infer<typeof WorkflowSchema>
export type WorkflowPreset = Workflow['preset']
export const WORKFLOW_PRESETS = {
  vibe: { label: 'Vibe coding', description: 'Z požadavku rovnou k aplikaci.', kinds: ['prompt', 'preview'] },
  developer: { label: 'Developer', description: 'Implementace, kód a ověření.', kinds: ['prompt', 'code', 'preview', 'tests'] },
  ide: { label: 'Agentní IDE', description: 'Editor, composer a agenti; backlog a wiki se píšou samy.', kinds: ['ide', 'preview', 'tests', 'wiki'] },
  enterprise: { label: 'Enterprise', description: 'Od designu přes stories a rozpad po testy a wiki.', kinds: ['overview', 'design', 'stories', 'split', 'build', 'preview', 'tests', 'wiki'] },
} as const
/** The Enterprise steps before the story-centred editor; such a workflow is upgraded with its prompts. */
const LEGACY_ENTERPRISE = ['design', 'stories', 'build', 'code', 'preview', 'tests']
const promptOf = (p: Pick<Project, 'prompts'>, kind: Stage) => (kind === 'build' || kind === 'overview' || kind === 'ide' ? '' : (p.prompts as Record<string, string | undefined>)?.[kind] ?? '')
export const workflowOf = (p: Pick<Project, 'workflow' | 'prompts'>): Workflow => {
  const w = p.workflow
  if (w && !(w.preset === 'enterprise' && w.steps.map((s) => s.kind).join() === LEGACY_ENTERPRISE.join())) return w
  const old = new Map((w?.steps ?? []).map((s) => [s.kind, s]))
  return {
    preset: 'enterprise', retained: w?.retained ?? [],
    steps: WORKFLOW_PRESETS.enterprise.kinds.map((kind) => ({ id: kind, kind, label: STEP_TITLES[kind], prompt: old.get(kind)?.prompt ?? promptOf(p, kind) })),
  }
}
export const withWorkflowSteps = (w: Workflow, steps: WorkflowStep[], preset: WorkflowPreset = 'custom'): Workflow => {
  const active = new Set(steps.map((s) => s.id))
  const retained = new Map([...w.retained, ...w.steps.filter((s) => !active.has(s.id))].map((s) => [s.id, s]))
  for (const id of active) retained.delete(id)
  return { preset, steps, retained: [...retained.values()] }
}
export const workflowPreset = (preset: keyof typeof WORKFLOW_PRESETS, current: Workflow): Workflow => {
  const pool = [...current.steps, ...current.retained]
  return withWorkflowSteps(current, WORKFLOW_PRESETS[preset].kinds.map((kind) =>
    pool.find((s) => s.id === kind) ?? (kind !== 'prompt' ? pool.find((s) => s.kind === kind) : undefined) ?? { id: kind, kind, label: STEP_TITLES[kind], prompt: '' }), preset)
}
/** Active workflow prompts only. Hidden/removed steps are retained, not executed. */
export const workflowInstructions = (p: Pick<Project, 'workflow' | 'prompts'>): string => workflowOf(p).steps
  .filter((s) => s.prompt.trim()).map((s) => `### ${s.label} [${s.id}]\n${s.prompt}`).join('\n\n')

export const ELEMENT_KINDS = ['container', 'text', 'button', 'input', 'image', 'nav', 'list', 'table', 'card'] as const

export const StorySchema = z.object({
  id: z.string().describe('Stable key such as RZ-3: the project key and the next free number'),
  epicId: z.string().optional().describe('Key of the epic the story belongs to'),
  title: z.string(),
  description: z.string().optional().describe('Detailed description in Markdown, including attachment links'),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  acceptance: z.array(z.string()).describe('Acceptance criteria, ideally Given/When/Then'),
  priority: z.enum(['must', 'should', 'could', 'wont']),
  status: z.enum(['draft', 'ready', 'implemented', 'verified']),
  screenIds: z.array(z.string()),
})
export type Story = z.infer<typeof StorySchema>

// ---- issues: the Jira-like hierarchy epic → story → task / bug / sub-task ----------------------------

export const EpicSchema = z.object({
  id: z.string().describe('Stable key such as RZ-1'),
  title: z.string(),
  description: z.string().describe('What the epic covers, in Czech'),
  screenIds: z.array(z.string()).describe('Design screens of the epic'),
})
export type Epic = z.infer<typeof EpicSchema>

export const ISSUE_TYPES = ['task', 'bug', 'subtask'] as const
export type IssueType = (typeof ISSUE_TYPES)[number]
/** Which part of the system a task changes; it decides the agent's role. */
export const LAYERS = ['fe', 'be', 'api', 'test', 'other'] as const
export type Layer = (typeof LAYERS)[number]
export const LAYER_LABEL: Record<Layer, string> = { fe: 'Frontend', be: 'Backend', api: 'API kontrakt', test: 'Testy', other: 'Ostatní' }
/** proposed = from a breakdown not yet approved; review = the agent finished and waits for acceptance. */
export const ISSUE_STATUSES = ['proposed', 'todo', 'running', 'review', 'done', 'failed', 'blocked'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export interface FileChange {
  path: string
  added: number
  removed: number
}

export interface Issue {
  id: string
  type: IssueType
  storyId?: string
  /** Parent task of a sub-task. */
  parentId?: string
  title: string
  description: string
  layer: Layer
  repoId: string
  status: IssueStatus
  /** Where it came from: a breakdown, a failing test, a preview annotation or a person. */
  source: 'breakdown' | 'test' | 'annotation' | 'manual' | 'ide'
  /** The IDE prompt the task was planned from, so sorting the prompt later links its work to a story. */
  promptId?: string
  testTitle?: string
  annotationId?: string
  /** Files the last run changed, between these two commits of its repository. */
  files: FileChange[]
  commits?: { base: string; head: string }
  /** The reviewer's comment for the next run. */
  feedback?: string
  createdAt: string
  updatedAt: string
}

export const PLATFORMS = ['web', 'mobile', 'desktop', 'backend', 'library'] as const
export type Platform = (typeof PLATFORMS)[number]
export const PLATFORM_LABEL: Record<Platform, string> = { web: 'Web', mobile: 'Mobil', desktop: 'Desktop', backend: 'Backend', library: 'Knihovna a CLI' }
/** A git repository of the project. `main` is the project's workspace; others live beside it. */
export interface Repo {
  id: string
  name: string
  platform: Platform
}
export const reposOf = (p: Pick<Project, 'repos' | 'id'>): Repo[] => p.repos?.length ? p.repos : [{ id: 'main', name: p.id, platform: 'web' }]

/** The API contract shared by all repositories, written into each as contract/openapi.yaml. */
export interface ApiContract {
  yaml: string
  version: number
  status: 'proposed' | 'approved'
  updatedAt: string
}

/** A page for people: what the application does and how. One per epic plus `about`. */
export interface WikiPage {
  id: string
  title: string
  body: string
  updatedAt: string
  sources: string[]
  /** The writer's proposal waiting for acceptance. */
  draft?: { title: string; body: string; changes: string[]; sources: string[]; createdAt: string }
  history: { body: string; at: string }[]
}

const keyOf = (name: string) => {
  const letters = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  const key = letters.length > 1 ? letters.map((w) => w[0]).join('').slice(0, 4) : (letters[0] ?? 'APP').slice(0, 3)
  return /^[A-Z]/.test(key) ? key : `P${key}`.slice(0, 4)
}
/** Every key in use: epics, stories, tasks and bugs share one numbering, as in Jira. */
export const usedKeys = (p: Pick<Project, 'epics' | 'stories' | 'issues' | 'storyArchive' | 'deletedKeys'>) => [...(p.epics ?? []), ...p.stories, ...(p.issues ?? []), ...(p.storyArchive ?? []).flatMap((a) => [a.story, ...a.issues])].map((x) => x.id).concat(p.deletedKeys ?? [])
/** The next `count` free keys. */
export const nextKeys = (p: Pick<Project, 'key' | 'epics' | 'stories' | 'issues' | 'name' | 'storyArchive' | 'deletedKeys'>, count = 1): string[] => {
  const key = p.key ?? keyOf(p.name)
  const max = usedKeys(p).reduce((m, id) => { const n = Number(id.match(/-(\d+)$/)?.[1] ?? 0); return id.startsWith(`${key}-`) ? Math.max(m, n) : m }, 0)
  return Array.from({ length: count }, (_, i) => `${key}-${max + 1 + i}`)
}

/** Status of a story on the board, derived from its tasks, bugs and tests. */
export const STORY_STAGES = ['story', 'split', 'build', 'preview', 'tests', 'done'] as const
export type StoryStage = (typeof STORY_STAGES)[number]
export const storyStage = (p: Pick<Project, 'issues'>, story: Story): StoryStage => {
  const own = (p.issues ?? []).filter((i) => i.storyId === story.id && i.type !== 'bug')
  const bugs = (p.issues ?? []).filter((i) => i.storyId === story.id && i.type === 'bug' && i.status !== 'done')
  if (story.status === 'verified' && !bugs.length) return 'done'
  if (!own.length) return story.status === 'implemented' ? 'preview' : 'story'
  if (own.some((i) => i.status === 'proposed')) return 'split'
  if (own.some((i) => i.status !== 'done') || bugs.some((b) => b.status === 'running' || b.status === 'review')) return 'build'
  return bugs.length || story.status === 'verified' ? 'tests' : 'preview'
}

/** A layer of a Figma frame. The design lives in Figma: Reactor only mirrors the layers on sync and adds
 *  what Figma does not know – notes, linked stories and whether the element is being worked on. */
export interface DesignElement {
  /** `el-fg-<node>`, stable across syncs, so the annotations survive them. */
  id: string
  figmaId: string
  parentId?: string
  /** Guessed from the layer type and name; helps the implementing agent read the outline. */
  kind: ElementKind
  /** Figma layer type (FRAME, TEXT, INSTANCE…). */
  type: string
  name: string
  text?: string
  x: number
  y: number
  w: number
  h: number
  note: string
  storyIds: string[]
  /** Marked for work: the next build and the agent give it priority. */
  work: boolean
}
export type ElementKind = (typeof ELEMENT_KINDS)[number]

/** Annotations that sync keeps (everything else comes from Figma). */
export type ElementAnnotation = Pick<DesignElement, 'note' | 'storyIds' | 'work'>

export interface Screen {
  id: string
  figmaId: string
  name: string
  width: number
  height: number
  /** File name of the rendered frame in the project's figma/ folder. */
  image?: string
  elements: DesignElement[]
}

/** Mermaid diagram types the architecture step uses, each for what it shows best. */
export const DIAGRAM_TYPES = ['flowchart', 'sequence', 'state', 'er', 'class'] as const

export const DiagramSchema = z.object({
  id: z.string().describe('Stable id such as dg-architecture or dg-booking-flow'),
  title: z.string(),
  type: z
    .enum(DIAGRAM_TYPES)
    .describe('flowchart = parts (FE, BE, DB, integrations) and their links; sequence = one request or user flow over time; state = a stateful workflow; er = the data model; class = domain types'),
  mermaid: z.string().describe('Mermaid source matching the type (flowchart TD / sequenceDiagram / stateDiagram-v2 / erDiagram / classDiagram), without code fences'),
  description: z.string().describe('What the diagram shows and why, in Czech'),
  steps: z
    .array(z.object({ name: z.string().describe('Node, step or state as named in the diagram'), description: z.string().describe('Its logic in Czech: inputs, what it does, outputs, errors') }))
    .describe('Logical description of the individual steps or parts of the diagram'),
  storyIds: z.array(z.string()),
})
export type Diagram = z.infer<typeof DiagramSchema>

export const ArchitectureSchema = z.object({
  stack: z
    .object({
      frontend: z.string().describe('E.g. "React 19 + TypeScript + Vite"; "–" when there is none'),
      backend: z.string().describe('E.g. "Node.js 22 + Fastify"; "–" when there is none'),
      database: z.string().describe('E.g. "SQLite (soubor)", "v paměti", "–"'),
      reason: z.string().describe('Why this stack, in Czech: what the brief asked for or why it fits best'),
    })
    .describe('Taken from the brief when it names one, otherwise the best fit the runtime supports'),
  summary: z.string().describe('The architecture in a few sentences, in Czech'),
  diagrams: z.array(DiagramSchema),
})
export type Architecture = z.infer<typeof ArchitectureSchema>

export const BuildPlanSchema = z.object({
  prompt: z
    .string()
    .describe('The refined implementation prompt for Claude Code / Codex, Markdown, in Czech: goal, stack, what to build per story and screen, data and API, acceptance, what not to touch'),
  changes: z
    .array(z.object({ path: z.string().describe('Workspace-relative path'), action: z.enum(['create', 'modify', 'delete']), reason: z.string().describe('What changes there and why, in Czech') }))
    .describe('The files the implementation will really create, modify or delete'),
})
export type BuildPlan = z.infer<typeof BuildPlanSchema>

/** Parts of the window that have their own accompanying prompt; Build has one per part. */
export const PROMPT_SECTIONS = ['prompt', 'design', 'stories', 'split', 'blocks', 'plan', 'code', 'preview', 'tests', 'wiki'] as const
export type PromptSection = (typeof PROMPT_SECTIONS)[number]

/** Compatibility for generation sub-sections, restricted to the active workflow. */
export const sectionPromptsOf = (p: Pick<Project, 'workflow' | 'prompts'>): Partial<Record<PromptSection, string>> => {
  if (!p.workflow) return p.prompts ?? {}
  const result: Partial<Record<PromptSection, string>> = {}
  for (const step of p.workflow.steps) {
    if (step.kind === 'build') { result.blocks = p.prompts.blocks; result.plan = p.prompts.plan }
    else if (step.kind !== 'prompt' && step.kind !== 'overview' && step.kind !== 'ide') result[step.kind] = step.prompt
  }
  return result
}

export interface Annotation {
  id: string
  source: 'preview' | 'design'
  /** CSS selector of the clicked element in the running app, or the wireframe element id. */
  target: string
  text: string
  route: string
  comment: string
  status: 'open' | 'sent' | 'resolved'
  createdAt: string
}

/** Only the implementing agent is a setting; the stack comes from the brief or the architecture step. */
export interface StackConfig {
  agent: 'claude' | 'codex'
}

export interface TestCase {
  title: string
  storyIds: string[]
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted'
  durationMs: number
  error?: string
  screenshots: string[]
}

export interface TestReport {
  startedAt: string
  finishedAt: string
  ok: boolean
  cases: TestCase[]
  log: string
}

/** A recorded click-through of one section of the running app: a Playwright script the agent writes, then a video. */
export interface Walkthrough {
  id: string
  /** A test performs its scenario and checks the result; a walkthrough only shows a section. Older ones have none. */
  kind?: 'walkthrough' | 'test'
  /** What the test checks, e.g. "Obsazený termín nejde vybrat". */
  title?: string
  /** App route the script opens, e.g. "/rezervace". */
  route: string
  /** CSS selector or a plain-language description of the section to click through. */
  section: string
  storyIds: string[]
  instructions: string
  /** Workspace path of the script, e2e/walkthroughs/<slug>.spec.ts. */
  script: string
  status: 'draft' | 'generating' | 'ready' | 'recording' | 'recorded' | 'failed'
  /** File name of the latest recording in data/projects/<id>/walkthroughs/. */
  video?: string
  error?: string
  recordedAt?: string
  createdAt: string
  updatedAt: string
}

export interface SessionEntry {
  /** Execution id, also used by all existing flow APIs. */
  id: string
  name: string
  createdAt: string
  archivedAt?: string
}
export interface SnapshotEntry {
  id: string
  sessionId: string
  name: string
  createdAt: string
}
export interface ProjectHistory {
  projectId: string
  sessions: SessionEntry[]
  snapshots: SnapshotEntry[]
}
export interface SessionContext extends SessionEntry {
  projectId: string
  snapshot?: SnapshotEntry
}

export interface JiraLink {
  url: string
  jql: string
  /** Jira Cloud signs in with e-mail + API token; without an e-mail the token is a Data Center PAT. */
  email?: string
  syncedAt: string
  items: Record<string, string>
}

export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  stack: StackConfig
  /** Prefix of the issue keys, e.g. RZ. */
  key?: string
  epics?: Epic[]
  stories: Story[]
  /** Server-owned backlog reviews and the stories they replaced, with their original breakdowns. */
  storyReviews?: StoryReview[]
  storyArchive?: StoryArchive[]
  storyRevision?: number
  /** Deleted keys stay reserved so old links never refer to a different item. */
  deletedKeys?: string[]
  /** Human project management only. Never part of any agent contract or implementation prompt. */
  planning?: Record<string, ItemPlanning>
  descriptionHistory?: Record<string, DescriptionRevision[]>
  attachments?: ProjectAttachment[]
  /** Tasks, bugs and sub-tasks under the stories. */
  issues?: Issue[]
  repos?: Repo[]
  contract?: ApiContract
  wiki?: WikiPage[]
  screens: Screen[]
  /** Accompanying prompts per section; the project brief is `description`. */
  prompts: Partial<Record<PromptSection, string>>
  workflow?: Workflow
  architecture?: Architecture & { generatedAt: string }
  buildPlan?: BuildPlan & { generatedAt: string }
  annotations: Annotation[]
  testReport?: TestReport
  /** Optional: projects from before walkthroughs have none. */
  walkthroughs?: Walkthrough[]
  figma?: { url: string; syncedAt: string }
  /** Server-owned: the last Jira import and which Reactor key each Jira key became, so a re-import updates. */
  jira?: JiraLink
  /** Server-owned context; old project files remain the initial working session. */
  session?: SessionContext
  /** Server-owned: the signed-in user's role in the project. */
  role?: ProjectRole
  /** Agentic IDE settings, and the server-owned trace of what the Scribe wrote. */
  ide?: IdeSettings
  trace?: TraceEvent[]
}

/** Totals on a project card. Agent runs and cost cover all sessions; cost is an estimate from the model rates. */
export interface ProjectStats {
  epics: number
  stories: number
  tasks: number
  bugs: number
  tests: { passed: number; total: number }
  agentRuns: number
  costUsd: number
}
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'description' | 'updatedAt'> & { role?: ProjectRole; stats?: ProjectStats }

// ---- users and access ----------------------------------------------------------------------

export const PROJECT_ROLES = ['owner', 'editor', 'viewer'] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]
export const ROLE_LABEL: Record<ProjectRole, string> = { owner: 'Vlastník', editor: 'Editor', viewer: 'Čtenář' }
/** A user known from a Keycloak sign-in; `admin` comes from the realm role, not from Reactor. */
export interface AppUser {
  id: string
  username: string
  name: string
  email?: string
  admin: boolean
  lastLoginAt: string
}
export interface AuthState {
  enabled: boolean
  user: AppUser | null
  issuer?: string
}
export type UserWithProjects = AppUser & { projects: Record<string, ProjectRole> }

// ---- agent contract ------------------------------------------------------------------------

export const OpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('story.upsert'), story: StorySchema }),
  z.object({ type: z.literal('story.delete'), id: z.string() }),
  z.object({ type: z.literal('epic.upsert'), epic: EpicSchema }),
  z.object({
    type: z.literal('issue.upsert'),
    issue: z.object({
      id: z.string().describe('Existing key, or "new" for a new task or bug'),
      type: z.enum(ISSUE_TYPES),
      storyId: z.string(),
      title: z.string(),
      description: z.string(),
      layer: z.enum(LAYERS),
      repoId: z.string().describe('Id of one of the project repositories'),
    }),
  }),
  z.object({
    type: z.literal('element.annotate'),
    screenId: z.string(),
    id: z.string().describe('Id of an existing design element; elements themselves come only from Figma'),
    note: z.string().optional(),
    storyIds: z.array(z.string()).optional(),
    work: z.boolean().optional().describe('Mark (true) or unmark the element as being worked on'),
  }),
  z.object({ type: z.literal('diagram.upsert'), diagram: DiagramSchema }),
  z.object({ type: z.literal('diagram.delete'), id: z.string() }),
  z.object({ type: z.literal('file.write'), path: z.string(), content: z.string() }),
  z.object({ type: z.literal('file.delete'), path: z.string() }),
  z.object({ type: z.literal('annotation.resolve'), id: z.string() }),
])
export type Op = z.infer<typeof OpSchema>

export const ProposalSchema = z.object({
  id: z.string(),
  title: z.string().describe('Short imperative summary of the change'),
  rationale: z.string().describe('Why, with references to stories, screens or annotations'),
  ops: z.array(OpSchema),
})
export type Proposal = z.infer<typeof ProposalSchema>

export const ConflictSchema = z.object({
  id: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  refs: z.array(z.string()).describe('Ids of the stories, screens, elements or diagrams involved'),
})
export type Conflict = z.infer<typeof ConflictSchema>

export const AgentReplySchema = z.object({
  reply: z.string().describe('Answer to the user, in Czech, Markdown allowed'),
  proposals: z.array(ProposalSchema),
  conflicts: z.array(ConflictSchema),
})
export type AgentReply = z.infer<typeof AgentReplySchema>

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  stepId?: string
  /** The story or issue the exchange is about, when it was started from it. */
  anchor?: string
  text: string
  stage: Stage
  proposals: (Proposal & { status: 'pending' | 'accepted' | 'rejected' })[]
  conflicts: Conflict[]
  /** IDE composer: the tasks the message started, one agent per repository. */
  issueIds?: string[]
  createdAt: string
}

export interface FileEntry {
  path: string
  type: 'file' | 'dir'
  children?: FileEntry[]
}

export type RunState = 'idle' | 'starting' | 'running' | 'stopped' | 'error'

export interface PreviewStatus {
  state: RunState
  url?: string
  message?: string
  log: string
}

export interface BuildEvent {
  kind: 'log' | 'tool' | 'text' | 'done' | 'error' | 'usage'
  text: string
  at: string
  usage?: AgentUsage
}

export interface ProvidersInfo {
  claude: boolean
  codex: boolean
  anthropicApi: boolean
  docker: boolean
  runtimeImage: boolean
}

export const newProject = (id: string, name: string, description = ''): Project => {
  const now = new Date().toISOString()
  return {
    id,
    name,
    description,
    createdAt: now,
    updatedAt: now,
    key: keyOf(name),
    stack: { agent: 'claude' },
    epics: [],
    stories: [],
    issues: [],
    repos: [{ id: 'main', name: id, platform: 'web' }],
    wiki: [],
    screens: [],
    prompts: {},
    annotations: [],
  }
}

/** Depth of every element below its frame (top-level layers are 0). */
export const elementDepths = (screen: Screen): Map<string, number> => {
  const parent = new Map(screen.elements.map((e) => [e.id, e.parentId]))
  const depths = new Map<string, number>()
  const depth = (id: string): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    const pid = parent.get(id)
    const d = pid && parent.has(pid) ? depth(pid) + 1 : 0
    depths.set(id, d)
    return d
  }
  screen.elements.forEach((e) => depth(e.id))
  return depths
}

const isAnnotated = (e: DesignElement) => e.work || !!e.note || e.storyIds.length > 0

/**
 * The elements worth showing an agent: the upper layers of the frame plus every annotated element, so a
 * large Figma file does not flood the context.
 */
export const designOutline = (screen: Screen, maxDepth = 2, max = 250): DesignElement[] => {
  const depths = elementDepths(screen)
  return screen.elements.filter((e) => isAnnotated(e) || depths.get(e.id)! <= maxDepth).slice(0, max)
}

/** Projects saved before the Figma sync had hand-drawn wireframes; they are read as unsynced layers. */
export const normalizeProject = (raw: Project): Project => {
  // The hand-made block model and the fixed stack choice were replaced by the architecture step.
  const { blocks: _blocks, ...p } = raw as Project & { blocks?: unknown }
  // Projects from before keys keep the US prefix their stories already use.
  const key = p.key ?? (p.stories.some((s) => /^US-\d+$/.test(s.id)) ? 'US' : keyOf(p.name))
  return {
    ...p,
    key,
    epics: p.epics ?? [],
    issues: p.issues ?? [],
    repos: reposOf(p),
    wiki: p.wiki ?? [],
    stack: { agent: p.stack?.agent === 'codex' ? 'codex' : 'claude' },
    prompts: p.prompts ?? {},
    workflow: WorkflowSchema.parse(workflowOf(p)),
    screens: p.screens.map((s) => ({
      ...s,
      figmaId: s.figmaId ?? '',
      elements: s.elements.map((e) => {
        const old = e as DesignElement & { label?: string }
        return { ...old, figmaId: old.figmaId ?? '', type: old.type ?? '', name: old.name ?? old.label ?? '', work: old.work ?? false }
      }),
    })),
  }
}

/** Story keys referenced in a test title like "[RZ-3] user can log in". */
export const storyIdsInTitle = (title: string): string[] => [...title.matchAll(/\[([A-Z][A-Z0-9]{0,9}-\d+)\]/g)].map((m) => m[1]!)

const byId = <T extends { id: string }>(list: T[], item: T): T[] => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item])

/** Applies the model ops of a proposal. File ops are left to the caller (they touch the workspace). */
export const applyOps = (project: Project, ops: Op[]): Project => {
  let p = project
  for (const op of ops) {
    switch (op.type) {
      case 'story.upsert':
        p = { ...p, stories: byId(p.stories, op.story.description === undefined && p.stories.find((s) => s.id === op.story.id)?.description !== undefined
          ? { ...op.story, description: p.stories.find((s) => s.id === op.story.id)!.description } : op.story) }
        break
      case 'story.delete':
        p = { ...p, stories: p.stories.filter((s) => s.id !== op.id) }
        break
      case 'epic.upsert':
        p = { ...p, epics: byId(p.epics ?? [], op.epic) }
        break
      case 'issue.upsert': {
        const now = new Date().toISOString()
        const old = (p.issues ?? []).find((i) => i.id === op.issue.id)
        const id = old ? old.id : nextKeys(p)[0]!
        const issue: Issue = old
          ? { ...old, ...op.issue, id, updatedAt: now }
          : { ...op.issue, id, status: 'todo', source: 'manual', files: [], createdAt: now, updatedAt: now }
        p = { ...p, issues: byId(p.issues ?? [], issue) }
        break
      }
      case 'element.annotate': {
        const patch: Partial<ElementAnnotation> = {}
        if (op.note !== undefined) patch.note = op.note
        if (op.storyIds !== undefined) patch.storyIds = op.storyIds
        if (op.work !== undefined) patch.work = op.work
        p = {
          ...p,
          screens: p.screens.map((s) => (s.id === op.screenId ? { ...s, elements: s.elements.map((e) => (e.id === op.id ? { ...e, ...patch } : e)) } : s)),
        }
        break
      }
      case 'diagram.upsert': {
        const arch = p.architecture ?? { stack: { frontend: '', backend: '', database: '', reason: '' }, summary: '', diagrams: [], generatedAt: new Date().toISOString() }
        p = { ...p, architecture: { ...arch, diagrams: byId(arch.diagrams, op.diagram) } }
        break
      }
      case 'diagram.delete':
        if (p.architecture) p = { ...p, architecture: { ...p.architecture, diagrams: p.architecture.diagrams.filter((d) => d.id !== op.id) } }
        break
      case 'annotation.resolve':
        p = { ...p, annotations: p.annotations.map((a) => (a.id === op.id ? { ...a, status: 'resolved' } : a)) }
        break
      case 'file.write':
      case 'file.delete':
        break
    }
  }
  return p
}

// ---- distributed agents --------------------------------------------------------------------

/** Cumulative usage for a run; contextTokens is the latest request, never the cumulative input. */
export interface AgentUsage {
  model?: string
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  contextTokens?: number
  contextWindow?: number
  costUsd?: number
  costSource?: 'provider' | 'estimate'
}

/** The agent's role in the team; every run has one. */
export const AGENT_ROLES = ['analyst', 'architect', 'fe', 'be', 'tester', 'writer', 'consultant'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]
export const ROLE_NAME: Record<AgentRole, string> = { analyst: 'Analytik', architect: 'Architekt', fe: 'FE vývojář', be: 'BE vývojář', tester: 'Tester', writer: 'Dokumentarista', consultant: 'Konzultant' }
/** The agent of a task: by its layer, and for other work by the platform of its repository. */
export const roleOfLayer = (layer: Layer, platform?: Platform): AgentRole =>
  layer === 'fe' ? 'fe' : layer === 'test' ? 'tester' : layer === 'api' ? 'architect' : layer === 'other' && platform && platform !== 'backend' && platform !== 'library' ? 'fe' : 'be'
export const roleOfIssue = (p: Pick<Project, 'repos' | 'id'>, issue: Pick<Issue, 'layer' | 'repoId'>) => roleOfLayer(issue.layer, reposOf(p).find((r) => r.id === issue.repoId)?.platform)

export interface AgentRun {
  id: string
  role?: AgentRole
  /** The task or bug the run works on. */
  issueId?: string
  agent: 'claude' | 'codex' | 'anthropic'
  location: 'local' | 'remote'
  host: string
  workerId?: string
  projectId: string
  projectName: string
  rootProjectId?: string
  sessionName?: string
  step: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  startedAt: string
  finishedAt?: string
  activity?: string
  error?: string
  usage: AgentUsage
}

export interface WorkerStatus {
  id: string
  name: string
  online: boolean
  caps?: { claude: boolean; codex: boolean; docker: boolean; git: boolean }
  telemetry?: boolean
  labels: string[]
  running: number
  maxJobs: number
  since?: string
  createdAt: string
}

export interface ModelMetrics {
  contextWindow?: number
  inputUsdPerMillion?: number
  cachedInputUsdPerMillion?: number
  outputUsdPerMillion?: number
}

export interface HubStatus {
  relay: string
  mode: 'local' | 'remote'
  connected: boolean
  error?: string
  workers: WorkerStatus[]
  runs: AgentRun[]
  modelMetrics: Record<string, ModelMetrics>
}

export const PIPELINE_PHASES = ['stories', 'wireframes', 'blocks', 'review', 'build', 'tests'] as const
export type PipelinePhase = (typeof PIPELINE_PHASES)[number]

export interface PipelineTask {
  id: string
  phase: PipelinePhase
  title: string
  instruction: string
  dependsOn: string[]
  status: 'pending' | 'running' | 'awaiting' | 'done' | 'failed' | 'skipped'
  note?: string
}

export interface PipelineRun {
  id: string
  status: 'planning' | 'running' | 'done' | 'failed' | 'cancelled'
  goal: string
  summary: string
  autoApply: boolean
  startedAt: string
  finishedAt?: string
  tasks: PipelineTask[]
}
