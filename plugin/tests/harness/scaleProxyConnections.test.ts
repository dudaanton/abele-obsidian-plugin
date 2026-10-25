// @vitest-environment node
import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WireProxy } from '../scale/proxy.mjs'

it('reuses upstream connections across bodyless upload presence requests', async () => {
  let connections = 0
  const upstream = createServer((request, response) => {
    if (request.method === 'GET') response.end('sample payload')
    else response.end()
  })
  upstream.on('connection', () => connections++)
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address() as { port: number }
  const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample')
  const endpoint = await proxy.start()
  try {
    for (let i = 0; i < 32; i++) {
      const response = await fetch(endpoint + '/v2/uploads/' + 'a'.repeat(64), {
        method: 'HEAD',
      })
      expect(response.status).toBe(200)
      const content = await fetch(endpoint + '/sample')
      expect(await content.text()).toBe('sample payload')
    }
    expect(connections).toBeLessThanOrEqual(2)
  } finally {
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

it('honors a server that explicitly closes its HEAD connection', async () => {
  let connections = 0
  const upstream = createServer((_request, response) => {
    response.setHeader('Connection', 'close')
    response.end()
  })
  upstream.on('connection', () => connections++)
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address() as { port: number }
  const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample')
  const endpoint = await proxy.start()
  try {
    for (let i = 0; i < 3; i++)
      expect((await fetch(endpoint + '/sample', { method: 'HEAD' })).status).toBe(200)
    expect(connections).toBe(3)
  } finally {
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
