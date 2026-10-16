// The hub: aForge's side of the relay. It holds the room secret, knows the enrolled workers and their
// keys, keeps one session per connected worker and hands out jobs by capability, label and load.
// Config (secret, relay, mode, worker keys) lives in data/hub.json, readable by this server only.
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import {
  Assembler, HELLO_MAX_AGE_MS, PROTOCOL_VERSION, chunksOf, enrollmentToken, newSecret, newWorkerId, newWorkerKey, open,
  peekWorker, randomId, roomOf, roomUrl, seal, splitConnection, withConnection,
  type Capabilities, type JobSpec, type RelayControl, type ToHub, type ToWorker,
} from '@aforge/protocol'
import type { BuildEvent, HubStatus } from '@aforge/shared'
import { DATA_DIR } from './store.js'

interface WorkerRecord {
  id: string
  key: string
  name: string
  createdAt: string
}

interface HubConfig {
  secret: string
  relay: string
  mode: 'local' | 'remote'
  workers: WorkerRecord[]
}

interface Session {
  c: number
  worker: string
  s: string
  name: string
  caps: Capabilities
  labels: string[]
  maxJobs: number
  running: Set<string>
  since: string
}

interface Job {
  id: string
  c: number
  worker: string
  onEvent?: (e: BuildEvent) => void
  out?: Assembler
  outData?: Buffer
  resolve: (v: { data: unknown; file?: Buffer }) => void
  reject: (e: Error) => void
}

const CONFIG = join(DATA_DIR, 'hub.json')

const loadConfig = (): HubConfig => {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8')) as HubConfig
  } catch {
    return { secret: newSecret(), relay: process.env.AFORGE_RELAY ?? 'ws://localhost:8787', mode: 'local', workers: [] }
  }
}

class Hub {
  private config = loadConfig()
  private ws?: WebSocket
  private connected = false
  private error?: string
  private sessions = new Map<number, Session>()
  private jobs = new Map<string, Job>()
  private retry = 1000
  private ping?: NodeJS.Timeout
  private listeners = new Set<() => void>()

  constructor() {
    this.save()
  }

  private save() {
    const tmp = `${CONFIG}.tmp`
    writeFileSync(tmp, JSON.stringify(this.config, null, 2))
    chmodSync(tmp, 0o600)
    renameSync(tmp, CONFIG)
  }

  /** UI refreshes on any change of connection or worker state. */
  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed() {
    for (const fn of this.listeners) fn()
  }

  mode() {
    return this.config.mode
  }

  status(): HubStatus {
    const online = new Map([...this.sessions.values()].map((s) => [s.worker, s]))
    return {
      relay: this.config.relay,
      mode: this.config.mode,
      connected: this.connected,
      error: this.error,
      workers: this.config.workers.map((w) => {
        const s = online.get(w.id)
        return {
          id: w.id,
          name: s?.name ?? w.name,
          online: !!s,
          caps: s?.caps,
          labels: s?.labels ?? [],
          running: s?.running.size ?? 0,
          maxJobs: s?.maxJobs ?? 0,
          since: s?.since,
          createdAt: w.createdAt,
        }
      }),
    }
  }

  configure(patch: { relay?: string; mode?: 'local' | 'remote' }) {
    if (patch.relay !== undefined) {
      if (!/^wss?:\/\/[^\s]+$/.test(patch.relay)) throw new Error('Adresa relaye musí začínat ws:// nebo wss://')
      this.config.relay = patch.relay.replace(/\/+$/, '')
    }
    if (patch.mode) this.config.mode = patch.mode
    this.save()
    if (patch.relay !== undefined) this.reconnect()
    this.changed()
  }

  enroll(name: string): string {
    const record: WorkerRecord = { id: newWorkerId(), key: newWorkerKey(), name: name.trim() || 'worker', createdAt: new Date().toISOString() }
    this.config.workers.push(record)
    this.save()
    this.changed()
    return enrollmentToken({ v: PROTOCOL_VERSION, relay: this.config.relay, room: roomOf(this.config.secret), id: record.id, key: record.key, hub: 'aForge' })
  }

  revoke(id: string) {
    this.config.workers = this.config.workers.filter((w) => w.id !== id)
    this.save()
    for (const s of this.sessions.values()) if (s.worker === id) this.drop(s.c, 'revoked')
    this.changed()
  }

  start() {
    if (this.config.workers.length || this.config.mode === 'remote' || process.env.AFORGE_RELAY) this.connect()
  }

  private reconnect() {
    this.ws?.close()
    this.retry = 1000
    this.connect()
  }

  private connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    const url = roomUrl(this.config.relay, roomOf(this.config.secret), 'host')
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', secret: this.config.secret } satisfies RelayControl))
    ws.onmessage = (e) => (typeof e.data === 'string' ? this.onControl(e.data) : this.onFrame(new Uint8Array(e.data as ArrayBuffer)))
    ws.onerror = () => {
      this.error = `Relay ${this.config.relay} není dostupný`
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      clearInterval(this.ping)
      this.connected = false
      if (e.code === 4003) this.error = 'Relay odmítl tajemství hubu'
      for (const c of [...this.sessions.keys()]) this.endSession(c, 'Spojení s relayem se přerušilo')
      this.changed()
      setTimeout(() => this.connect(), this.retry)
      this.retry = Math.min(this.retry * 2, 30_000)
    }
  }

  private onControl(text: string) {
    if (text === 'pong') return
    let msg: RelayControl
    try {
      msg = JSON.parse(text) as RelayControl
    } catch {
      return
    }
    if (msg.t === 'ready') {
      this.connected = true
      this.error = undefined
      this.retry = 1000
      clearInterval(this.ping)
      this.ping = setInterval(() => this.ws?.send('ping'), 25_000)
      this.changed()
    }
    if (msg.t === 'close') this.endSession(msg.c, 'Worker se odpojil')
  }

  private keyOf(worker: string) {
    return this.config.workers.find((w) => w.id === worker)?.key
  }

  private sendTo(c: number, worker: string, msg: ToWorker) {
    const key = this.keyOf(worker)
    if (key && this.ws?.readyState === WebSocket.OPEN) this.ws.send(withConnection(c, seal(worker, key, msg)))
  }

  private drop(c: number, reason: string) {
    this.ws?.send(JSON.stringify({ t: 'close', c } satisfies RelayControl))
    this.endSession(c, reason)
  }

  private endSession(c: number, reason: string) {
    if (!this.sessions.delete(c)) return
    for (const job of [...this.jobs.values()]) {
      if (job.c !== c) continue
      this.jobs.delete(job.id)
      job.reject(new Error(reason))
    }
    this.changed()
  }

  private onFrame(frame: Uint8Array) {
    const { c, payload } = splitConnection(frame)
    const worker = peekWorker(payload)
    const key = worker && this.keyOf(worker)
    const opened = key ? open<ToHub>(payload, key) : null
    if (!opened) return this.drop(c, 'unknown worker')
    const msg = opened.message
    if (msg.t === 'hello') {
      if (msg.version !== PROTOCOL_VERSION || Math.abs(Date.now() - msg.ts) > HELLO_MAX_AGE_MS) return this.drop(c, 'stale hello')
      // A worker that reconnects replaces its old session.
      for (const s of this.sessions.values()) if (s.worker === opened.worker && s.c !== c) this.endSession(s.c, 'Worker se připojil znovu')
      const session: Session = {
        c,
        worker: opened.worker,
        s: randomId(),
        name: String(msg.name).slice(0, 60),
        caps: msg.caps,
        labels: (msg.labels ?? []).map(String).slice(0, 20),
        maxJobs: Math.max(1, Math.min(8, Number(msg.maxJobs) || 1)),
        running: new Set(),
        since: new Date().toISOString(),
      }
      this.sessions.set(c, session)
      this.sendTo(c, opened.worker, { t: 'welcome', s: session.s, wn: msg.wn, hub: 'aForge' })
      this.changed()
      return
    }
    const session = this.sessions.get(c)
    if (!session || session.worker !== opened.worker || msg.s !== session.s) return this.drop(c, 'bad session')
    const job = this.jobs.get(msg.job)
    if (!job || job.c !== c) return
    if (msg.t === 'event') job.onEvent?.({ kind: msg.kind, text: msg.text, at: new Date().toISOString() } as BuildEvent)
    if (msg.t === 'chunk') {
      try {
        job.out ??= new Assembler()
        const whole = job.out.push(msg.seq, msg.data, msg.last)
        if (whole) job.outData = whole
      } catch (e) {
        this.finish(session, job)
        job.reject(e as Error)
      }
    }
    if (msg.t === 'result') {
      this.finish(session, job)
      if (msg.ok) job.resolve({ data: msg.data, file: job.outData })
      else job.reject(new Error(msg.error ?? 'Worker úlohu nedokončil'))
    }
  }

  private finish(session: Session, job: Job) {
    this.jobs.delete(job.id)
    session.running.delete(job.id)
    this.changed()
  }

  private pick(needs: keyof Capabilities, labels: string[]): Session | undefined {
    return [...this.sessions.values()]
      .filter((s) => s.caps[needs] && labels.every((l) => s.labels.includes(l)) && s.running.size < s.maxJobs)
      .sort((a, b) => a.running.size / a.maxJobs - b.running.size / b.maxJobs)[0]
  }

  private hasCandidate(needs: keyof Capabilities, labels: string[]) {
    return [...this.sessions.values()].some((s) => s.caps[needs] && labels.every((l) => s.labels.includes(l)))
  }

  /**
   * Runs a job on a free worker, waiting in line while all suitable ones are busy. A label the hub has
   * no online worker for falls back to any worker with the capability, so a small setup still works.
   */
  async run(
    spec: JobSpec,
    opts: { needs: keyof Capabilities; labels?: string[]; input?: Buffer; onEvent?: (e: BuildEvent) => void; waitMs?: number; signal?: AbortSignal },
  ): Promise<unknown> {
    return (await this.runWithFile(spec, opts)).data
  }

  async runWithFile(
    spec: JobSpec,
    opts: { needs: keyof Capabilities; labels?: string[]; input?: Buffer; onEvent?: (e: BuildEvent) => void; waitMs?: number; signal?: AbortSignal },
  ): Promise<{ data: unknown; file?: Buffer }> {
    if (!this.connected) throw new Error('aForge není připojený k relayi – zkontrolujte nastavení Agentů.')
    let labels = opts.labels ?? []
    if (labels.length && !this.hasCandidate(opts.needs, labels)) labels = []
    const deadline = Date.now() + (opts.waitMs ?? 15 * 60_000)
    let session = this.pick(opts.needs, labels)
    let announced = false
    while (!session) {
      if (!this.hasCandidate(opts.needs, labels)) throw new Error(`Žádný připojený worker neumí „${String(opts.needs)}“.`)
      if (Date.now() > deadline || opts.signal?.aborted) throw new Error('Žádný worker se neuvolnil včas.')
      if (!announced) opts.onEvent?.({ kind: 'log', text: 'Čekám na volného workera…', at: new Date().toISOString() })
      announced = true
      await new Promise((r) => setTimeout(r, 1500))
      session = this.pick(opts.needs, labels)
    }
    const id = randomId(9)
    const s = session
    s.running.add(id)
    this.changed()
    opts.onEvent?.({ kind: 'log', text: `Úloha běží na workeru ${s.name}`, at: new Date().toISOString() })
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { id, c: s.c, worker: s.worker, onEvent: opts.onEvent, resolve, reject })
      opts.signal?.addEventListener('abort', () => this.sendTo(s.c, s.worker, { t: 'cancel', s: s.s, job: id }))
      this.sendTo(s.c, s.worker, { t: 'job', s: s.s, job: id, spec })
      if (opts.input) for (const chunk of chunksOf(opts.input)) this.sendTo(s.c, s.worker, { t: 'chunk', s: s.s, job: id, ...chunk })
    })
  }
}

export const hub = new Hub()
