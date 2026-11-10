import http from 'node:http'
import net from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { previewDomain, publicUrl } from './config.js'
import { roleOf, sessionAlive } from './auth.js'

type Grant = { projectId: string; user: NonNullable<FastifyRequest['user']>; alive: () => boolean; expires: number }
const tickets = new Map<string, Grant>()
const grants = new Map<string, Grant>()
const COOKIE = '__Host-reactor_preview'
const random = () => randomBytes(32).toString('base64url')
const projectIds = new Map<string, string>()
export const previewAddress = (id: string) => {
  const label = 'p-' + createHash('sha256').update(id).digest('hex').slice(0, 32)
  projectIds.set(label, id)
  return `https://${label}.${previewDomain}`
}
export const issuePreviewAccess = (req: FastifyRequest, projectId: string) => {
  if (!previewDomain || !req.user) throw new Error('Veřejný náhled není nastavený.')
  if (tickets.size > 1000) throw Object.assign(new Error('Příliš mnoho otevřených náhledů.'), { statusCode: 429 })
  const ticket = random()
  tickets.set(ticket, { projectId, user: req.user, alive: sessionAlive(req), expires: Date.now() + 60_000 })
  return { url: `${previewAddress(projectId)}/__aforge/auth?ticket=${ticket}` }
}
const prune = setInterval(() => { for (const map of [tickets, grants]) for (const [key, value] of map) if (value.expires < Date.now() || !value.alive()) map.delete(key) }, 60_000)
prune.unref()

export const startPreviewGateway = async (targetOf: (id: string) => number | undefined) => {
  if (!previewDomain) return undefined
  const projectOf = (host: string | undefined) => {
    const suffix = `.${previewDomain}`
    const id = host?.endsWith(suffix) ? host.slice(0, -suffix.length) : ''
    return /^[a-z0-9-]{1,63}$/.test(id) ? projectIds.get(id) : undefined
  }
  const authorize = (req: http.IncomingMessage, id: string) => {
    const sid = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    const grant = sid && grants.get(sid)
    return grant && grant.projectId === id && grant.expires > Date.now() && grant.alive() && roleOf(grant.user, id)
  }
  const server = http.createServer((req, res) => {
    const id = projectOf(req.headers.host)
    if (!id) return void res.writeHead(404).end()
    const url = new URL(req.url ?? '/', 'http://preview')
    if (url.pathname === '/__aforge/auth') {
      const ticket = url.searchParams.get('ticket') ?? ''
      const grant = tickets.get(ticket); tickets.delete(ticket)
      if (!grant || grant.projectId !== id || grant.expires < Date.now() || !grant.alive() || !roleOf(grant.user, id)) return void res.writeHead(403).end('Náhled otevřete z aplikace Reactor.')
      const key = random()
      grants.set(key, { ...grant, expires: Date.now() + 3600_000 })
      return void res.writeHead(302, { location: '/', 'set-cookie': `${COOKIE}=${key}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=3600`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
    }
    const port = targetOf(id)
    if (!port || !authorize(req, id)) return void res.writeHead(403).end('Náhled otevřete z aplikace Reactor.')
    // The preview never receives app cookies or the proxy's private access cookie.
    const cookie = req.headers.cookie?.split(/;\s*/).filter((c) => !c.startsWith(`${COOKIE}=`)).join('; ')
    const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, cookie: cookie ?? '' } }, (response) => {
      const headers: http.OutgoingHttpHeaders = { ...response.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': `frame-ancestors ${publicUrl}` }
      delete headers['x-frame-options']
      res.writeHead(response.statusCode ?? 502, headers); response.pipe(res)
    })
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() }); req.pipe(up)
  })
  server.on('upgrade', (req, socket, head) => {
    const id = projectOf(req.headers.host), port = id && targetOf(id)
    if (!id || !port || !authorize(req, id)) return socket.destroy()
    const up = net.connect(port, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).filter(([key]) => !['cookie', 'authorization'].includes(key))
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      up.write(head); up.pipe(socket); socket.pipe(up)
    })
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy())
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.AFORGE_PREVIEW_PORT ?? 4312), '127.0.0.1', resolve) })
  return server
}
