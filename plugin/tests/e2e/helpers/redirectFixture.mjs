// Separate process: a synchronous native eval must not block the listeners it is testing.
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const certPath = join(dir, 'sample-cert.pem')
const keyPath = join(dir, 'sample-key.pem')
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ],
  { stdio: 'ignore' }
)
const cert = readFileSync(certPath, 'utf8')
const requests = []
let sourceUrl = '',
  sinkUrl = ''
function handler(origin) {
  return async (req, res) => {
    if (req.url === '/proxy.pac') {
      res.setHeader('content-type', 'application/x-ns-proxy-autoconfig')
      res.end(
        'function FindProxyForURL(url, host) { return "PROXY ' +
          proxyUrl.replace('http://', '') +
          '"; }'
      )
      return
    }
    if (req.url === '/evidence') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(requests))
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    requests.push({
      origin,
      path: req.url,
      method: req.method,
      hasCredential: !!req.headers.authorization,
      hasPassword: body.includes('sample-password'),
    })
    if (req.url === '/bytes') {
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('x-sample', 'round-trip')
      res.end(Buffer.concat(chunks))
      return
    }
    if (req.url === '/slow') {
      res.writeHead(200)
      res.write('partial')
      return
    }
    const parts = req.url.split('/')
    if (parts[1] === 'redirect') {
      const target = parts[3] === 'same' ? '/sink' : sinkUrl + '/sink'
      res.writeHead(Number(parts[2]), { location: target })
      res.end('not sync data')
    } else if (req.url === '/cache') {
      res.setHeader('cache-control', 'public, max-age=3600')
      res.statusCode = req.headers.authorization === 'Bearer sample-first' ? 200 : 403
      res.end(req.headers.authorization === 'Bearer sample-first' ? 'first' : 'second')
    } else {
      res.end('listener reachable')
    }
  }
}
async function listen(server, scheme) {
  server.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  return scheme + '://127.0.0.1:' + server.address().port
}
const proxy = httpServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  requests.push({
    origin: 'proxy',
    path: req.url,
    method: req.method,
    hasCredential: !!req.headers.authorization,
    hasPassword: Buffer.concat(chunks).toString().includes('sample-password'),
  })
  res.end('session proxy route')
})
const proxyUrl = await listen(proxy, 'http')
const sink = httpServer(handler('sink'))
const source = httpServer(handler('source'))
const secure = httpsServer({ cert, key: readFileSync(keyPath) }, handler('secure'))
sinkUrl = await listen(sink, 'http')
sourceUrl = await listen(source, 'http')
const secureUrl = await listen(secure, 'https')
console.log(JSON.stringify({ sourceUrl, sinkUrl, secureUrl, proxyUrl, cert }))
process.on('SIGTERM', () => {
  for (const server of [source, sink, secure, proxy]) {
    server.close()
    server.closeAllConnections()
  }
  process.exit(0)
})
