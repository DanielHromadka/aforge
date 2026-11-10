// Reactor relay: passes frames between one hub (an Reactor server, the host) and its worker daemons
// (clients). Modelled on aFinder's relay (mobile/relay): one room per hub, the room name is the hash
// of the hub's secret so only the hub can claim it, and the payloads are end-to-end encrypted, so the
// relay only keeps rooms apart. Everyone connects outwards; no server needs an open port.
import http from 'node:http'
import { randomInt } from 'node:crypto'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import { MAX_MESSAGE_BYTES, ROOM_RE, ownsRoom, splitConnection, withConnection, type RelayControl } from '@aforge/protocol'

const PORT = Number(process.env.PORT ?? 8787)
const MAX_CLIENTS = Number(process.env.RELAY_MAX_CLIENTS ?? 64)
/** Connections per IP and minute: reconnects are rare, so this only stops floods. */
const CONNECT_LIMIT = Number(process.env.RELAY_CONNECT_LIMIT ?? 60)
/** A host that has not proven ownership by then is dropped. */
const AUTH_TIMEOUT_MS = 10_000

interface Room {
  host?: WebSocket
  clients: Map<number, WebSocket>
}

const rooms = new Map<string, Room>()
const roomOf = (name: string) => rooms.get(name) ?? (rooms.set(name, { clients: new Map() }), rooms.get(name)!)
const tidy = (name: string) => {
  const r = rooms.get(name)
  if (r && !r.host && r.clients.size === 0) rooms.delete(name)
}

/** A peer may be closing at any moment; a lost message to it does not matter. */
const send = (ws: WebSocket | undefined, data: string | Uint8Array) => {
  try {
    if (ws?.readyState === ws?.OPEN) ws?.send(data)
  } catch {
    // closed meanwhile
  }
}
const control = (ws: WebSocket | undefined, msg: RelayControl) => send(ws, JSON.stringify(msg))
const bytes = (data: RawData): Uint8Array => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer))

const hits = new Map<string, { at: number; n: number }>()
const allowed = (ip: string) => {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.at > 60_000) {
    hits.set(ip, { at: now, n: 1 })
    return true
  }
  return ++h.n <= CONNECT_LIMIT
}
setInterval(() => {
  const now = Date.now()
  for (const [ip, h] of hits) if (now - h.at > 60_000) hits.delete(ip)
}, 60_000).unref()

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`Reactor relay\nrooms: ${rooms.size}\n`)
    return
  }
  res.writeHead(404).end()
})

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES + 16 })

const ROUTE = /^\/v1\/room\/([A-Za-z0-9_-]+)$/

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://relay')
  const name = ROUTE.exec(url.pathname)?.[1]
  const role = url.searchParams.get('role')
  const peer = req.socket.remoteAddress ?? 'local'
  const trusted = process.env.RELAY_TRUST_PROXY === 'true' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
  const ip = String(trusted ? req.headers['x-forwarded-for'] ?? peer : peer).split(',')[0]!.trim()
  const refuse = (status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\n\r\n`)
  }
  if (!name || !ROOM_RE.test(name)) return refuse(404, 'Not Found')
  if (role !== 'host' && role !== 'client') return refuse(400, 'Bad Request')
  if (!allowed(ip)) return refuse(429, 'Too Many Requests')
  if (role === 'client' && roomOf(name).clients.size >= MAX_CLIENTS) return refuse(503, 'Room Full')
  wss.handleUpgrade(req, socket, head, (ws) => (role === 'host' ? acceptHost(ws, name) : acceptClient(ws, name)))
})

const acceptClient = (ws: WebSocket, name: string) => {
  const room = roomOf(name)
  let c: number
  do c = randomInt(1, 2 ** 32 - 1)
  while (room.clients.has(c))
  room.clients.set(c, ws)
  control(ws, { t: 'host', online: !!room.host })
  control(room.host, { t: 'open', c })
  ws.on('message', (data, isBinary) => {
    // Text from workers is only the keep-alive; everything else goes to the hub.
    if (!isBinary) return send(ws, 'pong')
    send(room.host, withConnection(c, bytes(data)))
  })
  ws.on('close', () => {
    room.clients.delete(c)
    control(room.host, { t: 'close', c })
    tidy(name)
  })
  ws.on('error', () => ws.terminate())
}

const acceptHost = (ws: WebSocket, name: string) => {
  let authed = false
  const timer = setTimeout(() => ws.close(4003, 'Not authenticated'), AUTH_TIMEOUT_MS)
  ws.on('message', (data, isBinary) => {
    const room = roomOf(name)
    if (!authed) {
      let msg: RelayControl | null = null
      try {
        msg = isBinary ? null : (JSON.parse(bytes(data).toString()) as RelayControl)
      } catch {
        // refused below
      }
      if (msg?.t !== 'auth' || typeof msg.secret !== 'string' || msg.secret.length > 100 || !ownsRoom(msg.secret, name)) return ws.close(4003, 'Not the owner of this room')
      clearTimeout(timer)
      authed = true
      // A newer connection of the same hub (restart, network change) replaces the old one.
      if (room.host && room.host !== ws) room.host.close(4001, 'Replaced')
      room.host = ws
      control(ws, { t: 'ready' })
      for (const [c, client] of room.clients) {
        control(ws, { t: 'open', c })
        control(client, { t: 'host', online: true })
      }
      return
    }
    if (isBinary) {
      const { c, payload } = splitConnection(bytes(data))
      send(room.clients.get(c), payload)
      return
    }
    const text = bytes(data).toString()
    if (text === 'ping') return send(ws, 'pong')
    try {
      const msg = JSON.parse(text) as RelayControl
      // The hub drops a worker it does not know or that misbehaves.
      if (msg.t === 'close') room.clients.get(msg.c)?.close(4002, 'Closed by the hub')
    } catch {
      // ignore
    }
  })
  ws.on('close', () => {
    clearTimeout(timer)
    const room = rooms.get(name)
    if (room?.host === ws) {
      room.host = undefined
      for (const client of room.clients.values()) control(client, { t: 'host', online: false })
      tidy(name)
    }
  })
  ws.on('error', () => ws.terminate())
}

server.listen(PORT, process.env.RELAY_HOST ?? '0.0.0.0', () => console.log(`Reactor relay on :${PORT}`))

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  for (const client of wss.clients) client.close(1001, 'Server restarting')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
})
