import { describe, expect, it } from 'vitest'
import { usageOf } from './usage.js'
import { codexSessionUsage } from './codex-usage.js'

describe('provider usage', () => {
  it('keeps Codex cached input inside total input and never mistakes cumulative tokens for context', () => {
    expect(usageOf('codex', { type: 'turn.completed', usage: { input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122 } })).toEqual({ inputTokens: 24763, outputTokens: 122, cachedInputTokens: 24448 })
  })
  it('normalizes Claude cache categories and retains reported zero cost', () => {
    expect(usageOf('claude', { type: 'result', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 }, total_cost_usd: 0, modelUsage: { opus: { contextWindow: 200000 } } })).toEqual({ model: 'opus', inputTokens: 330, outputTokens: 20, cachedInputTokens: 200, cacheWriteTokens: 30, contextWindow: 200000, costUsd: 0, costSource: 'provider' })
  })
  it('reads current Claude request separately from run totals', () => {
    expect(usageOf('claude', { type: 'assistant', message: { model: 'opus', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 20 } } })).toEqual({ model: 'opus', contextTokens: 120 })
  })
  it('does not invent absent or invalid measurements', () => {
    expect(usageOf('codex', { type: 'item.completed' })).toBeUndefined()
    expect(usageOf('claude', { type: 'result', total_cost_usd: -1, usage: { input_tokens: '123', output_tokens: NaN } })).toBeUndefined()
  })
  it('reads the latest Codex context after compaction rather than accumulating snapshots', () => {
    const event = (total: number, last: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 50, cached_input_tokens: 100 }, last_token_usage: { total_tokens: last }, model_context_window: 1000 } } })
    const text = ['partial JSON', JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-test' } }), event(1000, 900), event(1300, 300), '{'].join('\n')
    expect(codexSessionUsage(text)).toEqual({ model: 'gpt-test', inputTokens: 1300, outputTokens: 50, cachedInputTokens: 100, contextTokens: 300, contextWindow: 1000 })
  })
})
