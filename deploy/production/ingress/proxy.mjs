import http from 'node:http'
import net from 'node:net'
const host = process.env.TARGET
if (!host || !/^aforge-app-[a-z0-9-]+$/.test(host)) throw new Error('Invalid preview target')
const server = http.createServer((req, res) => {
  const up = http.request({ host, port: 80, path: req.url, method: req.method, headers: req.headers }, (response) => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res) })
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  req.on('aborted', () => up.destroy()); req.pipe(up)
})
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(80, host, () => { up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`); up.write(head); up.pipe(socket); socket.pipe(up) })
  up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy())
})
server.listen(8080, '0.0.0.0')
