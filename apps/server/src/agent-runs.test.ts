import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRunRegistry, enrichUsage, saveMetrics } from './agent-runs.js'

const context = { projectId: 'test', projectName: 'Test project', step: 'Pipeline · t1 · Review' }
afterEach(() => vi.unstubAllEnvs())
describe('agent run registry', () => {
  it('tracks concurrent local and remote jobs, snapshots, assignment and cancellation independently', () => {
    const r = new AgentRunRegistry()
    const local = r.start(context, 'claude', 'local')
    const remote = r.start({ ...context, projectId: 'second' }, 'codex', 'remote')
    expect(r.list().find((v) => v.id === remote)?.state).toBe('queued')
    r.assign(remote, 'worker-1', 'Build 01')
    r.usage(local, { inputTokens: 100, contextTokens: 50 })
    r.usage(local, { inputTokens: 200, contextTokens: 40 })
    r.usage(remote, { model: 'gpt-test', inputTokens: 1 })
    r.finish(remote, 'cancelled')
    r.usage(remote, { inputTokens: 999 })
    const jobs = r.list()
    expect(jobs.find((v) => v.id === local)).toMatchObject({ state: 'running', usage: { inputTokens: 200, contextTokens: 40 } })
    expect(jobs.find((v) => v.id === remote)).toMatchObject({ state: 'cancelled', host: 'Build 01', workerId: 'worker-1', usage: { inputTokens: 1 } })
    jobs[0]!.usage.inputTokens = 999
    expect(r.list()[0]!.usage.inputTokens).toBe(200)
  })
  it('does not report a model error as success even if the process exits zero', () => {
    const r = new AgentRunRegistry(); const id = r.start(context, 'claude', 'local')
    r.event(id, { kind: 'error', at: '', text: 'Quota exceeded' }); r.finish(id, 'done')
    expect(r.list()[0]).toMatchObject({ state: 'failed', error: 'Quota exceeded' })
  })
  it('persists history and marks unfinished jobs interrupted on server restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aforge-runs-test-'))
    try {
      const file = join(dir, 'runs.json'); const r = new AgentRunRegistry(file)
      r.start(context, 'codex', 'local')
      const id = r.start(context, 'claude', 'local'); r.finish(id, 'done')
      expect(new AgentRunRegistry(file).list().map((v) => v.state)).toEqual(['interrupted', 'done'])
      expect(readFileSync(file, 'utf8')).not.toContain('prompt')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('keeps all active runs while bounding completed history', () => {
    const r = new AgentRunRegistry(); const id = r.start(context, 'claude', 'local')
    for (let i = 0; i < 205; i++) r.finish(r.start(context, 'codex', 'local'), 'done')
    expect(r.list()).toHaveLength(201)
    expect(r.list().some((v) => v.id === id)).toBe(true)
  })
})
describe('cost and limits', () => {
  it('uses exact model rates and discounts cache without double counting', () => {
    vi.stubEnv('AFORGE_MODEL_METRICS', JSON.stringify({ test: { contextWindow: 1000, inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 5 } }))
    expect(enrichUsage({ model: 'test', inputTokens: 1000000, cachedInputTokens: 200000, outputTokens: 100000 })).toEqual({ model: 'test', inputTokens: 1000000, cachedInputTokens: 200000, outputTokens: 100000, contextWindow: 1000, costUsd: 2.3, costSource: 'estimate' })
    expect(enrichUsage({ model: 'test-unknown', inputTokens: 100 })).toEqual({ model: 'test-unknown', inputTokens: 100 })
  })
  it('preserves reported cost and context window, avoids estimating unknown cache prices', () => {
    vi.stubEnv('AFORGE_MODEL_METRICS', JSON.stringify({ test: { contextWindow: 1000, inputUsdPerMillion: 2, outputUsdPerMillion: 5 } }))
    expect(enrichUsage({ model: 'test', costUsd: 0, costSource: 'provider', contextWindow: 500 }).costUsd).toBe(0)
    expect(enrichUsage({ model: 'test', costUsd: 0, costSource: 'provider', contextWindow: 500 }).contextWindow).toBe(500)
    expect(enrichUsage({ model: 'test', inputTokens: 100, outputTokens: 20, cachedInputTokens: 90 }).costUsd).toBeUndefined()
    expect(enrichUsage({ model: 'test', inputTokens: 100, outputTokens: 20, cacheWriteTokens: 1 }).costUsd).toBeUndefined()
  })
  it('rejects malformed settings before writing', () => {
    for (const input of [null, [], { test: { contextWindow: 0 } }, { test: { inputUsdPerMillion: -1 } }, { test: { outputUsdPerMillion: '5' } }]) expect(() => saveMetrics(input)).toThrow()
  })
})
