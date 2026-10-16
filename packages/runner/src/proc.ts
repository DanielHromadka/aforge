import { spawn, type SpawnOptions } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a program with an argument array (never through a shell string) and collects its output. */
export const run = (cmd: string, args: string[], opts: SpawnOptions & { input?: string } = {}): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (d) => (stdout += d))
    child.stderr!.on('data', (d) => (stderr += d))
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (opts.input !== undefined) child.stdin!.end(opts.input)
    else child.stdin!.end()
  })

/** Spawns a long-running program and hands every complete output line to `onLine`. */
export const streamLines = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  onLine: (line: string, stream: 'out' | 'err') => void,
): { done: Promise<number>; kill: () => void } => {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
  const split = (stream: 'out' | 'err') => {
    let buf = ''
    return (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i), stream)
        buf = buf.slice(i + 1)
      }
    }
  }
  child.stdout!.on('data', split('out'))
  child.stderr!.on('data', split('err'))
  const done = new Promise<number>((resolve) => {
    child.on('error', (err) => {
      onLine(String(err), 'err')
      resolve(-1)
    })
    child.on('close', (code) => resolve(code ?? -1))
  })
  return { done, kill: () => child.kill('SIGTERM') }
}

export const which = async (cmd: string): Promise<boolean> => (await run('which', [cmd])).code === 0
