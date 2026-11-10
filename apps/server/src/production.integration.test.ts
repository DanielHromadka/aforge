import { createServer } from 'node:http'
import { mkdtemp, rm, mkdir, symlink, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'

let app: FastifyInstance, dir: string, issuer: string
let who = 'admin', nonce = '', wrongNonce = false
const keys = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test', alg: 'RS256', use: 'sig' }
const token = (claims: Record<string, unknown>) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuer).setSubject(who).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
const oidc = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url?.endsWith('/certs')) return res.end(JSON.stringify({ keys: [jwk] }))
  if (req.url?.endsWith('/token')) return res.end(JSON.stringify({ access_token: await token({ azp: 'aforge', preferred_username: who, realm_access: { roles: who === 'admin' ? ['aforge-admin'] : [] } }), id_token: await token({ aud: 'aforge', nonce: wrongNonce ? 'wrong' : nonce }) }))
  res.end(JSON.stringify({ issuer }))
})
const login = async (username: string) => {
  who = username
  const start = await app.inject({ url: '/api/auth/login' })
  const url = new URL(start.headers.location!)
  nonce = url.searchParams.get('nonce')!
  const state = url.searchParams.get('state')!
  const cookie = String(start.headers['set-cookie']).split(';')[0]!
  const response = await app.inject({ url: `/api/auth/callback?state=${state}&code=test`, headers: { cookie } })
  return { response, cookie: String(response.headers['set-cookie']).split(';')[0]! }
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reactor-production-test-'))
  oidc.listen(0, '127.0.0.1'); await once(oidc, 'listening')
  const base = `http://127.0.0.1:${(oidc.address() as AddressInfo).port}`; issuer = `${base}/realms/aforge`
  vi.stubEnv('AFORGE_DATA', dir); vi.stubEnv('AFORGE_AUTH', 'on'); vi.stubEnv('PORT', '0'); vi.stubEnv('KEYCLOAK_URL', base); vi.stubEnv('AFORGE_PREVIEW_DOMAIN', 'preview.example.net'); vi.stubEnv('AFORGE_PREVIEW_PORT', '0')
  app = (await import('./index.js')).app
}, 15000)
afterAll(async () => { await app?.close(); oidc.closeAllConnections(); oidc.close(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) })

it('binds OIDC login to the browser and checks nonce/signature/issuer', async () => {
  const start = await app.inject({ url: '/api/auth/login' })
  const state = new URL(start.headers.location!).searchParams.get('state')
  expect((await app.inject({ url: `/api/auth/callback?state=${state}&code=x` })).headers.location).toContain('error=login')
  wrongNonce = true
  expect((await login('admin')).response.headers.location).toContain('error=login')
  wrongNonce = false
  const logged = await login('admin')
  expect(logged.response.headers.location).toBe('/')
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie: logged.cookie } })).json().user).toMatchObject({ id: 'admin', admin: true })
})
it('isolates projects, protects writes against cross-origin requests, and limits operations to admins', async () => {
  const admin = (await login('admin')).cookie
  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Private project' }, headers: { cookie: admin } })
  expect(created.statusCode).toBe(200)
  const id = created.json().id
  const other = (await login('other')).cookie
  expect((await app.inject({ url: `/api/projects/${id}`, headers: { cookie: other } })).statusCode).toBe(404)
  expect((await app.inject({ url: '/api/projects', headers: { cookie: other } })).json()).toEqual([])
  expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'CSRF' }, headers: { cookie: admin, origin: 'https://evil.test' } })).statusCode).toBe(403)
  expect((await app.inject({ url: '/api/operations', headers: { cookie: other } })).statusCode).toBe(403)
  expect((await app.inject({ url: '/api/operations', headers: { cookie: admin } })).statusCode).toBe(200)
  expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(200)
  expect(created.headers['content-security-policy']).toContain("object-src 'none'")
  expect(created.headers['cache-control']).toBe('no-store')
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: admin } })
  expect((await app.inject({ url: '/api/projects', headers: { cookie: admin } })).statusCode).toBe(401)
})
it('refuses workspace symlinks, dangling links, .git edits and host Git hooks', async () => {
  const { safePath, writeText, ensureRepo, commit } = await import('./workspace.js')
  const { createProject } = await import('./store.js')
  const p = await createProject('Paths', '')
  await ensureRepo(p.id)
  const ws = join(dir, 'projects', p.id, 'workspace')
  const outside = join(dir, 'outside'); await mkdir(outside)
  await symlink(outside, join(ws, 'escape'))
  await symlink(join(outside, 'missing'), join(ws, 'dangling'))
  expect(() => safePath(p.id, 'escape/x')).toThrow()
  expect(() => safePath(p.id, 'dangling')).toThrow()
  expect(() => safePath(p.id, '.git/config')).toThrow()
  await writeFile(join(ws, '.git/hooks/pre-commit'), '#!/bin/sh\ntouch "' + join(outside, 'executed') + '"\n', { mode: 0o755 })
  await writeText(p.id, 'ok.txt', 'safe')
  await commit(p.id, 'Check hook isolation')
  await expect(readFile(join(outside, 'executed'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('refuses a second writer before it can recover jobs or overwrite state', async () => {
  const { acquireStore } = await import('./store-lock.js')
  await expect(acquireStore()).rejects.toMatchObject({ code: 'ELOCKED' })
})
it('persists a per-project daily agent limit across restarts', async () => {
  const { AgentRunRegistry } = await import('./agent-runs.js')
  vi.stubEnv('AFORGE_PROJECT_DAILY_RUNS', '1')
  const file = join(dir, 'quota.json'), context = { projectId: 'quota', projectName: 'Quota', step: 'test' }
  const registry = new AgentRunRegistry(file)
  registry.finish(registry.start(context, 'claude', 'local'), 'done')
  expect(() => new AgentRunRegistry(file).start(context, 'claude', 'local')).toThrow('dnešní')
})

it('grants isolated previews with one-use tickets and revokes them on logout', async () => {
  const { startPreviewGateway } = await import('./preview-access.js')
  const admin = (await login('admin')).cookie
  const created = (await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Preview access' }, headers: { cookie: admin } })).json()
  const access = (await app.inject({ url: `/api/projects/${created.id}/preview/access`, headers: { cookie: admin } })).json()
  const url = new URL(access.url)
  const upstream = createServer((req, res) => res.end(JSON.stringify({ cookie: req.headers.cookie })))
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const gateway = (await startPreviewGateway(() => (upstream.address() as AddressInfo).port))!
  const port = (gateway.address() as AddressInfo).port
  const { request } = await import('node:http')
  const get = (path: string, cookie = '', host = url.host) => new Promise<{ status: number; cookie?: string[]; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers: { host, cookie } }, (res) => {
      let body = ''; res.on('data', (chunk) => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, cookie: res.headers['set-cookie'], body }))
    }); req.on('error', reject); req.end()
  })
  try {
    expect((await get('/')).status).toBe(403)
    const opened = await get(url.pathname + url.search)
    expect(opened.status).toBe(302)
    expect(opened.cookie![0]).toContain('Partitioned')
    expect((await get(url.pathname + url.search)).status).toBe(403)
    const cookie = opened.cookie![0]!.split(';')[0]!
    const allowed = await get('/', cookie + '; app_owned_cookie=ok')
    expect(allowed.status).toBe(200)
    expect(JSON.parse(allowed.body).cookie).toBe('app_owned_cookie=ok')
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: admin } })
    expect((await get('/', cookie)).status).toBe(403)
  } finally { gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close() }
})

it('accepts only signed OIDC backchannel logout events and invalidates the user session', async () => {
  const logged = await login('admin')
  expect((await app.inject({ method: 'POST', url: '/api/auth/backchannel-logout', payload: { logout_token: 'invalid' } })).statusCode).toBe(400)
  const logout = await token({ aud: 'aforge', events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })
  expect((await app.inject({ method: 'POST', url: '/api/auth/backchannel-logout', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ logout_token: logout }).toString() })).statusCode).toBe(200)
  expect((await app.inject({ url: '/api/projects', headers: { cookie: logged.cookie } })).statusCode).toBe(401)
})
