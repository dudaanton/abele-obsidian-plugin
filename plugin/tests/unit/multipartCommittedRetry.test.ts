import { expect, it } from 'vitest'
import { MAX_CHUNK_BYTES, V2EngineClient, fingerprintSource } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'

it('probes a committed multipart blob after a lost completion response without resending bytes', async () => {
  const size = 3 * MAX_CHUNK_BYTES
  const source = () => ({
    size,
    read: async (_offset: number, length: number) => new Uint8Array(length),
    assertUnchanged: async () => {},
    close: async () => {},
  })
  const identity = await fingerprintSource(source())
  const token = encodeAccessToken({
    v: 1,
    address: 'https://sync.example.invalid',
    key: 'a'.repeat(43),
    scope: { kind: 'folder', id: 'sample-root', path: '/' },
  })
  let committed = false,
    disconnected = false,
    sent = 0,
    probes = 0
  const client = () =>
    new V2EngineClient(token, {
      fetch: async (input, init) => {
        if (disconnected) throw new Error('simulated connection loss')
        const path = new URL(String(input)).pathname
        if (init?.method === 'HEAD') {
          probes++
          return new Response(null, { status: committed ? 200 : 404 })
        }
        if (path.endsWith('/begin'))
          return Response.json({
            upload_id: 'sample-upload',
            part_size: MAX_CHUNK_BYTES,
            parts: 3,
            received: [],
          })
        if (path.endsWith('/complete')) {
          committed = true
          disconnected = true
          throw new Error('simulated loss after server commit')
        }
        if (init?.method === 'PUT')
          sent += new Uint8Array(await new Response(init.body).arrayBuffer()).length
        return new Response(null, { status: 204 })
      },
    })
  await expect(client().putBlobSource(identity, source())).rejects.toThrow()
  expect(committed).toBe(true)
  expect(sent).toBe(size)
  disconnected = false
  sent = 0
  probes = 0
  await client().putBlobSource(identity, source())
  expect(probes).toBe(1)
  expect(sent).toBe(0)
})
