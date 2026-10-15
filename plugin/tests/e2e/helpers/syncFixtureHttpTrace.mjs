import { existsSync } from 'node:fs'
import { Server } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'

/**
 * Test-only freeze: while `file` exists, the server blocks before handling any request. A test
 * stops the process as well, but the bench's CPU throttle stops and continues every process it
 * owns, which also woke a server a test had stopped; the blocked loop stays down until the file
 * is removed.
 */
export function installFixtureFreeze(file) {
  const emit = Server.prototype.emit
  const cell = new Int32Array(new SharedArrayBuffer(4))
  Server.prototype.emit = function (event, ...args) {
    if (event === 'request') while (existsSync(file)) Atomics.wait(cell, 0, 0, 20)
    return emit.call(this, event, ...args)
  }
  syncBuiltinESMExports()
}

/** Test-only observation at the actual fixture HTTP server, before Fastify routing. */
export function installFixtureHttpTrace(write, closeConnections = false) {
  const emit = Server.prototype.emit
  const sockets = new WeakMap()
  let next = 0
  Server.prototype.emit = function (event, ...args) {
    if (event === 'request') {
      const [request, response] = args
      let connection = sockets.get(request.socket)
      if (!connection) {
        connection = ++next
        sockets.set(request.socket, connection)
      }
      const startedAt = Date.now()
      // Never record authorization, query strings, body bytes, or user-selected paths.
      const path = (request.url ?? '').split('?')[0]
      const route = [
        '/v2/connection',
        '/v2/commit',
        '/v2/changes',
        '/v2/manifest',
        '/healthz',
      ].includes(path)
        ? path
        : path.startsWith('/v2/uploads/')
          ? '/v2/uploads/:id'
          : /^\/v2\/files\/[^/]+\/external\/verify$/.test(path)
            ? '/v2/files/:id/external/verify'
            : /^\/v2\/files\/[^/]+\/content$/.test(path)
              ? '/v2/files/:id/content'
              : '/other'
      const base = {
        connection,
        port: request.socket.localPort,
        method: request.method,
        route,
        startedAt,
      }
      // Do not start body flow before Fastify installs its parser.
      const declaredBytes = Number(request.headers['content-length']) || 0
      write({ ...base, event: 'arrival' })
      response.once('finish', () =>
        write({
          ...base,
          event: 'finish',
          status: response.statusCode,
          connectionClose: String(response.getHeader('Connection')).toLowerCase() === 'close',
          declaredBytes,
          bodyComplete: request.complete,
          durationMs: Date.now() - startedAt,
        })
      )
      response.once('close', () => {
        if (!response.writableFinished)
          write({
            ...base,
            event: 'interrupted',
            declaredBytes,
            bodyComplete: request.complete,
            durationMs: Date.now() - startedAt,
          })
      })
      if (closeConnections) {
        response.shouldKeepAlive = false
        response.setHeader('Connection', 'close')
      }
    }
    return emit.call(this, event, ...args)
  }
  syncBuiltinESMExports()
  return () => {
    Server.prototype.emit = emit
    syncBuiltinESMExports()
  }
}

if (process.env.ABELE_FIXTURE_FREEZE_FILE)
  installFixtureFreeze(process.env.ABELE_FIXTURE_FREEZE_FILE)
if (process.env.ABELE_FIXTURE_HTTP_TRACE === '1') {
  installFixtureHttpTrace(
    (entry) => console.log('[sync-fixture-http] ' + JSON.stringify(entry)),
    process.env.E2E_TARGET === 'phone'
  )
}
