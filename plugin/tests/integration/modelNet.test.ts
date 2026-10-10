import { createServer, request, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { getModelNet } from '@/ai/client/modelNet'
import type { DesktopNet } from '@/helpers/netTransport'

// The same event contract as Electron, backed by a portable HTTP listener for this tier.
const net: DesktopNet = {
  request(options) {
    const events = new EventEmitter()
    const outgoing = request(
      options.url,
      { method: options.method, headers: options.headers },
      (incoming) => {
        if ([301, 302, 303, 307, 308].includes(incoming.statusCode!) && incoming.headers.location) {
          events.emit('redirect', incoming.statusCode, options.method, incoming.headers.location)
        } else events.emit('response', incoming)
      }
    )
    outgoing.on('error', (error) => events.emit('error', error))
    return Object.assign(events, {
      write: (data: string | Uint8Array) => {
        outgoing.write(data)
      },
      end: () => {
        outgoing.end()
      },
      abort: () => outgoing.destroy(),
    }) as ReturnType<DesktopNet['request']>
  },
}

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

describe('native model redirect transport', () => {
  it.each([301, 302, 303, 307, 308])(
    'follows HTTP %s explicitly and strips keys only across origins',
    async (status) => {
      const seen: { headers: Record<string, unknown>; method: string; body: string }[] = []
      const sink = createServer((request, response) => {
        let body = ''
        request.on('data', (chunk) => {
          body += String(chunk)
        })
        request.on('end', () => {
          seen.push({ headers: request.headers, method: request.method!, body })
          response.setHeader('X-Sample', 'sample-value')
          response.end('Sample answer')
        })
      })
      const sinkUrl = await listen(sink)
      let redirectedHeaders: Record<string, unknown> = {}
      const source = createServer((request, response) => {
        request.resume()
        request.on('end', () => {
          if (request.url === '/same') {
            response.writeHead(status, { Location: '/cross' })
          } else {
            response.writeHead(status, { Location: sinkUrl })
            redirectedHeaders = request.headers
          }
          response.end()
        })
      })
      const sourceUrl = await listen(source)
      const response = await getModelNet(net).session.fetch(sourceUrl + '/same', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sample-key',
          'X-Api-Key': 'sample-key',
          'Content-Type': 'application/json',
          'User-Agent': 'SampleClient/1.0',
        },
        body: '{"sample":"body"}',
      })
      expect(await response.text()).toBe('Sample answer')
      expect(response.headers.get('x-sample')).toBe('sample-value')
      expect(redirectedHeaders.authorization).toBe('Bearer sample-key')
      expect(redirectedHeaders['user-agent']).toBe('SampleClient/1.0')
      expect(seen).toHaveLength(1)
      const toGet = [301, 302, 303].includes(status)
      expect(seen[0].method).toBe(toGet ? 'GET' : 'POST')
      expect(seen[0].body).toBe(toGet ? '' : '{"sample":"body"}')
      expect(seen[0].headers.authorization).toBeUndefined()
      expect(seen[0].headers['x-api-key']).toBeUndefined()
      expect(seen[0].headers['user-agent']).toBe('SampleClient/1.0')
      expect(seen[0].headers['content-type']).toBe(toGet ? undefined : 'application/json')
    }
  )

  it('bounds redirect loops and rejects non-HTTP or credential-bearing redirect addresses', async () => {
    const source = createServer((request, response) => {
      request.resume()
      response.writeHead(307, {
        Location:
          request.url === '/loop'
            ? '/loop'
            : request.url === '/scheme'
              ? 'file:///sample'
              : 'https://sample:password@model.example.invalid',
      })
      response.end()
    })
    const base = await listen(source)
    const fetch = getModelNet(net).session.fetch
    await expect(fetch(base + '/loop')).rejects.toThrow('Too many model request redirects')
    await expect(fetch(base + '/scheme')).rejects.toThrow('Invalid model request redirect')
    await expect(fetch(base + '/credentials')).rejects.toThrow('Invalid model request redirect')
  })

  it('does not forward a credential hidden in a redirect URL or retained body', async () => {
    let sinkRequests = 0
    const sinkUrl = await listen(
      createServer((_request, response) => {
        sinkRequests++
        response.end('unexpected')
      })
    )
    const sourceUrl = await listen(
      createServer((request, response) => {
        request.resume()
        response.writeHead(307, {
          Location: sinkUrl + (request.url === '/url' ? '/sample%2Dprivate%2Dkey' : '/'),
        })
        response.end()
      })
    )
    const fetch = getModelNet(net).session.fetch
    await expect(
      fetch(sourceUrl + '/url', { headers: { Authorization: 'Bearer sample-private-key' } })
    ).rejects.toThrow('cannot carry a saved key')
    await expect(
      fetch(sourceUrl + '/body', {
        method: 'POST',
        headers: { Authorization: 'Bearer sample-private-key' },
        body: '{"sample":"sample-private-key"}',
      })
    ).rejects.toThrow('cannot carry a saved key')
    expect(sinkRequests).toBe(0)
  })

  it('cancels a native idle response and a pending connection', async () => {
    const source = createServer((request, response) => {
      request.resume()
      if (request.url === '/idle') response.flushHeaders()
    })
    const base = await listen(source)
    for (const path of ['/connecting', '/idle']) {
      const controller = new AbortController()
      const work = getModelNet(net).session.fetch(base + path, { signal: controller.signal })
      const pending = path === '/idle' ? (await work).body!.getReader().read() : work
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    }
  })
})
