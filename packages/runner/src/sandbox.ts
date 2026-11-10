import { randomUUID } from 'node:crypto'
import { realpathSync, createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { mkdtemp, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractJobFiles, applyJobFiles, validateJobWorkspace } from './job-files.js'
import { run, streamLines, trackJob } from './proc.js'

const exportContainer = async (name: string, file: string) => {
  const child = spawn('docker', ['exec', name, 'cat', '/tmp/result.tar'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let size = 0, error = ''
  const bounded = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; callback(size > 512 * 1024 ** 2 ? new Error('Výstup agenta překročil 512 MB.') : null, chunk) } })
  child.stderr.on('data', (chunk) => { error = (error + chunk).slice(-1000) })
  const exited = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Export agenta selhal: ${error}`))) })
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000); timer.unref()
  try { await Promise.all([exited, pipeline(child.stdout, bounded, createWriteStream(file, { flags: 'wx', mode: 0o600 }))]) }
  finally { clearTimeout(timer); child.kill() }
}

export const sandboxEnabled = () => process.env.AFORGE_AGENT_SANDBOX === 'docker'
export const jobTimeout = () => Number(process.env.AFORGE_JOB_TIMEOUT_MS ?? 30 * 60_000)
export const containerRestrictions = ['--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=2g', '--cpus=1', '--ulimit', 'nofile=4096:4096']

/** A private network per job/project. Only the filtering proxy can reach the Internet. */
export const createJobNetwork = async (name: string) => {
  const proxy = process.env.AFORGE_EGRESS_PROXY
  if (process.env.NODE_ENV === 'production' && !proxy) throw new Error('Production requires AFORGE_EGRESS_PROXY.')
  const created = await run('docker', ['network', 'create', '--label', 'aforge.managed=true', ...(proxy ? ['--internal'] : []), name])
  if (created.code !== 0 && !(await run('docker', ['network', 'inspect', name])).stdout.includes(name)) throw new Error('Nelze připravit izolovanou síť.')
  if (proxy) {
    const linked = await run('docker', ['network', 'connect', '--alias', 'egress', name, proxy])
    if (linked.code !== 0 && !linked.stderr.includes('already exists')) throw new Error('Nelze připojit filtr odchozího provozu.')
  }
}
export const removeJobNetwork = async (name: string) => {
  if (process.env.AFORGE_EGRESS_PROXY) await run('docker', ['network', 'disconnect', '-f', name, process.env.AFORGE_EGRESS_PROXY])
  await run('docker', ['network', 'rm', name])
}
export const proxyArgs = () => process.env.AFORGE_EGRESS_PROXY ? ['-e', 'HTTP_PROXY=http://egress:3128', '-e', 'HTTPS_PROXY=http://egress:3128', '-e', 'http_proxy=http://egress:3128', '-e', 'https_proxy=http://egress:3128', '-e', 'NO_PROXY=localhost,127.0.0.1,.aforge-app', '-e', 'NODE_USE_ENV_PROXY=1'] : []

export const sandboxProcess = (cmd: string, args: string[], cwd: string | undefined, input: string | undefined, onLine: (line: string, stream: 'out' | 'err') => void, options: { image?: string; network?: string; env?: Record<string, string>; model?: boolean } = {}) => {
  if (process.env.NODE_ENV === 'production' && !sandboxEnabled()) throw new Error('Host agent execution is disabled in production.')
  const name = `aforge-agent-${randomUUID()}`
  let cancelled = false
  let active: ReturnType<typeof streamLines> | undefined
  const modelName = `${name}-model`
  const kill = () => { cancelled = true; active?.kill(); void run('docker', ['rm', '-f', name, modelName]) }
  const done = (async () => {
    if (cwd) await validateJobWorkspace(cwd)
    for (const path of [tmpdir(), ...(cwd ? [cwd] : [])]) { const disk = await statfs(path); if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error('Na disku chybí prostor pro bezpečné dokončení úlohy.') }
    const output = await mkdtemp(join(tmpdir(), 'reactor-agent-output-'))
    try {
      if (!options.network) await createJobNetwork(name)
      if (cancelled) return -1
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG }
      // Pass only this model credential. No application secrets or Docker socket enter a job.
      const credential = cmd === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
      const secret = process.env[credential]
      if (options.model !== false && !secret) throw new Error(`Sandbox vyžaduje ${credential}.`)
      if (options.model !== false) {
        const broker = await run('docker', ['run', '-d', '--name', modelName, '--network', 'bridge', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--cpus=0.25', '--pids-limit=64', '--label', 'aforge.managed=true', '--label', 'aforge.kind=model-gateway', '-e', credential, '-e', `PROVIDER=${cmd === 'claude' ? 'claude' : 'codex'}`, '-e', `MAX_OUTPUT_TOKENS=${process.env.AFORGE_MAX_OUTPUT_TOKENS ?? 16384}`, process.env.AFORGE_MODEL_GATEWAY_IMAGE ?? 'reactor-model-gateway:latest'], { env: { ...env, [credential]: secret } })
        if (broker.code !== 0) throw new Error('Nelze spustit zabezpečenou bránu modelu.')
        const connected = await run('docker', ['network', 'connect', '--alias', 'model-gateway', options.network ?? name, modelName])
        if (connected.code !== 0) throw new Error('Nelze připojit zabezpečenou bránu modelu.')
        env[credential] = 'reactor-job-scoped-placeholder'
        env.ANTHROPIC_BASE_URL = 'http://model-gateway:8080'
        env.OPENAI_BASE_URL = 'http://model-gateway:8080/v1'
      }
      Object.assign(env, options.env)
      let resultCode: number | undefined
      let exported: Promise<void> | undefined
      const handleLine = (line: string, stream: 'out' | 'err') => {
        const ready = stream === 'out' && /^__REACTOR_RESULT_READY:(\d+)$/.exec(line)
        if (!ready || !cwd || exported) { onLine(line, stream); return }
        resultCode = Number(ready[1])
        exported = (async () => {
          const archive = join(output, 'result.tar')
          await exportContainer(name, archive)
          if ((await stat(archive)).size > 512 * 1024 ** 2) throw new Error('Výstup agenta překročil 512 MB.')
          await extractJobFiles(archive, join(output, 'files'))
          if (!cancelled) await applyJobFiles(join(output, 'files'), realpathSync(cwd))
        })().finally(async () => { await run('docker', ['rm', '-f', name]) })
        // Observe errors immediately; rethrow below once the attached process has stopped.
        void exported.catch(() => {})
      }
      active = streamLines('docker', [
        'run', '--init', '--name', name, '--network', options.network ?? name, ...containerRestrictions,
        '--read-only', `--user=${process.env.NODE_ENV === 'production' ? '0:0' : `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`}`, '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=768m',
        '--tmpfs', `/workspace:rw,exec,nosuid,nodev,uid=${process.env.NODE_ENV === 'production' ? 0 : process.getuid?.() ?? 1000},gid=${process.env.NODE_ENV === 'production' ? 0 : process.getgid?.() ?? 1000},size=1g`,
        '--tmpfs', `/home/agent:rw,nosuid,nodev,uid=${process.env.NODE_ENV === 'production' ? 0 : process.getuid?.() ?? 1000},gid=${process.env.NODE_ENV === 'production' ? 0 : process.getgid?.() ?? 1000},size=256m`,
        '--label', 'aforge.managed=true', '--label', 'aforge.kind=agent',
        ...(options.model === false ? [] : ['-e', credential, '-e', 'ANTHROPIC_BASE_URL', '-e', 'OPENAI_BASE_URL']), '-e', 'HOME=/home/agent', ...proxyArgs(),
        ...Object.keys(options.env ?? {}).flatMap((key) => ['-e', key]),
        ...(options.model === false ? [] : ['-e', 'NO_PROXY=localhost,127.0.0.1,model-gateway']),
        ...(cwd ? ['--mount', `type=bind,src=${realpathSync(cwd)},dst=/source,readonly`, '--mount', `type=bind,src=${realpathSync(cwd)}/.git,dst=/workspace/.git,readonly`] : []),
        '-w', '/workspace', ...(input !== undefined ? ['-i'] : []),
        options.image ?? process.env.AFORGE_AGENT_IMAGE ?? 'reactor-agent:latest', cmd, ...args,
      ], { env, input }, handleLine)
      const code = await active.done
      if (exported) await exported
      return cancelled ? -1 : resultCode ?? code
    } finally { await run('docker', ['rm', '-f', name, modelName]); if (!options.network) await removeJobNetwork(name); await rm(output, { recursive: true, force: true }) }
  })()
  trackJob(kill, done)
  const timer = setTimeout(kill, jobTimeout()); timer.unref()
  return { kill, done: done.finally(() => clearTimeout(timer)) }
}
