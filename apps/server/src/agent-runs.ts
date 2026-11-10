// One registry for actual model calls. Prompts, replies and credentials never enter this file.
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRole, AgentRun, AgentUsage, BuildEvent, ModelMetrics } from '@aforge/shared'
import { DATA_DIR } from './store.js'
import { limits, limit, production } from './config.js'
import { sessionContext } from './project-locations.js'

export type RunContext = { projectId: string; projectName: string; step: string; role?: AgentRole; issueId?: string }
export const activeRun = (r: AgentRun) => r.state === 'running' || r.state === 'queued'

const METRICS_FILE = join(DATA_DIR, 'agent-models.json')
const readMetrics = (): Record<string, ModelMetrics> => {
  try { return JSON.parse(readFileSync(METRICS_FILE, 'utf8')) } catch { return {} }
}
let modelMetrics = readMetrics()
// Exact model IDs only. No guessed prices or context limits for aliases / future models.
export const metrics = (): Record<string, ModelMetrics> => {
  try { return { ...modelMetrics, ...JSON.parse(process.env.AFORGE_MODEL_METRICS ?? '{}') } } catch { return modelMetrics }
}
export const saveMetrics = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Neplatné sazby modelů')
  const entries = Object.entries(input)
  if (entries.length > 100) throw new Error('Příliš mnoho modelů')
  const clean: Record<string, ModelMetrics> = {}
  for (const [model, spec] of entries) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model) || !spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Neplatné id modelu nebo sazby')
    const row: ModelMetrics = {}
    for (const key of ['contextWindow', 'inputUsdPerMillion', 'cachedInputUsdPerMillion', 'outputUsdPerMillion'] as const) {
      const value = (spec as ModelMetrics)[key]
      if (value === undefined) continue
      if (!valid(value) || value > 1e9 || (key === 'contextWindow' && (!Number.isInteger(value) || value === 0))) throw new Error('Sazby musí být nezáporná čísla a okno kladné celé číslo')
      row[key] = value
    }
    clean[model] = row
  }
  const tmp = `${METRICS_FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 })
  renameSync(tmp, METRICS_FILE)
  modelMetrics = clean
  return metrics()
}
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
export const enrichUsage = (usage: AgentUsage): AgentUsage => {
  const spec = usage.model ? metrics()[usage.model] : undefined
  const out = { ...usage }
  if (!spec) return out
  if (out.contextWindow === undefined && valid(spec.contextWindow) && spec.contextWindow > 0) out.contextWindow = spec.contextWindow
  if (out.costSource === 'provider') return out
  // Cache creation pricing varies by TTL; require provider cost when it is used.
  if (out.inputTokens !== undefined && out.outputTokens !== undefined && !out.cacheWriteTokens && valid(spec.inputUsdPerMillion) && valid(spec.outputUsdPerMillion)) {
    const cached = out.cachedInputTokens ?? 0
    if (cached > out.inputTokens || (cached && !valid(spec.cachedInputUsdPerMillion))) return out
    out.costUsd = (Math.max(0, out.inputTokens - cached) * spec.inputUsdPerMillion + cached * (spec.cachedInputUsdPerMillion ?? 0) + out.outputTokens * spec.outputUsdPerMillion) / 1_000_000
    out.costSource = 'estimate'
  }
  return out
}

type Totals = Record<string, { runs: number; costUsd: number }>
const rootOf = (r: AgentRun) => r.rootProjectId ?? r.projectId

export class AgentRunRegistry {
  private runs: AgentRun[] = []
  /** Per project, all runs ever: the history keeps only the latest ones, a project card needs the sum. */
  private totals: Totals = {}
  private daily: { day: string; counts: Record<string, number> } = { day: '', counts: {} }
  constructor(private file?: string) {
    if (!file) return
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as AgentRun[]
      this.runs = saved.map((r) => activeRun(r) ? { ...r, state: 'interrupted', finishedAt: new Date().toISOString(), error: 'Server byl restartován; stav běhu už nelze sledovat.' } : r)
      if (saved.some(activeRun)) this.save()
    } catch { /* First start has no history. */ }
    try { this.daily = JSON.parse(readFileSync(file.replace(/\.json$/, '-daily.json'), 'utf8')) } catch { /* first day */ }
    try { this.totals = JSON.parse(readFileSync(this.totalsFile, 'utf8')) as Totals }
    catch {
      // Before totals existed, the history is the best start.
      for (const r of this.runs.filter((x) => !activeRun(x))) this.count(r)
      this.saveTotals()
    }
  }
  private get totalsFile() { return this.file!.replace(/\.json$/, '-totals.json') }
  private count(r: AgentRun) {
    const t = (this.totals[rootOf(r)] ??= { runs: 0, costUsd: 0 })
    t.runs += 1
    t.costUsd += enrichUsage(r.usage).costUsd ?? 0
  }
  private saveTotals() {
    if (!this.file) return
    const tmp = `${this.totalsFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(tmp, JSON.stringify(this.totals, null, 2), { mode: 0o600 })
    renameSync(tmp, this.totalsFile)
  }
  totalsOf(projectId: string) { return this.totals[projectId] ?? { runs: 0, costUsd: 0 } }
  private save() {
    // Retain all live jobs even when the recent history reaches its cap.
    this.runs = [...this.runs.filter(activeRun), ...this.runs.filter((r) => !activeRun(r)).slice(0, 200)]
    if (!this.file) return
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(tmp, JSON.stringify(this.runs, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
  hasActive(projectId: string) { return this.runs.some((r) => r.projectId === projectId && activeRun(r)) }
  list(): AgentRun[] { return structuredClone(this.runs.map((r) => ({ ...r, usage: enrichUsage(r.usage) }))) }
  start(context: RunContext, agent: AgentRun['agent'], location: AgentRun['location']) {
    const root = (() => { try { return sessionContext(context.projectId).projectId } catch { return context.projectId } })()
    const active = this.runs.filter(activeRun)
    if (active.length >= limits.jobs || active.filter((r) => rootOf(r) === root).length >= limits.projectJobs) throw Object.assign(new Error('Byl dosažen limit souběžných agentů. Počkejte na dokončení běžící práce.'), { statusCode: 429 })
    const day = new Date().toISOString().slice(0, 10)
    if (this.daily.day !== day) this.daily = { day, counts: {} }
    if ((this.daily.counts[root] ?? 0) >= limit('AFORGE_PROJECT_DAILY_RUNS', production ? 100 : 10000)) throw Object.assign(new Error('Projekt vyčerpal dnešní počet spuštění agentů.'), { statusCode: 429 })
    this.daily.counts[root] = (this.daily.counts[root] ?? 0) + 1
    if (this.file) {
      const file = this.file.replace(/\.json$/, '-daily.json'), tmp = file + `.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(this.daily), { mode: 0o600 }); renameSync(tmp, file)
    }
    const run: AgentRun = { projectId: context.projectId, projectName: context.projectName, step: context.step, ...(context.role ? { role: context.role } : {}), ...(context.issueId ? { issueId: context.issueId } : {}), id: randomUUID(), agent, location, host: location === 'local' ? hostname() : 'Čeká na workera', state: location === 'remote' ? 'queued' : 'running', startedAt: new Date().toISOString(), usage: {} }
    try { const context = sessionContext(run.projectId); run.rootProjectId = context.projectId; run.sessionName = context.name } catch { /* Compatibility with callers outside a saved project. */ }
    this.runs.unshift(run)
    this.save()
    return run.id
  }
  assign(id: string, workerId: string, name: string) { this.patch(id, { workerId, host: name, state: 'running' }) }
  usage(id: string, patch: AgentUsage) {
    const run = this.runs.find((r) => r.id === id)
    if (!run || !activeRun(run)) return
    const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => k === 'model' ? typeof v === 'string' && v.length <= 120 : k === 'costSource' ? v === 'provider' || v === 'estimate' : ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'contextTokens', 'contextWindow', 'costUsd'].includes(k) && valid(v)))
    this.patch(id, { usage: { ...run.usage, ...clean } })
  }
  event(id: string, event: BuildEvent) {
    if (event.usage) this.usage(id, event.usage)
    if (event.kind === 'tool') this.patch(id, { activity: event.text.slice(0, 240) })
    if (event.kind === 'error') this.patch(id, { error: event.text.slice(0, 600) })
  }
  finish(id: string, state: 'done' | 'failed' | 'cancelled', error?: string) {
    const run = this.runs.find((r) => r.id === id)
    if (!run || !activeRun(run)) return
    this.patch(id, { state: state === 'done' && run.error ? 'failed' : state, finishedAt: new Date().toISOString(), ...(error ? { error: error.slice(0, 600) } : {}) })
    this.count(run)
    this.saveTotals()
  }
  private patch(id: string, patch: Partial<AgentRun>) {
    const run = this.runs.find((r) => r.id === id)
    if (run) { Object.assign(run, patch); this.save() }
  }
}

export const agentRuns = new AgentRunRegistry(join(DATA_DIR, 'agent-runs.json'))
