// Domain model shared by the server and the web app. The zod schemas double as the JSON schema the
// agent must answer in, so a field added here is immediately part of the agent contract.
import { z } from 'zod'

export const STAGES = ['design', 'stories', 'blocks', 'build', 'code', 'preview', 'tests'] as const
export type Stage = (typeof STAGES)[number]

export const ELEMENT_KINDS = ['container', 'text', 'button', 'input', 'image', 'nav', 'list', 'table', 'card'] as const
export const BLOCK_KINDS = ['page', 'component', 'api', 'entity', 'workflow', 'integration', 'job'] as const

export const StorySchema = z.object({
  id: z.string().describe('Stable id such as US-3'),
  title: z.string(),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  acceptance: z.array(z.string()).describe('Acceptance criteria, ideally Given/When/Then'),
  priority: z.enum(['must', 'should', 'could', 'wont']),
  status: z.enum(['draft', 'ready', 'implemented', 'verified']),
  screenIds: z.array(z.string()),
})
export type Story = z.infer<typeof StorySchema>

export const WireElementSchema = z.object({
  id: z.string(),
  kind: z.enum(ELEMENT_KINDS),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  label: z.string(),
  note: z.string(),
  storyIds: z.array(z.string()),
})
export type WireElement = z.infer<typeof WireElementSchema>

export const ScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  elements: z.array(WireElementSchema),
})
export type Screen = z.infer<typeof ScreenSchema>

export const BlockNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(BLOCK_KINDS),
  label: z.string(),
  description: z.string(),
  x: z.number(),
  y: z.number(),
  storyIds: z.array(z.string()),
})
export type BlockNode = z.infer<typeof BlockNodeSchema>

export const BlockEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string(),
})
export type BlockEdge = z.infer<typeof BlockEdgeSchema>

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

export interface StackConfig {
  backend: 'dotnet' | 'node' | 'python'
  frontend: 'react' | 'vue'
  hosting: 'azure-container-apps' | 'aks' | 'app-service' | 'azure-static-web-apps'
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

export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  stack: StackConfig
  stories: Story[]
  screens: Screen[]
  blocks: { nodes: BlockNode[]; edges: BlockEdge[] }
  annotations: Annotation[]
  testReport?: TestReport
}

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'description' | 'updatedAt'>

// ---- agent contract ------------------------------------------------------------------------

export const OpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('story.upsert'), story: StorySchema }),
  z.object({ type: z.literal('story.delete'), id: z.string() }),
  z.object({ type: z.literal('screen.upsert'), screen: ScreenSchema }),
  z.object({ type: z.literal('screen.delete'), id: z.string() }),
  z.object({ type: z.literal('element.upsert'), screenId: z.string(), element: WireElementSchema }),
  z.object({ type: z.literal('element.delete'), screenId: z.string(), id: z.string() }),
  z.object({ type: z.literal('block.upsert'), node: BlockNodeSchema }),
  z.object({ type: z.literal('block.delete'), id: z.string() }),
  z.object({ type: z.literal('edge.upsert'), edge: BlockEdgeSchema }),
  z.object({ type: z.literal('edge.delete'), id: z.string() }),
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
  refs: z.array(z.string()).describe('Ids of the stories, screens, elements or blocks involved'),
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
  text: string
  stage: Stage
  proposals: (Proposal & { status: 'pending' | 'accepted' | 'rejected' })[]
  conflicts: Conflict[]
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
  kind: 'log' | 'tool' | 'text' | 'done' | 'error'
  text: string
  at: string
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
    stack: { backend: 'dotnet', frontend: 'react', hosting: 'azure-container-apps', agent: 'claude' },
    stories: [],
    screens: [{ id: 'screen-1', name: 'Domů', width: 1280, height: 800, elements: [] }],
    blocks: { nodes: [], edges: [] },
    annotations: [],
  }
}

/** Story ids referenced in a test title like "[US-3] user can log in". */
export const storyIdsInTitle = (title: string): string[] => [...title.matchAll(/\[(US-\d+)\]/g)].map((m) => m[1]!)

const byId = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

/** Applies the model ops of a proposal. File ops are left to the caller (they touch the workspace). */
export const applyOps = (project: Project, ops: Op[]): Project => {
  let p = project
  for (const op of ops) {
    switch (op.type) {
      case 'story.upsert':
        p = { ...p, stories: byId(p.stories, op.story) }
        break
      case 'story.delete':
        p = { ...p, stories: p.stories.filter((s) => s.id !== op.id) }
        break
      case 'screen.upsert':
        p = { ...p, screens: byId(p.screens, op.screen) }
        break
      case 'screen.delete':
        p = { ...p, screens: p.screens.filter((s) => s.id !== op.id) }
        break
      case 'element.upsert':
        p = {
          ...p,
          screens: p.screens.map((s) => (s.id === op.screenId ? { ...s, elements: byId(s.elements, op.element) } : s)),
        }
        break
      case 'element.delete':
        p = {
          ...p,
          screens: p.screens.map((s) =>
            s.id === op.screenId ? { ...s, elements: s.elements.filter((e) => e.id !== op.id) } : s,
          ),
        }
        break
      case 'block.upsert':
        p = { ...p, blocks: { ...p.blocks, nodes: byId(p.blocks.nodes, op.node) } }
        break
      case 'block.delete':
        p = {
          ...p,
          blocks: {
            nodes: p.blocks.nodes.filter((n) => n.id !== op.id),
            edges: p.blocks.edges.filter((e) => e.from !== op.id && e.to !== op.id),
          },
        }
        break
      case 'edge.upsert':
        p = { ...p, blocks: { ...p.blocks, edges: byId(p.blocks.edges, op.edge) } }
        break
      case 'edge.delete':
        p = { ...p, blocks: { ...p.blocks, edges: p.blocks.edges.filter((e) => e.id !== op.id) } }
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
