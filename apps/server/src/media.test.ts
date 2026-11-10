import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
it('stores private media once and issues a short-lived signed URL with safe download headers', async () => {
  let stored = false, puts = 0
  const server = createServer(async (req, res) => {
    if (req.method === 'HEAD') { res.writeHead(stored ? 200 : 404); res.end(); return }
    if (req.method === 'PUT') { for await (const _ of req) { /* consume upload */ } stored = true; puts++; res.setHeader('etag', 'fixture'); res.end(); return }
    res.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const dir = await mkdtemp(join(tmpdir(), 'reactor-media-test-'))
  try {
    vi.stubEnv('AFORGE_MEDIA_BUCKET', 'private-fixture'); vi.stubEnv('AFORGE_MEDIA_ENDPOINT', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    vi.stubEnv('AFORGE_MEDIA_ACCESS_KEY_ID', 'fixture'); vi.stubEnv('AFORGE_MEDIA_SECRET_ACCESS_KEY', 'fixture-secret')
    const file = join(dir, 'fixture.txt'); await writeFile(file, 'file bytes')
    const { mediaUrl } = await import('./media.js')
    const url = new URL((await mediaUrl('attachments/private-id/file', file, 'text/plain', 'attachment'))!)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment')
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true)
    expect(url.pathname).toContain('/private-fixture/attachments/private-id/file')
    await mediaUrl('attachments/private-id/file', file, 'text/plain', 'attachment')
    expect(puts).toBe(1)
  } finally { server.closeAllConnections(); server.close(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) }
})
