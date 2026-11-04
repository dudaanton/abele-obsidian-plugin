import { expect } from 'vitest'
import { MAX_CHUNK_BYTES, V2EngineClient } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { sha256 } from '@noble/hashes/sha2'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'
import { mobileStreamFixture } from './mobileStreamFixture'
import { mobileRangeCacheFixture } from './mobileRangeCacheFixture'

const hex = (data: Uint8Array) =>
  Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('')

export async function checkMobileUploadResume(streaming: boolean) {
  const f = streaming ? mobileRangeCacheFixture() : mobileStreamFixture(),
    root = connectionPrivateRoot('sample-connection')
  const adapter = connectionAdapter(f.adapter, 'Shared', root)
  const open = () =>
    new BoundedVaultIo(adapter, undefined, undefined, undefined, '.obsidian', root).openUploadRead(
      'Shared/sample.bin'
    )
  const chunk = new Uint8Array(MAX_CHUNK_BYTES).fill(73),
    partSha = hex(sha256(chunk)),
    hash = sha256.create()
  for (let i = 0; i < 200; i++) hash.update(chunk)
  const expected = { size: f.size, sha: hex(hash.digest()) }
  const token = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder', id: 'root', path: '/' },
  })
  const received = new Set<number>()
  let stopped = true,
    completed = false
  const client = () =>
    new V2EngineClient(token, {
      fetch: async (url, init) => {
        if (init?.method === 'HEAD') return new Response(null, { status: completed ? 200 : 404 })
        const path = new URL(String(url)).pathname
        if (path.endsWith('/begin'))
          return Response.json({
            upload_id: 'sample-upload',
            part_size: MAX_CHUNK_BYTES,
            parts: 200,
            received: [...received],
          })
        if (path.endsWith('/complete')) {
          expect(received.size).toBe(200)
          completed = true
          return new Response(null, { status: 204 })
        }
        const part = Number(path.split('/').at(-1))
        if (stopped && part === 17) throw new Error('simulated interruption')
        expect(received.has(part)).toBe(false)
        const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
        expect(bytes.length).toBe(MAX_CHUNK_BYTES)
        expect(hex(sha256(bytes))).toBe(partSha)
        received.add(part)
        return new Response(null, { status: 204 })
      },
    })
  await expect(client().putBlobSource(expected, await open())).rejects.toThrow()
  expect(received.size).toBe(17)
  expect(completed).toBe(false)
  expect(mobileReadSnapshot().retainedBytes).toBe(0)
  stopped = false
  const before = f.counts.bytesProduced
  await client().putBlobSource(expected, await open())
  expect(f.counts.bytesProduced - before).toBe(f.size)
  expect(completed).toBe(true)
  const bounds = mobileReadSnapshot()
  // The legacy host still proves one whole read. A streaming host must never
  // allocate that buffer, including when it skips locally past acknowledged parts.
  if (streaming) {
    expect(bounds.maxChunkBytes).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
    expect(bounds.peakReaderBytes).toBeLessThanOrEqual(2 * MAX_CHUNK_BYTES)
    expect(bounds.wholeReads).toBe(0)
  } else {
    expect(bounds.maxChunkBytes).toBe(f.size)
    expect(bounds.peakReaderBytes).toBeLessThanOrEqual(f.size + MAX_CHUNK_BYTES)
  }
  expect(bounds.retainedBytes).toBe(0)
  expect(bounds.activeStreams).toBe(0)
  expect(f.counts.arrayBuffers).toBe(0)
  expect(f.counts.blobs).toBe(0)
  expect(f.readBinary).toHaveBeenCalledTimes(streaming ? 0 : 2)
  expect(f.counts.largeFetches).toBe(streaming ? 2 : 0)
  expect(f.probes.size).toBe(0)
}
