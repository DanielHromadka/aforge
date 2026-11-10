import { mkdir, access, statfs, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { releaseStore } from './store-lock.js'
import type { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { DATA_DIR } from './project-locations.js'
import { run } from '@aforge/runner'
import { limits, production, publicUrl, previewDomain } from './config.js'

export const operational = { closing: false, requests: 0, errors: 0, startedAt: Date.now() }
const sizeCache = new Map<string, { size: number; at: number }>()
const scanning = new Map<string, Promise<number>>()
const cachedUsage = async (dir: string) => {
  const cached = sizeCache.get(dir)
  if (cached && Date.now() - cached.at < 60_000) return cached.size
  let pending = scanning.get(dir)
  if (!pending) { pending = diskUsage(dir).then((size) => { sizeCache.set(dir, { size, at: Date.now() }); return size }).finally(() => scanning.delete(dir)); scanning.set(dir, pending) }
  return pending
}
export const diskUsage = async (dir: string): Promise<number> => {
  let size = 0
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, item.name)
    if (item.isDirectory()) size += await diskUsage(path)
    else if (item.isFile()) size += (await lstat(path)).size
  }
  return size
}
export const assertDiskCapacity = async (dir = DATA_DIR) => {
  const roots: [string, number][] = [[DATA_DIR, limits.dataBytes]]
  if (dir !== DATA_DIR) roots.push([dir, limits.projectBytes])
  for (const [path, max] of roots) {
    if (await cachedUsage(path) >= max) throw Object.assign(new Error('Byl dosažen limit úložiště. Správce musí uvolnit místo.'), { statusCode: 507 })
  }
  const disk = await statfs(DATA_DIR)
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw Object.assign(new Error('Na serveru není dostatek volného místa.'), { statusCode: 507 })
}

export const registerOperations = async (app: FastifyInstance) => {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  if (production) {
    const security = await run('docker', ['info', '--format', '{{json .SecurityOptions}}'])
    if (security.code !== 0 || !security.stdout.includes('rootless')) throw new Error('Produkce vyžaduje rootless Docker.')
    const cgroups = await run('docker', ['info', '--format', '{{.CgroupVersion}} {{.MemoryLimit}} {{.CPUCfsQuota}} {{.PidsLimit}}'])
    if (cgroups.stdout.trim() !== '2 true true true') throw new Error('Rootless Docker musí vynucovat limity paměti, CPU a PID přes cgroups v2.')
    const stale = (await run('docker', ['ps', '-aq', '--filter', 'label=aforge.managed=true'])).stdout.trim().split(/\s+/).filter((id) => /^[a-f0-9]+$/.test(id))
    if (stale.length) await run('docker', ['rm', '-f', ...stale])
    const networks = (await run('docker', ['network', 'ls', '-q', '--filter', 'label=aforge.managed=true'])).stdout.trim().split(/\s+/).filter((id) => /^[a-f0-9]+$/.test(id))
    for (const id of networks) {
      if (process.env.AFORGE_EGRESS_PROXY) await run('docker', ['network', 'disconnect', '-f', id, process.env.AFORGE_EGRESS_PROXY])
      await run('docker', ['network', 'rm', id])
    }
  }
  app.addHook('onClose', async () => { await releaseStore() })
  await app.register(helmet, {
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'https:', 'data:', 'blob:'], connectSrc: ["'self'"],
      frameSrc: ["'self'", 'https://www.figma.com', ...(previewDomain ? [`https://*.${previewDomain}`] : ['http://localhost:*'])],
      frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"],
      upgradeInsecureRequests: production ? [] : null,
    } }, crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production ? { maxAge: 31536000 } : false,
    referrerPolicy: { policy: 'no-referrer' },
  })
  await app.register(rateLimit, { max: production ? 300 : 3000, timeWindow: 60_000, keyGenerator: (req) => req.ip })
  app.addHook('onRequest', async (req, reply) => {
    if (operational.closing) return reply.code(503).send({ error: 'Server se restartuje.' })
    operational.requests++
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store')
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    if (req.url.split('?')[0] === '/api/auth/backchannel-logout') return // OIDC server-to-server request is authenticated by its signed logout token.
    const origin = req.headers.origin
    const expected = publicUrl ? new URL(publicUrl).origin : `${req.protocol}://${req.headers.host}`
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== expected))
      return reply.code(403).send({ error: 'Požadavek pochází z jiné aplikace.' })
    // Browser writes must carry an Origin; API clients without cookies remain usable.
    if (production && req.headers.cookie && !origin) return reply.code(403).send({ error: 'Chybí původ požadavku.' })
  })
  app.addHook('onResponse', async (_req, reply) => { if (reply.statusCode >= 500) operational.errors++ })
  app.get('/health/live', () => ({ status: 'ok' }))
  app.get('/health/ready', async (_req, reply) => {
    try { await access(DATA_DIR, 6); await assertDiskCapacity(); return { status: 'ok' } }
    catch { return reply.code(503).send({ status: 'unavailable' }) }
  })
  app.get('/api/operations', async (req, reply) => {
    if (!req.user?.admin) return reply.code(403).send({ error: 'Jen pro administrátory.' })
    return { uptimeSeconds: Math.floor((Date.now() - operational.startedAt) / 1000), requests: operational.requests, errors: operational.errors, memoryBytes: process.memoryUsage().rss, dataBytes: await diskUsage(DATA_DIR), limits }
  })
}
