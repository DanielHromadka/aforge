// Wire format between the Reactor hub (host), the relay and the worker daemons (clients). The framing
// follows aFinder's companion relay:
//
//   relay ⇄ host:   binary = [connection id u32][payload], both ways;  text = RelayControl JSON
//   relay ⇄ worker: binary = payload;  text "ping" → "pong"
//
// A payload is a UTF-8 JSON Envelope {w, n, c}: the worker id in plain text (the hub needs it to pick
// the key) and the message sealed with that worker's own key. The relay sees ids and ciphertext only.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const PROTOCOL_VERSION = 1
/** File data (git bundles) travels in chunks this big. */
export const CHUNK_BYTES = 256 * 1024
/** Base64 and JSON around a chunk stay well below this. */
export const MAX_MESSAGE_BYTES = 1024 * 1024
/** A hello older than this is refused, so a recorded handshake cannot be replayed later. */
export const HELLO_MAX_AGE_MS = 2 * 60_000

export const ROOM_RE = /^[A-Za-z0-9_-]{43}$/
export const WORKER_ID_RE = /^w-[a-z0-9]{6,32}$/

// ---- relay -----------------------------------------------------------------------------------

export type RelayControl =
  | { t: 'auth'; secret: string }
  | { t: 'ready' }
  | { t: 'open'; c: number }
  | { t: 'close'; c: number }
  | { t: 'host'; online: boolean }

export const roomUrl = (relay: string, room: string, role: 'host' | 'client') =>
  `${relay.replace(/\/+$/, '')}/v1/room/${room}?role=${role}`

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))

/** The room is the hash of the hub's secret: only the hub can claim it and the relay stores nothing. */
export const roomOf = (secret: string) => b64url(createHash('sha256').update(fromB64url(secret)).digest())
export const newSecret = () => b64url(randomBytes(32))

/** Proves `secret` belongs to `room` without leaking timing. */
export const ownsRoom = (secret: string, room: string) => {
  try {
    const a = Buffer.from(roomOf(secret))
    const b = Buffer.from(room)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export const withConnection = (c: number, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(4 + payload.length)
  new DataView(out.buffer).setUint32(0, c)
  out.set(payload, 4)
  return out
}

export const splitConnection = (data: Uint8Array) => ({
  c: new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0),
  payload: data.subarray(4),
})

// ---- enrollment ------------------------------------------------------------------------------

export interface Enrollment {
  v: number
  relay: string
  room: string
  id: string
  /** Base64url of the 32-byte key this worker and the hub share. */
  key: string
  hub: string
}

const TOKEN_PREFIX = 'afw1.'

export const enrollmentToken = (e: Enrollment) => TOKEN_PREFIX + b64url(Buffer.from(JSON.stringify(e)))

export const parseEnrollment = (token: string): Enrollment => {
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error('Not an Reactor worker token')
  const e = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url').toString('utf8')) as Enrollment
  if (e.v !== PROTOCOL_VERSION || !ROOM_RE.test(e.room) || !WORKER_ID_RE.test(e.id) || fromB64url(e.key).length !== 32) throw new Error('Invalid token')
  if (!/^wss?:\/\//.test(e.relay)) throw new Error('Invalid relay address')
  return e
}

export const newWorkerId = () => `w-${randomBytes(6).toString('hex')}`
export const newWorkerKey = () => b64url(randomBytes(32))

// ---- sealed envelopes ------------------------------------------------------------------------

export interface Envelope {
  w: string
  n: string
  c: string
}

/** ChaCha20-Poly1305 with a random 96-bit nonce; the worker id is bound in as associated data. */
export const seal = (workerId: string, key: string, message: unknown): Uint8Array => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('chacha20-poly1305', fromB64url(key), nonce, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(workerId))
  const body = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return new TextEncoder().encode(JSON.stringify({ w: workerId, n: b64url(nonce), c: body.toString('base64url') } satisfies Envelope))
}

export const peekWorker = (payload: Uint8Array): string | null => {
  try {
    const env = JSON.parse(new TextDecoder().decode(payload)) as Envelope
    return typeof env.w === 'string' && WORKER_ID_RE.test(env.w) ? env.w : null
  } catch {
    return null
  }
}

/** Null when the envelope was not sealed with this key (wrong worker, tampering, garbage). */
export const open = <T>(payload: Uint8Array, key: string): { worker: string; message: T } | null => {
  try {
    const env = JSON.parse(new TextDecoder().decode(payload)) as Envelope
    const body = Buffer.from(env.c, 'base64url')
    const decipher = createDecipheriv('chacha20-poly1305', fromB64url(key), fromB64url(env.n), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(env.w))
    decipher.setAuthTag(body.subarray(body.length - 16))
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()])
    return { worker: env.w, message: JSON.parse(plain.toString('utf8')) as T }
  } catch {
    return null
  }
}

// ---- messages --------------------------------------------------------------------------------

export interface Capabilities {
  claude: boolean
  codex: boolean
  docker: boolean
  git: boolean
}

export type JobSpec =
  /** One structured answer: the worker runs `claude -p --json-schema` (no tools) and returns the JSON. */
  | { kind: 'consult'; system: string; prompt: string; schema: Record<string, unknown> }
  /** The hub streams a git bundle of the workspace first; the worker returns a bundle of its new commits. */
  | { kind: 'implement'; agent: 'claude' | 'codex'; prompt: string; base: string; message: string }

/** Worker → hub. Everything after hello carries the session id from the hub's welcome. */
export type ToHub =
  | { t: 'hello'; name: string; version: number; caps: Capabilities; labels: string[]; maxJobs: number; ts: number; wn: string; telemetry?: boolean }
  | { t: 'event'; s: string; job: string; kind: string; text: string; usage?: import('@aforge/shared').AgentUsage }
  | { t: 'chunk'; s: string; job: string; seq: number; data: string; last: boolean }
  | { t: 'result'; s: string; job: string; ok: boolean; data?: unknown; error?: string }

/** Hub → worker. The welcome echoes the worker's hello nonce, so an old welcome cannot be replayed. */
export type ToWorker =
  | { t: 'welcome'; s: string; wn: string; hub: string }
  | { t: 'job'; s: string; job: string; spec: JobSpec }
  | { t: 'chunk'; s: string; job: string; seq: number; data: string; last: boolean }
  | { t: 'cancel'; s: string; job: string }
  | { t: 'bye'; reason: string }

export const randomId = (n = 12) => randomBytes(n).toString('base64url')

/** Splits a buffer into the chunk messages of a transfer. */
export function* chunksOf(data: Uint8Array): Generator<{ seq: number; data: string; last: boolean }> {
  const count = Math.max(1, Math.ceil(data.length / CHUNK_BYTES))
  for (let seq = 0; seq < count; seq++) {
    yield { seq, data: Buffer.from(data.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)).toString('base64'), last: seq === count - 1 }
  }
}

/** Collects chunk messages in order; resolves with the whole buffer after the last one. */
export class Assembler {
  private parts: Buffer[] = []
  constructor(private readonly limitBytes = 512 * 1024 * 1024) {}
  private size = 0
  push(seq: number, data: string, last: boolean): Buffer | null {
    if (seq !== this.parts.length) throw new Error('Chunk out of order')
    const part = Buffer.from(data, 'base64')
    this.size += part.length
    if (this.size > this.limitBytes) throw new Error('Transfer too large')
    this.parts.push(part)
    return last ? Buffer.concat(this.parts) : null
  }
}
