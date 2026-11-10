// One per job: the job sees only this bounded endpoint, never the provider's reusable API credential.
import http from 'node:http'
import https from 'node:https'
export const createModelGateway = ({ provider, secret, maxRequests = 100, maxTokens = 16384, request = https.request }) => {
if (!secret || !['claude', 'codex'].includes(provider)) throw new Error('Missing model gateway configuration')
const hostname = provider === 'claude' ? 'api.anthropic.com' : 'api.openai.com'
const allowed = provider === 'claude' ? new Set(['/v1/messages', '/v1/messages/count_tokens']) : new Set(['/v1/responses', '/v1/responses/compact'])
let requests = 0
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://model').pathname
  if (req.method !== 'POST' || !allowed.has(path)) return void res.writeHead(404).end()
  if (++requests > maxRequests) return void res.writeHead(429).end('Model request limit reached')
  try {
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 ** 2) { res.writeHead(413).end(); req.destroy(); return } chunks.push(chunk) }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (typeof body.model !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(body.model)) return void res.writeHead(400).end()
    if (provider === 'claude' && path !== '/v1/messages/count_tokens') body.max_tokens = Math.min(maxTokens, Math.max(1, Number(body.max_tokens) || maxTokens))
    if (provider === 'codex') body.max_output_tokens = Math.min(maxTokens, Math.max(1, Number(body.max_output_tokens) || maxTokens))
    // Do not let generated code purchase provider-hosted tools or persist shared account state.
    if (Array.isArray(body.tools)) body.tools = body.tools.filter((tool) => !tool.type || ['function', 'custom'].includes(tool.type))
    delete body.mcp_servers
    if (provider === 'codex') body.store = false
    const headers = { 'content-type': 'application/json', ...(provider === 'claude' ? { 'x-api-key': secret, 'anthropic-version': String(req.headers['anthropic-version'] ?? '2023-06-01'), ...(req.headers['anthropic-beta'] ? { 'anthropic-beta': String(req.headers['anthropic-beta']).slice(0, 1000) } : {}) } : { authorization: `Bearer ${secret}` }) }
    const upstream = request({ hostname, port: 443, path, method: 'POST', headers, timeout: 120000 }, (response) => {
      // Provider responses are streamed; do not forward cookies or authentication headers.
      res.writeHead(response.statusCode ?? 502, { 'content-type': response.headers['content-type'] ?? 'application/json', 'cache-control': 'no-store' })
      response.pipe(res)
    })
    upstream.on('timeout', () => upstream.destroy(new Error('Provider timeout')))
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Model provider unavailable') })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    upstream.end(JSON.stringify(body))
  } catch { if (!res.headersSent) res.writeHead(400); res.end('Invalid model request') }
})
server.requestTimeout = 60000
return server
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const provider = process.env.PROVIDER
  createModelGateway({ provider, secret: provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY, maxTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 16384) }).listen(8080, '0.0.0.0')
}
