// Preview: runs the generated app in an isolated Ubuntu container (aforge-runtime image, own network),
// then serves it through a small proxy on its own port that injects the annotation inspector.
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { PreviewStatus } from '@aforge/shared'
import { publish } from './events.js'
import { run, streamLines } from '@aforge/runner'
import { workspaceDir } from './store.js'
import { INSPECTOR_JS } from './inspector.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const RUNTIME_IMAGE = process.env.AFORGE_RUNTIME_IMAGE ?? 'aforge-runtime:latest'

export const containerName = (id: string) => `aforge-app-${id}`
export const networkName = (id: string) => `aforge-net-${id}`

interface Running {
  status: PreviewStatus
  proxy?: http.Server
  stopLogs?: () => void
}

const previews = new Map<string, Running>()

const MAX_LOG = 60_000

const appendLog = (r: Running, projectId: string, line: string) => {
  r.status.log = (r.status.log + line + '\n').slice(-MAX_LOG)
  publish(projectId, 'preview', 'log', line)
}

const setState = (r: Running, projectId: string, patch: Partial<PreviewStatus>) => {
  Object.assign(r.status, patch)
  publish(projectId, 'preview', 'status', r.status.state, { ...r.status, log: undefined })
}

export const previewStatus = (projectId: string): PreviewStatus =>
  previews.get(projectId)?.status ?? { state: 'idle', log: '' }

const injectInspector = (html: string) => {
  const tag = '<script src="/__aforge/inspector.js"></script>'
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`)
  return html + tag
}

const startProxy = (target: number): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
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
  r?.stopLogs?.()
  r?.proxy?.close()
  await run('docker', ['rm', '-f', containerName(projectId)])
  if (r) setState(r, projectId, { state: 'stopped', url: undefined, message: 'Zastaveno' })
}

export const startPreview = async (projectId: string) => {
  await stopPreview(projectId)
  const r: Running = { status: { state: 'starting', log: '' } }
  previews.set(projectId, r)
  setState(r, projectId, { state: 'starting', message: 'Spouštím kontejner…' })

  if (!existsSync(join(workspaceDir(projectId), '.aforge/start.sh'))) {
    setState(r, projectId, { state: 'error', message: 'Chybí .aforge/start.sh – nejdřív spusťte Build.' })
    return
  }
  if ((await run('docker', ['image', 'inspect', RUNTIME_IMAGE])).code !== 0) {
    setState(r, projectId, { state: 'error', message: `Chybí image ${RUNTIME_IMAGE} – spusťte „npm run runtime:build“.` })
    return
  }
  await run('docker', ['network', 'create', networkName(projectId)])
  const started = await run('docker', [
    'run', '-d',
    '--name', containerName(projectId),
    '--network', networkName(projectId),
    '--label', 'aforge.project=' + projectId,
    '--memory', '4g', '--cpus', '2',
    '-p', '127.0.0.1::80',
    '-v', `${workspaceDir(projectId)}:/workspace:ro`,
    RUNTIME_IMAGE,
    'bash', '/workspace/.aforge/start.sh',
  ])
  if (started.code !== 0) {
    setState(r, projectId, { state: 'error', message: started.stderr.trim() })
    return
  }
  const logs = streamLines('docker', ['logs', '-f', containerName(projectId)], {}, (line) => appendLog(r, projectId, line))
  r.stopLogs = logs.kill
  const port = Number((await run('docker', ['port', containerName(projectId), '80/tcp'])).stdout.trim().split(':').pop())
  const alive = async () => (await run('docker', ['inspect', '-f', '{{.State.Running}}', containerName(projectId)])).stdout.trim() === 'true'
  let running = true
  const watcher = setInterval(async () => (running = await alive()), 3000)
  setState(r, projectId, { message: 'Instaluji závislosti a sestavuji aplikaci v kontejneru…' })
  const ready = await waitForHttp(port, () => running, 15 * 60_000)
  clearInterval(watcher)
  if (!ready) {
    setState(r, projectId, { state: 'error', message: 'Aplikace nenaběhla – viz log kontejneru.' })
    return
  }
  r.proxy = await startProxy(port)
  const url = `http://localhost:${(r.proxy.address() as AddressInfo).port}`
  setState(r, projectId, { state: 'running', url, message: 'Běží' })
}
