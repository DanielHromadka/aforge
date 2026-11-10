// Running the agent CLIs headless, shared by the hub (local mode) and the worker daemon. Both use the
// CLI's own login (subscription), so ANTHROPIC_API_KEY is not passed on unless asked for.
import { sandboxEnabled, sandboxProcess } from './sandbox.js'
import { watchCodexUsage } from './codex-usage.js'
import { usageOf } from './usage.js'
import type { AgentUsage, BuildEvent } from '@aforge/shared'
import { run, streamLines, which } from './proc.js'

export { run, streamLines, which } from './proc.js'
export { usageOf } from './usage.js'
export { createJobNetwork, removeJobNetwork, containerRestrictions, proxyArgs, sandboxProcess } from './sandbox.js'
export { shutdownProcesses } from './proc.js'

const cliEnv = () => ({ ...process.env, ANTHROPIC_API_KEY: process.env.AFORGE_PASS_API_KEY ? process.env.ANTHROPIC_API_KEY : undefined })

/** One structured answer from Claude Code: no tools, the reply validated by the CLI against `schema`. */
export const consultCli = async (system: string, prompt: string, schema: Record<string, unknown>, onUsage?: (usage: AgentUsage) => void, onStart?: (kill: () => void) => void): Promise<unknown> => {
  let out: { is_error?: boolean; result?: string; structured_output?: unknown } | undefined
  let stderr = ''
  const invoke = sandboxEnabled() || process.env.NODE_ENV === 'production' ? (cmd: string, args: string[], opts: { input: string; env?: NodeJS.ProcessEnv }, onLine: (line: string, stream: 'out' | 'err') => void) => sandboxProcess(cmd, args, undefined, opts.input, onLine) : streamLines
  const job = invoke(
    'claude',
    [
      '-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence',
      '--model', process.env.AFORGE_CLI_MODEL ?? 'opus', '--system-prompt', system, '--json-schema', JSON.stringify(schema),
    ],
    { input: prompt, env: cliEnv() },
    (line, stream) => {
      if (stream === 'err') { stderr = (stderr + line).slice(-2000); return }
      try {
        const raw = JSON.parse(line)
        const usage = usageOf('claude', raw)
        if (usage) onUsage?.(usage)
        if (raw.type === 'result') out = raw
      } catch { /* Non-JSON diagnostic lines are not structured answers. */ }
    },
  )
  onStart?.(job.kill)
  const code = await job.done
  if (!out) throw new Error(`Claude Code skončil bez odpovědi (kód ${code}): ${stderr.slice(0, 600)}`)
  if (out.is_error || code !== 0) throw new Error(`Claude Code: ${out.result ?? stderr ?? 'neznámá chyba'}`)
  return out.structured_output ?? (typeof out.result === 'string' ? JSON.parse(out.result) : out.result)
}

export const detectCapabilities = async () => {
  const [claude, codex, git, docker] = await Promise.all([
    which('claude'),
    which('codex'),
    which('git'),
    run('docker', ['info', '--format', '{{.ServerVersion}}']).then((r) => r.code === 0),
  ])
  if (sandboxEnabled() && docker) {
    const available = (await run('docker', ['image', 'inspect', process.env.AFORGE_AGENT_IMAGE ?? 'reactor-agent:latest'])).code === 0
    return { claude: available && Boolean(process.env.ANTHROPIC_API_KEY), codex: available && Boolean(process.env.OPENAI_API_KEY), git, docker }
  }
  return { claude, codex, git, docker }
}

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
  const isolated = sandboxEnabled() || process.env.NODE_ENV === 'production'
  const watcher = agent === 'codex' && !isolated ? watchCodexUsage((usage) => onEvent({ kind: 'usage', text: '', at: now(), usage })) : undefined
  const onLine = (parse: (l: string) => BuildEvent[]) => (line: string, stream: 'out' | 'err') => {
      if (stream === 'err') { onEvent({ kind: 'log', text: line, at: now() }); return }
      try {
        const raw = JSON.parse(line)
        watcher?.line(raw)
        const usage = usageOf(agent, raw)
        if (usage) onEvent({ kind: 'usage', text: '', at: now(), usage })
        if ((raw.type === 'result' && raw.is_error) || raw.type === 'turn.failed' || raw.type === 'error') onEvent({ kind: 'error', text: raw.result ?? raw.error?.message ?? raw.message ?? 'Agent nedokončil úlohu', at: now() })
      } catch { /* Non-JSON lines are handled by the log parser. */ }
      parse(line).forEach(onEvent)
    }
  if (agent === 'codex') {
    const args = ['exec', '--json', ...(isolated ? ['--dangerously-bypass-approvals-and-sandbox', '-c', 'model_providers.openai.base_url="http://model-gateway:8080/v1"'] : ['--sandbox', 'workspace-write']), '--skip-git-repo-check', '-C', isolated ? '/workspace' : cwd, prompt]
    const job = isolated ? sandboxProcess('codex', args, cwd, undefined, onLine(codexLine)) : streamLines('codex', args, { cwd }, onLine(codexLine))
    return { kill: job.kill, done: job.done.finally(() => watcher?.stop()) }
  }
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ...CLAUDE_ALLOWED]
  return isolated ? sandboxProcess('claude', args, cwd, undefined, onLine(claudeLine)) : streamLines('claude', args, { cwd, env: cliEnv() }, onLine(claudeLine))
}

// ---- git bundles: how a workspace travels between the hub and a worker -----------------------

const git = (cwd: string, args: string[]) => run('git', args, { cwd })

const GIT_ID = ['-c', 'user.name=Reactor', '-c', 'user.email=aforge@localhost']

export const commitAll = async (cwd: string, message: string): Promise<string | null> => {
  await git(cwd, ['add', '-A'])
  if ((await git(cwd, [...GIT_ID, 'commit', '-q', '-m', message])).code !== 0) return null
  return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
}

export const headOf = async (cwd: string) => (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()

/** Bundles the whole repository (`range` omitted) or just new commits ("<base>..HEAD") into `file`. */
export const createBundle = async (cwd: string, file: string, range?: string) => {
  const res = await git(cwd, ['bundle', 'create', file, ...(range ? [range] : ['--all'])])
  if (res.code !== 0) throw new Error(`git bundle: ${res.stderr.trim()}`)
}

export const cloneBundle = async (bundle: string, dir: string) => {
  const res = await run('git', ['clone', '-q', bundle, dir])
  if (res.code !== 0) throw new Error(`git clone: ${res.stderr.trim()}`)
}

/** Fast-forwards the workspace to the tip of a bundle made on top of its HEAD. */
export const applyBundle = async (cwd: string, bundle: string) => {
  const fetched = await git(cwd, ['fetch', '-q', bundle, 'HEAD'])
  if (fetched.code !== 0) throw new Error(`git fetch: ${fetched.stderr.trim()}`)
  const merged = await git(cwd, ['merge', '--ff-only', '-q', 'FETCH_HEAD'])
  if (merged.code !== 0) throw new Error(`git merge: ${merged.stderr.trim()}`)
  return headOf(cwd)
}
