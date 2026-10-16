#!/usr/bin/env -S npx tsx
// aforge-worker: a daemon on a server with Claude Code and/or Codex logged in on a subscription. It
// connects outwards to the relay, introduces itself to the aForge hub and runs the jobs it gets:
// structured consultations and implementations on a git bundle of the project's workspace.
//
//   aforge-worker enroll <token> [--name build-01] [--labels orchestrator,build] [--max-jobs 2]
//   aforge-worker run
//   aforge-worker status
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Assembler, PROTOCOL_VERSION, chunksOf, open, parseEnrollment, randomId, roomUrl, seal,
  type Enrollment, type JobSpec, type RelayControl, type ToHub, type ToWorker,
} from '@aforge/protocol'
import { cloneBundle, commitAll, consultCli, createBundle, detectCapabilities, headOf, implement } from '@aforge/runner'

interface Config {
  enrollment: Enrollment
  name: string
  labels: string[]
  maxJobs: number
}

const DIR = process.env.AFORGE_WORKER_HOME ?? join(homedir(), '.aforge-worker')
const CONFIG = join(DIR, 'config.json')

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const loadConfig = (): Config => {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8')) as Config
  } catch {
    throw new Error(`Worker není zaregistrovaný – spusťte „aforge-worker enroll <token>“ (config: ${CONFIG}).`)
  }
}

const enroll = (args: string[]) => {
  const token = args[0]
  if (!token) throw new Error('Chybí registrační token z aForge (Agenti → Přidat worker).')
  const enrollment = parseEnrollment(token)
  const config: Config = {
    enrollment,
    name: flag(args, 'name') ?? hostname(),
    labels: (flag(args, 'labels') ?? '').split(',').map((l) => l.trim()).filter(Boolean),
    maxJobs: Number(flag(args, 'max-jobs') ?? 1),
  }
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  writeFileSync(CONFIG, JSON.stringify(config, null, 2))
  chmodSync(CONFIG, 0o600)
  log(`Zaregistrováno jako ${enrollment.id} (${config.name}) přes ${enrollment.relay}. Spusťte „aforge-worker run“.`)
}

interface RunningJob {
  spec?: JobSpec
  input: Assembler
  cancel?: () => void
}

const runDaemon = async () => {
  const config = loadConfig()
  const { enrollment: e } = config
  const caps = await detectCapabilities()
  log(`Worker ${config.name} (${e.id}) · claude=${caps.claude} codex=${caps.codex} docker=${caps.docker} · štítky: ${config.labels.join(', ') || '—'}`)
  const jobs = new Map<string, RunningJob>()
  let retry = 1000

  const connect = () => {
    const ws = new WebSocket(roomUrl(e.relay, e.room, 'client'))
    ws.binaryType = 'arraybuffer'
    let session: string | null = null
    let helloNonce = ''
    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)

    const send = (msg: ToHub) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(seal(e.id, e.key, msg))
    }
    const hello = () => {
      session = null
      helloNonce = randomId()
      send({ t: 'hello', name: config.name, version: PROTOCOL_VERSION, caps, labels: config.labels, maxJobs: config.maxJobs, ts: Date.now(), wn: helloNonce })
    }
    const event = (job: string, kind: string, text: string) => session && send({ t: 'event', s: session, job, kind, text })
    const result = (job: string, ok: boolean, data?: unknown, error?: string) => {
      jobs.delete(job)
      if (session) send({ t: 'result', s: session, job, ok, data, error })
    }

    const start = async (job: string, spec: JobSpec, input?: Buffer) => {
      log(`Úloha ${job}: ${spec.kind}`)
      try {
        if (spec.kind === 'consult') {
          result(job, true, await consultCli(spec.system, spec.prompt, spec.schema))
          return
        }
        const tmp = await mkdtemp(join(tmpdir(), 'aforge-job-'))
        try {
          await writeFile(join(tmp, 'in.bundle'), input!)
          const dir = join(tmp, 'ws')
          await cloneBundle(join(tmp, 'in.bundle'), dir)
          if ((await headOf(dir)) !== spec.base) throw new Error('Bundle neodpovídá očekávanému commitu')
          const run = implement(spec.agent, dir, spec.prompt, (ev) => event(job, ev.kind, ev.text))
          const current = jobs.get(job)
          if (current) current.cancel = run.kill
          const code = await run.done
          await commitAll(dir, spec.message)
          const head = await headOf(dir)
          if (head !== spec.base && session) {
            await createBundle(dir, join(tmp, 'out.bundle'), `${spec.base}..HEAD`)
            const out = await readFile(join(tmp, 'out.bundle'))
            for (const chunk of chunksOf(out)) send({ t: 'chunk', s: session, job, ...chunk })
          }
          if (code === 0) result(job, true, { head })
          else result(job, false, undefined, `Agent skončil s kódem ${code}`)
        } finally {
          await rm(tmp, { recursive: true, force: true })
        }
      } catch (err) {
        result(job, false, undefined, (err as Error).message)
      }
      log(`Úloha ${job} skončila`)
    }

    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        if (m.data === 'pong') return
        try {
          const ctl = JSON.parse(m.data) as RelayControl
          if (ctl.t === 'host') {
            log(ctl.online ? 'Hub je online' : 'Hub je offline, čekám…')
            if (ctl.online) hello()
            else session = null
          }
        } catch {
          // ignore
        }
        return
      }
      const opened = open<ToWorker>(new Uint8Array(m.data as ArrayBuffer), e.key)
      if (!opened || opened.worker !== e.id) return
      const msg = opened.message
      if (msg.t === 'welcome') {
        if (msg.wn !== helloNonce) return
        session = msg.s
        retry = 1000
        log(`Připojeno k hubu ${msg.hub}`)
        return
      }
      if (msg.t === 'bye') {
        log(`Hub ukončil spojení: ${msg.reason}`)
        return
      }
      if (!session || msg.s !== session) return
      if (msg.t === 'job') {
        jobs.set(msg.job, { spec: msg.spec, input: new Assembler() })
        if (msg.spec.kind === 'consult') void start(msg.job, msg.spec)
      }
      if (msg.t === 'chunk') {
        const job = jobs.get(msg.t === 'chunk' ? msg.job : '')
        if (!job?.spec) return
        try {
          const whole = job.input.push(msg.seq, msg.data, msg.last)
          if (whole) void start(msg.job, job.spec, whole)
        } catch (err) {
          result(msg.job, false, undefined, (err as Error).message)
        }
      }
      if (msg.t === 'cancel') {
        jobs.get(msg.job)?.cancel?.()
        log(`Úloha ${msg.job} zrušena`)
      }
    }
    ws.onclose = (ev) => {
      clearInterval(ping)
      for (const job of jobs.values()) job.cancel?.()
      jobs.clear()
      log(`Spojení s relayem ukončeno (${ev.code}), další pokus za ${retry / 1000} s`)
      setTimeout(connect, retry)
      retry = Math.min(retry * 2, 60_000)
    }
    ws.onerror = () => {
      // onclose follows and reconnects
    }
  }
  connect()
}

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'enroll') return enroll(args)
  if (cmd === 'run') return runDaemon()
  if (cmd === 'status') {
    const c = loadConfig()
    console.log(JSON.stringify({ id: c.enrollment.id, name: c.name, relay: c.enrollment.relay, labels: c.labels, maxJobs: c.maxJobs, caps: await detectCapabilities() }, null, 2))
    return
  }
  console.log('Použití: aforge-worker enroll <token> [--name jméno] [--labels a,b] [--max-jobs n] | run | status')
  process.exitCode = cmd ? 1 : 0
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
