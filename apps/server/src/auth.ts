// Sign-in through Keycloak (OIDC code flow with PKCE, run by the server) and project roles. The browser only
// holds an httpOnly session cookie, so SSE streams, images and videos keep working as plain URLs.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PROJECT_ROLES, type AppUser, type AuthState, type ProjectRole, type UserWithProjects } from '@aforge/shared'
import { DATA_DIR, locationOf } from './project-locations.js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { production, publicUrl } from './config.js'
import { writeJson } from './store.js'

export const authEnabled = process.env.AFORGE_AUTH !== 'off'
const ISSUER = `${(process.env.KEYCLOAK_URL ?? 'http://localhost:8380').replace(/\/$/, '')}/realms/${process.env.KEYCLOAK_REALM ?? 'aforge'}`
const BACKCHANNEL = `${(process.env.KEYCLOAK_INTERNAL_URL ?? process.env.KEYCLOAK_URL ?? 'http://localhost:8380').replace(/\/$/, '')}/realms/${process.env.KEYCLOAK_REALM ?? 'aforge'}`
const jwks = createRemoteJWKSet(new URL(`${BACKCHANNEL}/protocol/openid-connect/certs`))
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'aforge'
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET
const ADMIN_ROLE = process.env.KEYCLOAK_ADMIN_ROLE ?? 'aforge-admin'
const COOKIE = production ? '__Host-aforge_sid' : 'aforge_sid'
const SESSION_MS = 12 * 3600_000
const LOCAL_USER: AppUser = { id: 'local', username: 'local', name: 'Lokální uživatel', admin: true, lastLoginAt: new Date().toISOString() }

const AUTH_DIR = join(DATA_DIR, 'auth')
const USERS_FILE = join(AUTH_DIR, 'users.json')
const SESSIONS_FILE = join(AUTH_DIR, 'sessions.json')
const readJson = <T,>(file: string, fallback: T): T => { try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return fallback } }

type Session = { userId: string; idToken: string; expires: number; site?: string; issuer?: string; oidcSid?: string }
// Sessions survive the dev server's restarts on every edit.
const sessions = new Map(Object.entries(readJson<Record<string, Session>>(SESSIONS_FILE, {})))
const users = readJson<Record<string, AppUser>>(USERS_FILE, {})
const pending = new Map<string, { verifier: string; nonce: string; returnTo: string; at: number }>()
const persist = () => { mkdirSync(AUTH_DIR, { recursive: true }); return Promise.all([writeJson(SESSIONS_FILE, Object.fromEntries(sessions)), writeJson(USERS_FILE, users)]) }

const cookieOf = (req: FastifyRequest) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
export const userOf = (req: FastifyRequest): AppUser | null => {
  if (!authEnabled) return LOCAL_USER
  const sid = cookieOf(req)
  const session = sid ? sessions.get(sid) : undefined
  return session && session.expires > Date.now() && (!production || (session.site === publicUrl && session.issuer === ISSUER)) ? users[session.userId] ?? null : null
}
export const sessionAlive = (req: FastifyRequest) => {
  const sid = cookieOf(req)
  return () => !authEnabled || (!!sid && !!sessions.get(sid) && sessions.get(sid)!.expires > Date.now() && (!production || (sessions.get(sid)!.site === publicUrl && sessions.get(sid)!.issuer === ISSUER)))
}

// ---- project roles: members.json in the project root, shared by all its sessions and snapshots ----

const membersFile = (projectId: string) => join(locationOf(projectId).root, 'members.json')
export const membersOf = (projectId: string) => readJson<Record<string, ProjectRole>>(membersFile(projectId), {})
const RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 }
/** Missing membership denies access; legacy projects must be claimed by an administrator. */
export const roleOf = (user: AppUser, id: string): ProjectRole | undefined => {
  if (user.admin) return 'owner'
  const members = membersOf(locationOf(id).projectId)
  return members[user.id]
}
export const setMember = async (projectId: string, userId: string, role: ProjectRole | null) => {
  const members = membersOf(projectId)
  if (role) members[userId] = role
  else delete members[userId]
  if (!Object.values(members).includes('owner')) throw Object.assign(new Error('Projekt musí mít alespoň jednoho vlastníka.'), { statusCode: 400 })
  await writeJson(membersFile(projectId), members)
}
export const claimProject = (projectId: string, user: AppUser) => authEnabled ? setMember(projectId, user.id, 'owner') : Promise.resolve()

const deny = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode })

/** The role a request needs on its :id project. */
const needed = (req: FastifyRequest): ProjectRole =>
  req.routeOptions.url?.startsWith('/api/projects/:id/members') && req.method !== 'GET' ? 'owner' : req.method === 'GET' || req.method === 'HEAD' || (req.method === 'POST' && req.routeOptions.url === '/api/projects/:id/planning/read') ? 'viewer' : 'editor'

const b64 = (buf: Buffer) => buf.toString('base64url')
const origin = (req: FastifyRequest) => publicUrl ?? `${req.protocol}://${req.headers.host}`
const sameSitePath = (path: unknown) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/'

export const registerAuth = (app: FastifyInstance) => {
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return
    const user = userOf(req)
    if (!user) throw deny(401, 'Přihlaste se.')
    req.user = user
    const id = (req.params as { id?: string }).id
    if (req.url.startsWith('/api/projects/') && id) {
      const role = roleOf(user, id)
      if (!role) throw deny(404, 'Projekt neexistuje.')
      if (RANK[role] < RANK[needed(req)]) throw deny(403, role === 'viewer' ? 'Projekt máte jen pro čtení.' : 'Na tuto akci nemáte oprávnění.')
    }
    if ((req.url.startsWith('/api/hub') && req.method !== 'GET') || req.url.startsWith('/api/users')) {
      if (!user.admin) throw deny(403, 'Jen pro administrátory.')
    }
  })

  app.get('/api/auth/me', (req): AuthState => ({ enabled: authEnabled, user: userOf(req), ...(authEnabled ? { issuer: ISSUER } : {}) }))

  app.get<{ Querystring: { returnTo?: string } }>('/api/auth/login', async (req, reply) => {
    if (!authEnabled) return reply.redirect('/')
    // Check Keycloak first, so a stopped one shows on the sign-in page instead of a browser error.
    const up = await fetch(`${BACKCHANNEL}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false)
    if (!up) return reply.redirect('/?error=keycloak')
    const state = b64(randomBytes(24))
    const verifier = b64(randomBytes(48))
    const nonce = b64(randomBytes(32))
    for (const [key, p] of pending) if (Date.now() - p.at > 600_000) pending.delete(key)
    if (pending.size >= 1000) throw deny(429, 'Příliš mnoho přihlášení. Zkuste to později.')
    pending.set(state, { verifier, nonce, returnTo: sameSitePath(req.query.returnTo), at: Date.now() })
    reply.header('set-cookie', `aforge_login=${state}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=600${production || origin(req).startsWith('https:') ? '; Secure' : ''}`)
    const url = new URL(`${ISSUER}/protocol/openid-connect/auth`)
    url.search = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', scope: 'openid profile email', state, nonce,
      redirect_uri: `${origin(req)}/api/auth/callback`,
      code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    }).toString()
    return reply.redirect(url.toString())
  })

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/auth/callback', async (req, reply) => {
    const login = req.query.state ? pending.get(req.query.state) : undefined
    const browserState = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith('aforge_login='))?.slice(13)
    if (req.query.state) pending.delete(req.query.state)
    if (!login || !req.query.code || browserState !== req.query.state || Date.now() - login.at > 600_000) return reply.redirect('/?error=login')
    const res = await fetch(`${BACKCHANNEL}/protocol/openid-connect/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: req.query.code, client_id: CLIENT_ID, code_verifier: login.verifier,
        redirect_uri: `${origin(req)}/api/auth/callback`, ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {}),
      }),
    })
    if (!res.ok) return reply.redirect('/?error=login')
    const tokens = (await res.json()) as { access_token: string; id_token: string }
    let claims, id
    try {
      id = (await jwtVerify(tokens.id_token, jwks, { issuer: ISSUER, audience: CLIENT_ID })).payload
      claims = (await jwtVerify(tokens.access_token, jwks, { issuer: ISSUER })).payload
      if (!id.sub || id.sub !== claims.sub || id.nonce !== login.nonce || claims.azp !== CLIENT_ID) return reply.redirect('/?error=login')
    } catch { return reply.redirect('/?error=login') }
    const roles = ((claims.realm_access as { roles?: string[] } | undefined)?.roles) ?? []
    const user: AppUser = {
      id: String(id.sub),
      username: String(claims.preferred_username ?? id.sub),
      name: String(claims.name ?? claims.preferred_username ?? id.sub),
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      admin: roles.includes(ADMIN_ROLE),
      lastLoginAt: new Date().toISOString(),
    }
    users[user.id] = user
    const sid = b64(randomBytes(32))
    for (const [key, s] of sessions) if (s.expires < Date.now()) sessions.delete(key)
    sessions.set(sid, { userId: user.id, idToken: tokens.id_token, expires: Date.now() + SESSION_MS, site: publicUrl ?? 'local', issuer: ISSUER, ...(typeof id.sid === 'string' ? { oidcSid: id.sid } : {}) })
    await persist()
    setCookie(req, reply, sid, SESSION_MS / 1000)
    return reply.redirect(login.returnTo)
  })

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 32_000 }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))))
  app.post<{ Body: { logout_token?: string } }>('/api/auth/backchannel-logout', async (req, reply) => {
    try {
      const token = req.body?.logout_token
      if (!token || token.length > 24000) throw new Error('Missing logout token')
      const claims = (await jwtVerify(token, jwks, { issuer: ISSUER, audience: CLIENT_ID, maxTokenAge: '5m' })).payload
      const events = claims.events as Record<string, unknown> | undefined
      if (!events?.['http://schemas.openid.net/event/backchannel-logout'] || claims.nonce || (!claims.sid && !claims.sub)) throw new Error('Invalid logout event')
      for (const [key, session] of sessions) if (session.issuer === ISSUER && (claims.sid ? session.oidcSid === claims.sid : session.userId === claims.sub)) sessions.delete(key)
      await persist()
      return reply.code(200).send({ ok: true })
    } catch { return reply.code(400).send({ error: 'Neplatné ukončení přihlášení.' }) }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = cookieOf(req)
    const session = sid ? sessions.get(sid) : undefined
    if (sid) { sessions.delete(sid); await persist() }
    setCookie(req, reply, '', 0)
    if (!authEnabled || !session) return { url: '/' }
    const url = new URL(`${ISSUER}/protocol/openid-connect/logout`)
    url.search = new URLSearchParams({ id_token_hint: session.idToken, post_logout_redirect_uri: `${origin(req)}/` }).toString()
    return { url: url.toString() }
  })

  app.get('/api/users', async (): Promise<UserWithProjects[]> => {
    const projects = existsSync(join(DATA_DIR, 'projects')) ? await readdir(join(DATA_DIR, 'projects')) : []
    const all = authEnabled ? Object.values(users) : [LOCAL_USER]
    return all
      .map((u) => ({ ...u, projects: Object.fromEntries(projects.flatMap((p) => { const r = membersOf(p)[u.id]; return r ? [[p, r]] : [] })) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  })

  app.put<{ Params: { id: string; uid: string }; Body: { role?: string | null } }>('/api/projects/:id/members/:uid', async (req) => {
    const role = req.body?.role ?? null
    if (role !== null && !PROJECT_ROLES.includes(role as ProjectRole)) throw deny(400, 'Neplatná role.')
    if (!users[req.params.uid] && authEnabled) throw deny(404, 'Uživatel se zatím nepřihlásil.')
    await setMember(locationOf(req.params.id).projectId, req.params.uid, role as ProjectRole | null)
    return { ok: true }
  })
}

const setCookie = (req: FastifyRequest, reply: FastifyReply, value: string, maxAge: number) =>
  reply.header('set-cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAge)}${origin(req).startsWith('https:') ? '; Secure' : ''}`)

declare module 'fastify' {
  interface FastifyRequest { user: AppUser | null }
}
