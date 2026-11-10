// Preview: runs the generated app in an isolated Ubuntu container (aforge-runtime image, own network),
// then serves it through a small proxy on its own port that injects the annotation inspector.
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { PreviewStatus } from '@aforge/shared'
import { publish } from './events.js'
import { run, streamLines, createJobNetwork, removeJobNetwork, proxyArgs } from '@aforge/runner'
import { loadProject, workspaceDir } from './store.js'
import { repoDir } from './project-locations.js'
import { reposOf } from '@aforge/shared'
import { INSPECTOR_JS } from './inspector.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { limits, previewDomain } from './config.js'
import { previewAddress } from './preview-access.js'
import { assertDiskCapacity } from './operations.js'

export const RUNTIME_IMAGE = process.env.AFORGE_RUNTIME_IMAGE ?? 'aforge-runtime:latest'

export const containerName = (id: string) => `aforge-app-${id}`
const ingressName = (id: string) => `aforge-ingress-${id}`
export const networkName = (id: string) => `aforge-net-${id}`

interface Running {
  status: PreviewStatus
  proxy?: http.Server
  stopLogs?: () => void
  idle?: ReturnType<typeof setTimeout>
}

const previews = new Map<string, Running>()

const MAX_LOG = 60_000

const appendLog = (r: Running, projectId: string, line: string) => {
  r.status.log = (r.status.log + line + '\n').slice(-MAX_LOG)
  publish(projectId, 'preview', 'log', line)
}

const setState = (r: Running, projectId: string, patch: Partial<PreviewStatus>) => {
  Object.assign(r.status, patch)
  publish(projectId, 'preview', 'status', r.status.state, { ...r.status, log: patch.log === '' ? '' : undefined })
}

export const previewStatus = (projectId: string): PreviewStatus =>
  previews.get(projectId)?.status ?? { state: 'idle', log: '' }

const injectInspector = (html: string) => {
  const tag = '<script src="/__aforge/inspector.js"></script>'
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`)
  return html + tag
}

const touchPreview = (id: string) => {
  const r = previews.get(id); if (!r || r.status.state !== 'running') return
  clearTimeout(r.idle); r.idle = setTimeout(() => void stopPreview(id), limits.previewMinutes * 60_000); r.idle.unref()
}
const startProxy = (target: number, projectId: string): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      touchPreview(projectId)
      if (req.url === '/__aforge/inspector.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
        res.end(INSPECTOR_JS)
        return
      }
      const upstream = http.request(
        { host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: { ...req.headers, 'accept-encoding': 'identity' } },
        (up) => {
          const type = String(up.headers['content-type'] ?? '')
          if (!type.includes('text/html')) {
            res.writeHead(up.statusCode ?? 502, up.headers)
            up.pipe(res)
            return
          }
          const chunks: Buffer[] = []
          up.on('data', (c: Buffer) => chunks.push(c))
          up.on('end', () => {
            const body = injectInspector(Buffer.concat(chunks).toString('utf8'))
            const headers = { ...up.headers }
            delete headers['content-length']
            delete headers['content-security-policy']
            res.writeHead(up.statusCode ?? 200, headers)
            res.end(body)
          })
        },
      )
      upstream.on('error', (err) => {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`Aplikace v kontejneru zatím neodpovídá (${err.message}).`)
      })
      req.pipe(upstream)
    })
    // WebSockets (dev servers, SignalR) are tunnelled as raw sockets.
    server.on('upgrade', (req, socket, head) => {
      const up = net.connect(target, '127.0.0.1', () => {
        up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
        up.write(head)
        up.pipe(socket).pipe(up)
      })
      up.on('error', () => socket.destroy())
      socket.on('error', () => up.destroy())
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const waitForHttp = async (port: number, isAlive: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && isAlive()) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume()
        resolve((res.statusCode ?? 500) < 500)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

export const stopPreview = async (projectId: string) => {
  const r = previews.get(projectId)
  clearTimeout(r?.idle)
  r?.stopLogs?.()
  r?.proxy?.close()
  await run('docker', ['rm', '-f', containerName(projectId), ingressName(projectId)])
  await removeJobNetwork(networkName(projectId))
  if (r) setState(r, projectId, { state: 'stopped', url: undefined, message: 'Zastaveno' })
}

const starting = new Set<string>()
export const startPreview = async (projectId: string) => {
  if (starting.has(projectId)) throw Object.assign(new Error('Náhled se již spouští.'), { statusCode: 409 })
  const active = new Set([...starting, ...[...previews.entries()].filter(([, r]) => ['starting', 'running'].includes(r.status.state)).map(([id]) => id)])
  active.delete(projectId)
  if (active.size >= limits.previews) throw Object.assign(new Error('Byl dosažen limit souběžných náhledů.'), { statusCode: 429 })
  starting.add(projectId)
  try { await launchPreview(projectId) }
  catch (error) {
    await stopPreview(projectId)
    const r = previews.get(projectId); if (r) setState(r, projectId, { state: 'error', message: (error as Error).message })
    throw error
  } finally { starting.delete(projectId) }
}
const launchPreview = async (projectId: string) => {
  await assertDiskCapacity()
  await stopPreview(projectId)
  const r: Running = { status: { state: 'starting', log: '' } }
  previews.set(projectId, r)
  setState(r, projectId, { state: 'starting', log: '', message: 'Spouštím kontejner…' })

  if (!existsSync(join(workspaceDir(projectId), '.aforge/start.sh'))) {
    setState(r, projectId, { state: 'error', message: 'Chybí .aforge/start.sh – nejdřív spusťte Build.' })
    return
  }
  if ((await run('docker', ['image', 'inspect', RUNTIME_IMAGE])).code !== 0) {
    setState(r, projectId, { state: 'error', message: `Chybí image ${RUNTIME_IMAGE} – spusťte „npm run runtime:build“.` })
    return
  }
  await createJobNetwork(networkName(projectId))
  // Other repositories (a backend beside the web app) start first, in the background, from /repos/<id>.
  const extra = reposOf(await loadProject(projectId)).filter((x) => x.id !== 'main' && existsSync(join(repoDir(projectId, x.id), '.aforge/start.sh')))
  const started = await run('docker', [
    'run', '-d',
    '--name', containerName(projectId),
    '--network', networkName(projectId),
    '--label', 'aforge.project=' + projectId,
    '--memory', '4g', '--cpus', '2', '--pids-limit=512', '--security-opt=no-new-privileges', '--cap-drop=ALL', '--cap-add=CHOWN', '--cap-add=SETUID', '--cap-add=SETGID', '--cap-add=DAC_OVERRIDE', '--cap-add=NET_BIND_SERVICE',
    '--label', 'aforge.managed=true', '--label', 'aforge.kind=preview', ...proxyArgs(),
    '--read-only', '--tmpfs', '/app:rw,exec,nosuid,nodev,size=2g', '--tmpfs', '/srv:rw,exec,nosuid,nodev,size=512m',
    '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=512m', '--tmpfs', '/run:rw,nosuid,nodev,size=16m',
    '--tmpfs', '/etc/nginx:rw,nosuid,nodev,size=8m', '--tmpfs', '/var/lib/nginx:rw,nosuid,nodev,size=32m', '--tmpfs', '/var/log:rw,nosuid,nodev,size=32m',
    '-e', 'HOME=/tmp/home', '-e', 'DOTNET_CLI_HOME=/tmp/dotnet',
    '-v', `${workspaceDir(projectId)}:/workspace:ro`,
    ...extra.flatMap((x) => ['-v', `${repoDir(projectId, x.id)}:/repos/${x.id}:ro`]),
    RUNTIME_IMAGE,
    // A constant script: every /repos/<id>/.aforge/start.sh in the background with prefixed logs, then the main one.
    'bash', '-c', 'cp -a /opt/nginx-template/. /etc/nginx/; mkdir -p /tmp/home /var/log/nginx; for d in /repos/*/; do [ -f "$d.aforge/start.sh" ] && (bash "$d.aforge/start.sh" 2>&1 | sed -u "s|^|[$(basename "$d")] |") & done; exec bash /workspace/.aforge/start.sh',
  ])
  if (started.code !== 0) {
    throw new Error(started.stderr.trim())
  }
  const ingress = await run('docker', ['run', '-d', '--name', ingressName(projectId), '--network', 'bridge', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--cpus=0.25', '--pids-limit=64', '--label', 'aforge.managed=true', '--label', 'aforge.kind=ingress', '-e', `TARGET=${containerName(projectId)}`, '-p', '127.0.0.1::8080', process.env.AFORGE_INGRESS_IMAGE ?? 'reactor-ingress:latest'])
  if (ingress.code !== 0) { await stopPreview(projectId); throw new Error('Nelze spustit vstupní proxy náhledu.') }
  const linked = await run('docker', ['network', 'connect', networkName(projectId), ingressName(projectId)])
  if (linked.code !== 0) { await stopPreview(projectId); throw new Error('Nelze připojit vstupní proxy k náhledu.') }
  const logs = streamLines('docker', ['logs', '-f', containerName(projectId)], {}, (line) => appendLog(r, projectId, line))
  r.stopLogs = logs.kill
  const port = Number((await run('docker', ['port', ingressName(projectId), '8080/tcp'])).stdout.trim().split(':').pop())
  const alive = async () => (await run('docker', ['inspect', '-f', '{{.State.Running}}', containerName(projectId)])).stdout.trim() === 'true'
  let running = true
  const watcher = setInterval(async () => (running = await alive()), 3000)
  setState(r, projectId, { message: 'Instaluji závislosti a sestavuji aplikaci v kontejneru…' })
  const ready = await waitForHttp(port, () => running, 15 * 60_000)
  clearInterval(watcher)
  if (!ready) {
    await stopPreview(projectId)
    setState(r, projectId, { state: 'error', message: 'Aplikace nenaběhla – viz log kontejneru.' })
    return
  }
  r.proxy = await startProxy(port, projectId)
  const url = previewDomain ? previewAddress(projectId) : `http://localhost:${(r.proxy.address() as AddressInfo).port}`
  r.idle = setTimeout(() => void stopPreview(projectId), limits.previewMinutes * 60_000); r.idle.unref()
  setState(r, projectId, { state: 'running', url, message: 'Běží' })
}

/** Starts the preview when it is off, or waits while it is starting; jobs that need the running app call this. */
export const ensurePreviewRunning = async (projectId: string, log: (text: string) => void) => {
  if (previewStatus(projectId).state === 'running') return
  log('Náhled neběží, spouštím aplikaci v kontejneru…')
  if (previewStatus(projectId).state === 'starting') {
    while (previewStatus(projectId).state === 'starting') await new Promise((r) => setTimeout(r, 1500))
  } else await startPreview(projectId)
  if (previewStatus(projectId).state !== 'running') throw new Error(`Náhled se nepodařilo spustit: ${previewStatus(projectId).message ?? 'viz log kontejneru v kroku Náhled'}.`)
}

export const previewPort = (id: string) => { touchPreview(id); return (previews.get(id)?.proxy?.address() as AddressInfo | undefined)?.port }
export const stopAllPreviews = () => Promise.allSettled([...previews.keys()].map(stopPreview))
