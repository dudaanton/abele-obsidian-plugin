import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { EventEmitter } from 'node:events'
import * as compression from 'node:zlib'

/** Streaming observation outside the renderer. No headers, tokens or bodies enter the trace. */
export class WireProxy extends EventEmitter {
  constructor(upstream, device) {
    super()
    this.upstream = new URL(upstream)
    this.device = device
    this.events = []
    this.active = new Map()
    this.owned = new Map()
    this.versions = new Map()
    this.offline = false
    this.sequence = 0
    this.server = createServer((req, res) => this.forward(req, res))
    this.server.on('upgrade', (req, socket, head) => {
      if (this.offline) {
        socket.destroy()
        return
      }
      const target = new URL(req.url, this.upstream)
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest
      const upstream = send(target, { headers: { ...req.headers, host: target.host } })
      upstream.on('upgrade', (response, peer, rest) => {
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n')}\r\n\r\n`
        )
        if (head.length) peer.write(head)
        if (rest.length) socket.write(rest)
        socket.pipe(peer).pipe(socket)
        socket.on('close', () => peer.destroy())
        peer.on('error', () => socket.destroy())
      })
      upstream.on('response', () => socket.destroy())
      upstream.on('error', () => socket.destroy())
      socket.on('error', () => upstream.destroy())
      upstream.end()
    })
    this.server.on('connection', (socket) => {
      this.sockets ??= new Set()
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
  }
  async start() {
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${this.server.address().port}`
  }
  record(entry) {
    const event = { device: this.device, at: Date.now(), ...entry }
    this.events.push(event)
    this.emit('wire', event)
    return event
  }
  markOwned(sha, request) {
    this.owned.set(sha, Math.min(this.owned.get(sha) ?? Infinity, request))
  }
  forward(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const id = ++this.sequence
    const entry = this.record({
      id,
      event: 'start',
      method: req.method,
      route: url.pathname,
      declaredBytes: Number(req.headers['content-length']) || 0,
    })
    this.active.set(id, entry)
    const uploadSha = /^\/v2\/uploads\/([a-f0-9]{64})/.exec(url.pathname)?.[1]
    if (uploadSha && req.method !== 'GET') this.markOwned(uploadSha, id)
    let sent = 0
    req.on('data', (chunk) => {
      sent += chunk.length
      entry.sent = sent
      if (
        this.breakpoint === 'large-upload' &&
        uploadSha &&
        (!this.breakpointSha || uploadSha === this.breakpointSha) &&
        sent >= (this.cutAfterBytes ?? 16 * 1024) &&
        (!entry.declaredBytes || sent < entry.declaredBytes)
      ) {
        this.breakpoint = null
        req.unpipe()
        req.pause()
        this.record({ event: 'trigger', kind: 'large-upload', id, sent })
      }
    })
    const complete = () => {
      this.active.delete(id)
      this.record({ event: 'close', id, completed: res.writableFinished })
    }
    res.once('close', complete)
    if (this.offline) {
      req.destroy()
      res.destroy()
      return
    }
    const target = new URL(url.pathname + url.search, this.upstream)
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const headers = { ...req.headers, host: target.host }
    delete headers.connection
    const body = []
    let bodyBytes = 0
    // Commit metadata is bounded by the protocol's 1000-op page, never content bytes.
    if (url.pathname === '/v2/commit')
      req.on('data', (chunk) => {
        bodyBytes += chunk.length
        if (bodyBytes <= 8 * 1024 ** 2) body.push(chunk)
      })
    if (url.pathname === '/v2/commit')
      req.on('end', () => {
        try {
          entry.contentCommit = JSON.parse(Buffer.concat(body).toString()).ops.some(
            (op) => !!op.sha
          )
        } catch {
          entry.contentCommit = false
        }
      })
    const upstream = send(target, { method: req.method, headers }, (response) => {
      const batchCandidate =
        this.breakpoint === 'batch' && url.pathname === '/v2/commit' && entry.contentCommit
      const matches =
        (this.breakpoint === 'comparison' && /\/(manifest|changes)$/.test(url.pathname)) ||
        (this.breakpoint === 'pull' && /\/content$/.test(url.pathname))
      if (matches) {
        const kind = this.breakpoint
        this.breakpoint = null
        response.pause()
        this.held = () => response.pipe(res)
        this.record({ event: 'trigger', kind, id })
      }
      res.writeHead(response.statusCode, response.headers)
      let received = 0
      const metadata = []
      response.on('data', (chunk) => {
        received += chunk.length
        if (
          (url.pathname === '/v2/commit' ||
            url.pathname === '/v2/manifest' ||
            url.pathname === '/v2/changes') &&
          received <= 16 * 1024 ** 2
        )
          metadata.push(chunk)
      })
      response.on('end', () => {
        let heldBatch = false
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            let decoded = Buffer.concat(metadata)
            if (metadata.length) {
              const decoders = {
                gzip: compression.gunzipSync,
                deflate: compression.inflateSync,
                br: compression.brotliDecompressSync,
                zstd: compression.zstdDecompressSync,
              }
              for (const encoding of String(response.headers['content-encoding'] ?? 'identity')
                .split(',')
                .map((value) => value.trim())
                .reverse()) {
                if (encoding === 'identity') continue
                if (!decoders[encoding]) throw new Error('Unsupported metadata encoding')
                decoded = decoders[encoding](decoded, { maxOutputLength: 16 * 1024 ** 2 })
              }
            }
            const json = metadata.length ? JSON.parse(decoded.toString()) : null
            if (url.pathname === '/v2/commit') {
              const ops = JSON.parse(Buffer.concat(body).toString()).ops
              for (const op of ops) if (op.sha) this.markOwned(op.sha, id)
              for (const result of json.results)
                if (result.version_id && result.sha)
                  this.versions.set(result.version_id, result.sha)
              if (
                batchCandidate &&
                this.breakpoint === 'batch' &&
                json.results.some((result) => result.status === 'applied' && result.sha)
              ) {
                this.breakpoint = null
                this.held = () => res.end(Buffer.concat(metadata))
                heldBatch = true
                this.record({ event: 'trigger', kind: 'batch', id, serverApplied: true })
              }
            }
            for (const item of json?.items ?? []) {
              const file = item.item ?? item
              if (file.version_id && file.sha) this.versions.set(file.version_id, file.sha)
            }
          } catch {
            this.record({ event: 'unparsed-metadata', id })
          }
        }
        this.record({ event: 'finish', id, status: response.statusCode, bytes: received })
        if (batchCandidate && !heldBatch) res.end(Buffer.concat(metadata))
      })
      response.on('error', () => res.destroy())
      if (!matches && !batchCandidate) response.pipe(res)
    })
    upstream.on('error', () => res.destroy())
    req.on('error', () => upstream.destroy())
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
    // Record the requested immutable version, including interrupted GETs.
    if (/\/files\/[^/]+\/content$/.test(url.pathname))
      entry.version = url.searchParams.get('version_id') ?? url.searchParams.get('version')
  }
  release() {
    this.held?.()
    this.held = null
    this.breakpoint = null
  }
  drop() {
    this.offline = true
    for (const socket of this.sockets ?? []) socket.destroy()
  }
  ownDownloads() {
    return this.events.filter(
      (event) =>
        event.event === 'start' &&
        event.method === 'GET' &&
        /\/content$/.test(event.route) &&
        (this.owned.get(this.versions.get(event.version)) ?? Infinity) < event.id
    ).length
  }
  unresolvedDownloads() {
    return this.events.filter(
      (event) =>
        event.event === 'start' &&
        event.method === 'GET' &&
        /\/content$/.test(event.route) &&
        !this.versions.has(event.version)
    ).length
  }
  async close() {
    for (const socket of this.sockets ?? []) socket.destroy()
    await new Promise((resolve) => this.server.close(resolve))
  }
}
