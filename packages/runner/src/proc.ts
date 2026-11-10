import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process'

export interface RunResult { code: number; stdout: string; stderr: string }
const children = new Set<() => void>()
const MAX_OUTPUT = 8 * 1024 * 1024
const unix = process.platform !== 'win32'
const terminate = (child: ChildProcess) => {
  const signal = (s: NodeJS.Signals) => { try { if (unix && child.pid) process.kill(-child.pid, s); else child.kill(s) } catch { /* already stopped */ } }
  signal('SIGTERM')
  const timer = setTimeout(() => signal('SIGKILL'), 3000); timer.unref()
}
const jobs = new Map<() => void, Promise<unknown>>()
export const trackJob = (kill: () => void, done: Promise<unknown>) => { jobs.set(kill, done); void done.then(() => jobs.delete(kill), () => jobs.delete(kill)) }
export const shutdownProcesses = async () => {
  for (const kill of jobs.keys()) kill()
  for (const kill of children) kill()
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([Promise.allSettled([...jobs.values()]), new Promise<void>((resolve) => { timer = setTimeout(resolve, 8000); timer.unref() })])
  clearTimeout(timer)
}
const safeArgs = (cmd: string, args: string[]) => cmd === 'git' ? ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'protocol.ext.allow=never', ...args] : args

type Options = SpawnOptions & { input?: string; timeoutMs?: number }
/** Bounded output, runtime and process tree; arguments never pass through a shell. */
export const run = (cmd: string, args: string[], opts: Options = {}): Promise<RunResult> => new Promise((resolve) => {
  const { input, timeoutMs = 120_000, ...spawnOpts } = opts
  const child = spawn(cmd, safeArgs(cmd, args), { ...spawnOpts, detached: unix, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  const kill = () => terminate(child)
  children.add(kill)
  const timer = setTimeout(kill, timeoutMs); timer.unref()
  const collect = (stream: 'out' | 'err', d: Buffer) => {
    if (stream === 'out') stdout += d.toString(); else stderr += d.toString()
    if (stdout.length + stderr.length > MAX_OUTPUT) { stdout = stdout.slice(0, MAX_OUTPUT); stderr = stderr.slice(0, 2000) + '\nOutput limit exceeded'; kill() }
  }
  child.stdout!.on('data', (d) => collect('out', d))
  child.stderr!.on('data', (d) => collect('err', d))
  const finish = (code: number) => { clearTimeout(timer); children.delete(kill); resolve({ code, stdout, stderr }) }
  child.on('error', (err) => { stderr += String(err); finish(-1) })
  child.on('close', (code) => finish(code ?? -1))
  child.stdin!.on('error', () => {})
  child.stdin!.end(input)
})

export const streamLines = (cmd: string, args: string[], opts: Options, onLine: (line: string, stream: 'out' | 'err') => void): { done: Promise<number>; kill: () => void } => {
  const { input, timeoutMs = Number(process.env.AFORGE_JOB_TIMEOUT_MS ?? 30 * 60_000), ...spawnOpts } = opts
  const child = spawn(cmd, safeArgs(cmd, args), { ...spawnOpts, detached: unix, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
  const kill = () => terminate(child)
  children.add(kill)
  const timer = setTimeout(() => { onLine('Úloha překročila časový limit.', 'err'); kill() }, timeoutMs); timer.unref()
  if (input !== undefined) { child.stdin!.on('error', () => {}); child.stdin!.end(input) }
  const attach = (source: NodeJS.ReadableStream, stream: 'out' | 'err') => {
    let buf = ''
    source.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, Math.min(i, MAX_OUTPUT)), stream); buf = buf.slice(i + 1) }
      if (buf.length > MAX_OUTPUT) { onLine('Řádek překročil limit výstupu.', 'err'); buf = ''; kill() }
    })
    source.on('end', () => { if (buf) onLine(buf, stream) })
  }
  attach(child.stdout!, 'out'); attach(child.stderr!, 'err')
  const done = new Promise<number>((resolve) => {
    child.on('error', (err) => { onLine(String(err), 'err'); resolve(-1) })
    child.on('close', (code) => resolve(code ?? -1))
  }).finally(() => { clearTimeout(timer); children.delete(kill) })
  return { done, kill }
}
export const which = async (cmd: string): Promise<boolean> => (await run('which', [cmd])).code === 0
