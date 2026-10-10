import { createServer, request as tlsRequest } from 'node:https'
import { request } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import { readFileSync } from 'node:fs'

/** Node-side fixture assertions use normal TLS verification, optionally with the
 * runner's explicit CA. The phone separately trusts that CA in its own OS. */
export const fixtureTlsFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init),
    body = req.body ? Buffer.from(await req.arrayBuffer()) : null,
    ca = process.env.ABELE_SYNC_PHONE_TLS_CA
  const requestHeaders: Record<string, string> = {}
  req.headers.forEach((value, name) => {
    requestHeaders[name] = value
  })
  return new Promise<Response>((resolve, reject) => {
    const outgoing = tlsRequest(
      req.url,
      {
        method: req.method,
        headers: requestHeaders,
        signal: req.signal,
        ...(ca ? { ca: readFileSync(ca) } : {}),
      },
      (incoming) => {
        const chunks: Uint8Array[] = []
        incoming.on('data', (chunk) => chunks.push(Uint8Array.from(chunk)))
        incoming.on('error', reject)
        incoming.on('end', () => {
          const status = incoming.statusCode ?? 502,
            headers = new Headers()
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(', ') : value)
          const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
          }
          resolve(
            new Response([204, 205, 304].includes(status) ? null : bytes.buffer, {
              status,
              headers,
            })
          )
        })
      }
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

/** A real TLS front end for isolated LAN fixtures, including the v2 WebSocket feed.
 * Certificates belong to the test runner, not the repository or the plugin. */
export async function syncFixtureTls(backend: string, host: string) {
  const cert = process.env.ABELE_SYNC_PHONE_TLS_CERT,
    key = process.env.ABELE_SYNC_PHONE_TLS_KEY
  if (!cert || !key)
    throw new Error(
      'Phone sync fixtures require ABELE_SYNC_PHONE_TLS_CERT and ABELE_SYNC_PHONE_TLS_KEY'
    )
  const target = new URL(backend),
    sockets = new Set<Duplex>()
  const server = createServer(
    { cert: readFileSync(cert), key: readFileSync(key) },
    (incoming, outgoing) => {
      const upstream = request(
        {
          hostname: target.hostname,
          port: target.port,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(outgoing)
        }
      )
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502)
        outgoing.end()
      })
      outgoing.on('close', () => upstream.destroy())
      incoming.pipe(upstream)
    }
  )
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (incoming, socket, head) => {
    const upstream = connect(Number(target.port), target.hostname, () => {
      upstream.write(
        `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${Object.entries(
          incoming.headers
        )
          .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
          .join('\r\n')}\r\n\r\n`
      )
      if (head.length) upstream.write(Uint8Array.from(head))
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host.startsWith('[') ? '::' : '0.0.0.0', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('TLS fixture has no listening port')
  return {
    url: `https://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
