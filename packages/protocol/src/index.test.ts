import { describe, expect, it } from 'vitest'
import {
  Assembler, chunksOf, enrollmentToken, newSecret, newWorkerId, newWorkerKey, open, ownsRoom, parseEnrollment, peekWorker,
  roomOf, seal, splitConnection, withConnection, PROTOCOL_VERSION, CHUNK_BYTES,
} from './index.js'

describe('protocol', () => {
  it('lets only the secret holder own its room', () => {
    const secret = newSecret()
    expect(ownsRoom(secret, roomOf(secret))).toBe(true)
    expect(ownsRoom(newSecret(), roomOf(secret))).toBe(false)
    expect(roomOf(secret)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('seals for one worker key only and binds the worker id', () => {
    const id = newWorkerId()
    const key = newWorkerKey()
    const sealed = seal(id, key, { t: 'hello', n: 1 })
    expect(peekWorker(sealed)).toBe(id)
    expect(open(sealed, key)).toEqual({ worker: id, message: { t: 'hello', n: 1 } })
    expect(open(sealed, newWorkerKey())).toBeNull()
    // Claiming another worker id breaks the authentication tag.
    const forged = new TextEncoder().encode(new TextDecoder().decode(sealed).replace(id, newWorkerId()))
    expect(open(forged, key)).toBeNull()
  })

  it('round-trips enrollment tokens and rejects junk', () => {
    const e = { v: PROTOCOL_VERSION, relay: 'wss://relay.example.com', room: roomOf(newSecret()), id: newWorkerId(), key: newWorkerKey(), hub: 'Reactor' }
    expect(parseEnrollment(enrollmentToken(e))).toEqual(e)
    expect(() => parseEnrollment('afw1.e30')).toThrow()
    expect(() => parseEnrollment('nope')).toThrow()
  })

  it('frames connection ids', () => {
    const { c, payload } = splitConnection(withConnection(4_000_000_000, Uint8Array.of(1, 2, 3)))
    expect(c).toBe(4_000_000_000)
    expect([...payload]).toEqual([1, 2, 3])
  })

  it('chunks and reassembles transfers in order', () => {
    const data = Buffer.alloc(CHUNK_BYTES * 2 + 10, 7)
    const a = new Assembler()
    let whole: Buffer | null = null
    for (const ch of chunksOf(data)) whole = a.push(ch.seq, ch.data, ch.last)
    expect(whole?.equals(data)).toBe(true)
    expect(() => new Assembler().push(1, '', true)).toThrow()
  })
})
