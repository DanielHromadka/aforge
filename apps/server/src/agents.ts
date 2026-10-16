// Agent providers. The consultant (structured replies with proposals) runs through the Anthropic API
// when ANTHROPIC_API_KEY is set, otherwise through the logged-in Claude Code CLI. Implementation runs
// Claude Code or Codex headless inside the project's workspace.
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { AgentReplySchema, type AgentReply, type BuildEvent } from '@aforge/shared'
import { run, streamLines, which } from './proc.js'

const MODEL = process.env.AFORGE_MODEL ?? 'claude-opus-5-5'

const replyJsonSchema = (() => {
  const { $schema: _, ...schema } = z.toJSONSchema(AgentReplySchema) as Record<string, unknown>
  return schema
})()

const parseReply = (raw: unknown): AgentReply => {
  const parsed = AgentReplySchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw)
  if (!parsed.success) throw new Error(`Agent vrátil odpověď mimo schéma: ${parsed.error.message.slice(0, 400)}`)
  return parsed.data
}

const consultViaApi = async (system: string, prompt: string): Promise<AgentReply> => {
  const client = new Anthropic()
  // Server-side fallback ("default") reruns a declined request on a suitable model inside the same call.
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: replyJsonSchema } },
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') throw new Error('Model požadavek odmítl.')
  if (message.stop_reason === 'max_tokens') throw new Error('Odpověď agenta byla příliš dlouhá a byla useknuta.')
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  return parseReply(text)
}

const consultViaCli = async (system: string, prompt: string): Promise<AgentReply> => {
  const res = await run(
    'claude',
    [
      '-p',
      '--output-format', 'json',
      '--tools', '',
      '--no-session-persistence',
      '--model', process.env.AFORGE_CLI_MODEL ?? 'opus',
      '--system-prompt', system,
      '--json-schema', JSON.stringify(replyJsonSchema),
    ],
    { input: prompt, env: { ...process.env, ANTHROPIC_API_KEY: undefined } },
  )
  if (res.code !== 0 && !res.stdout) throw new Error(`Claude Code skončil s chybou: ${res.stderr.slice(0, 600)}`)
  const out = JSON.parse(res.stdout) as { is_error?: boolean; result?: string; structured_output?: unknown }
  if (out.is_error) throw new Error(`Claude Code: ${out.result ?? 'neznámá chyba'}`)
  return parseReply(out.structured_output ?? out.result)
}

export const consult = (system: string, prompt: string): Promise<AgentReply> =>
  process.env.ANTHROPIC_API_KEY ? consultViaApi(system, prompt) : consultViaCli(system, prompt)

export const detectProviders = async () => {
  const [claude, codex, docker] = await Promise.all([
    which('claude'),
    which('codex'),
    run('docker', ['info', '--format', '{{.ServerVersion}}']).then((r) => r.code === 0),
  ])
  const runtimeImage = docker && (await run('docker', ['image', 'inspect', 'aforge-runtime:latest'])).code === 0
  return { claude, codex, docker, runtimeImage, anthropicApi: Boolean(process.env.ANTHROPIC_API_KEY) }
}

// ---- implementation ------------------------------------------------------------------------

/** Tools Claude Code may use without asking; anything else is denied in headless mode. */
const CLAUDE_ALLOWED = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite',
  'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(dotnet:*)', 'Bash(git:*)', 'Bash(python3:*)',
  'Bash(pip:*)', 'Bash(mkdir:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(chmod:*)', 'Bash(mv:*)', 'Bash(cp:*)',
]

const now = () => new Date().toISOString()

const summarizeInput = (input: Record<string, unknown>): string => {
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.description
  return typeof v === 'string' ? v.slice(0, 200) : ''
}

/** Claude Code's stream-json: one JSON object per line. */
const claudeLine = (line: string): BuildEvent[] => {
  let msg: { type?: string; subtype?: string; result?: string; message?: { content?: unknown[] } }
  try {
    msg = JSON.parse(line)
  } catch {
    return line.trim() ? [{ kind: 'log', text: line, at: now() }] : []
  }
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    return msg.message.content.flatMap((b): BuildEvent[] => {
      const block = b as { type: string; text?: string; name?: string; input?: Record<string, unknown> }
      if (block.type === 'text' && block.text?.trim()) return [{ kind: 'text', text: block.text, at: now() }]
      if (block.type === 'tool_use') return [{ kind: 'tool', text: `${block.name} ${summarizeInput(block.input ?? {})}`, at: now() }]
      return []
    })
  }
  if (msg.type === 'result') return [{ kind: 'text', text: msg.result ?? `Hotovo (${msg.subtype})`, at: now() }]
  return []
}

/** Codex `exec --json`: JSONL events; the shapes vary between versions, so read them loosely. */
const codexLine = (line: string): BuildEvent[] => {
  let msg: { type?: string; item?: { type?: string; text?: string; command?: string; changes?: { path: string }[] } }
  try {
    msg = JSON.parse(line)
  } catch {
    return line.trim() ? [{ kind: 'log', text: line, at: now() }] : []
  }
  const item = msg.item
  if (!item || msg.type !== 'item.completed') return []
  if (item.type === 'agent_message' && item.text) return [{ kind: 'text', text: item.text, at: now() }]
  if (item.type === 'command_execution') return [{ kind: 'tool', text: `Bash ${item.command ?? ''}`, at: now() }]
  if (item.type === 'file_change') return [{ kind: 'tool', text: `Edit ${(item.changes ?? []).map((c) => c.path).join(', ')}`, at: now() }]
  return []
}

export const implement = (agent: 'claude' | 'codex', cwd: string, prompt: string, onEvent: (e: BuildEvent) => void) => {
  if (agent === 'codex') {
    return streamLines(
      'codex',
      ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', cwd, prompt],
      { cwd },
      (line, stream) => (stream === 'err' ? onEvent({ kind: 'log', text: line, at: now() }) : codexLine(line).forEach(onEvent)),
    )
  }
  return streamLines(
    'claude',
    [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ...CLAUDE_ALLOWED,
    ],
    { cwd, env: { ...process.env, ANTHROPIC_API_KEY: process.env.AFORGE_PASS_API_KEY ? process.env.ANTHROPIC_API_KEY : undefined } },
    (line, stream) => (stream === 'err' ? onEvent({ kind: 'log', text: line, at: now() }) : claudeLine(line).forEach(onEvent)),
  )
}
