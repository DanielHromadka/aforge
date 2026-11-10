import type { AgentUsage } from '@aforge/shared'

const count = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {}
const sum = (...values: (number | undefined)[]) => values.some((v) => v !== undefined) ? values.reduce<number>((a, b) => a + (b ?? 0), 0) : undefined

/** CLI totals are snapshots, not increments. Cache reads are already included in Codex input. */
export const usageOf = (provider: 'claude' | 'codex', raw: unknown): AgentUsage | undefined => {
  const msg = record(raw)
  const u = record(msg.usage)
  const models = record(msg.modelUsage)
  const entries: (Record<string, unknown> & { model: string })[] = Object.entries(models).map(([model, value]) => ({ model, ...record(value) }))
  const only = entries.length === 1 ? entries[0] : undefined
  const message = record(msg.message)
  const current = record(message.usage)
  const model = typeof message.model === 'string' ? message.model : typeof msg.model === 'string' ? msg.model : only?.model
  const cost = count(msg.total_cost_usd)
  const result: AgentUsage = { model }
  if (provider === 'codex') {
    result.inputTokens = count(u.input_tokens)
    result.outputTokens = count(u.output_tokens)
    result.cachedInputTokens = count(u.cached_input_tokens)
    // Some CLI versions expose current context separately from aggregate turn usage.
    result.contextTokens = count(msg.context_tokens)
    result.contextWindow = count(msg.model_context_window)
  } else {
    if (msg.type === 'result' || !msg.type) {
      result.inputTokens = sum(count(u.input_tokens), count(u.cache_read_input_tokens), count(u.cache_creation_input_tokens))
      result.outputTokens = count(u.output_tokens)
      result.cachedInputTokens = count(u.cache_read_input_tokens)
      result.cacheWriteTokens = count(u.cache_creation_input_tokens)
      result.contextWindow = count(only?.contextWindow)
    }
    // Each assistant message describes one request, not the whole agent run.
    result.contextTokens = sum(count(current.input_tokens), count(current.cache_read_input_tokens), count(current.cache_creation_input_tokens), count(current.output_tokens))
    if (cost !== undefined) { result.costUsd = cost; result.costSource = 'provider' }
  }
  const present = Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as AgentUsage
  return Object.keys(present).length ? present : undefined
}
