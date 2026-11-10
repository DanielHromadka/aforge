// exec JSONL provides aggregate usage. Its own session file supplies current context and model.
// Read only the session ID announced by this child process, never other conversations.
import { readdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentUsage } from '@aforge/shared'

export const codexSessionUsage = (text: string): AgentUsage | undefined => {
  let model: string | undefined
  let usage: AgentUsage | undefined
  for (const line of text.split('\n')) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'turn_context' && typeof event.payload?.model === 'string') model = event.payload.model
      if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue
      const info = event.payload.info
      if (!info) continue
      const total = info.total_token_usage ?? {}
      const last = info.last_token_usage ?? {}
      usage = {
        inputTokens: total.input_tokens, cachedInputTokens: total.cached_input_tokens, outputTokens: total.output_tokens,
        contextTokens: last.total_tokens, contextWindow: info.model_context_window,
      }
    } catch { /* A bounded tail can start/end inside an unfinished line. */ }
  }
  return usage || model ? { ...usage, ...(model ? { model } : {}) } : undefined
}

export const watchCodexUsage = (onUsage: (u: AgentUsage) => void) => {
  let thread: string | undefined
  let file: string | undefined
  let busy = false
  let stopped = false
  let previous = ''
  const poll = async () => {
    if (busy || !thread) return
    busy = true
    try {
      if (!file) {
        for (const offset of [0, 86400000]) {
          const [year, month, day] = new Date(Date.now() - offset).toISOString().slice(0, 10).split('-')
          const dir = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions', year!, month!, day!)
          const names = await readdir(dir).catch(() => [])
          const name = names.find((n) => n.endsWith(`-${thread}.jsonl`))
          if (name) { file = join(dir, name); break }
        }
      }
      if (!file) return
      const handle = await open(file, 'r')
      try {
        const { size } = await handle.stat()
        const length = Math.min(size, 256 * 1024)
        const buf = Buffer.alloc(length)
        await handle.read(buf, 0, length, size - length)
        const usage = codexSessionUsage(buf.toString('utf8'))
        const serialized = JSON.stringify(usage)
        if (usage && previous !== serialized && !stopped) { previous = serialized; onUsage(usage) }
      } finally { await handle.close() }
    } catch { /* exec usage remains available if session persistence is disabled. */ }
    finally { busy = false }
  }
  const timer = setInterval(() => void poll(), 2000)
  timer.unref()
  return {
    line(raw: unknown) {
      const msg = raw as { type?: string; thread_id?: string }
      if (msg.type === 'thread.started' && typeof msg.thread_id === 'string' && /^[a-zA-Z0-9-]+$/.test(msg.thread_id)) thread = msg.thread_id
    },
    async stop() { clearInterval(timer); while (busy) await new Promise((r) => setTimeout(r, 10)); await poll(); stopped = true },
  }
}
