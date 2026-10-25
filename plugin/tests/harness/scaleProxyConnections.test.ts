// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WireProxy } from '../scale/proxy.mjs'

it('restores the commit interruption after releasing the genuine upload hold', async () => {
  const digest = 'a'.repeat(64)
  let uploaded = 0
  const upstream = createServer((request, response) => {
    request.on('data', (chunk) => {
      if (request.method === 'PUT') uploaded += chunk.length
    })
    request.on('end', () =>
      response.end(
        request.url === '/v2/commit'
          ? JSON.stringify({
              results: [{ status: 'applied', sha: digest, version_id: 'sample-version' }],
            })
          : 'ok'
      )
    )
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address() as { port: number }
  const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample')
  const endpoint = await proxy.start()
  proxy.breakpoint = 'reindex-upload'
  const upload = globalThis.fetch(endpoint + '/v2/uploads/' + digest + '/sample/0', {
    method: 'PUT',
    body: 'data',
  })
  upload.catch(() => {})
  let commit: Promise<Response> | undefined
  try {
    await vi.waitFor(() => expect(proxy.events.some((e) => e.kind === 'reindex-upload')).toBe(true))
    expect(uploaded).toBe(0)
    proxy.release('batch')
    expect(await (await upload).text()).toBe('ok')
    commit = globalThis.fetch(endpoint + '/v2/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'create', path: 'Notes/sample.md', sha: digest }] }),
    })
    commit.catch(() => {})
    await vi.waitFor(() =>
      expect(proxy.events.some((e) => e.kind === 'batch' && e.serverApplied)).toBe(true)
    )
    proxy.release()
    expect((await (await commit).json()).results[0].status).toBe('applied')
  } finally {
    proxy.release()
    await Promise.allSettled([upload, commit])
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

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
      const response = await globalThis.fetch(endpoint + '/v2/uploads/' + 'a'.repeat(64), {
        method: 'HEAD',
      })
      expect(response.status).toBe(200)
      const content = await globalThis.fetch(endpoint + '/sample')
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
      expect((await globalThis.fetch(endpoint + '/sample', { method: 'HEAD' })).status).toBe(200)
    expect(connections).toBe(3)
  } finally {
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
