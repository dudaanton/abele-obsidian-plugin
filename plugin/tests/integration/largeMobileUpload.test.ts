import { afterEach, expect, it, vi } from 'vitest'
import { V2EngineClient, MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { sha256 } from '@noble/hashes/sha2'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'

const size = 200 * MAX_CHUNK_BYTES
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
afterEach(() => vi.unstubAllGlobals())
it('uploads 200 MiB in one bounded pass and resumes without resending acknowledged parts', async () => {
  const hash = sha256.create()
  for (let i = 0; i < 200; i++) hash.update(new Uint8Array(MAX_CHUNK_BYTES).fill(73))
  const expected = { size, sha: hex(hash.digest()) },
    received = new Map<number, string>()
  let killed = true,
    completed = false,
    readBytes = 0,
    maxRead = 0
  const probes = new Map<string, Uint8Array>(),
    folders = new Set<string>()
  const whole = vi.fn(() => {
    throw new Error('whole-file read')
  })
  const adapter = {
    getResourcePath: (path: string) => 'capacitor://localhost/_capacitor_file_/sample/' + path,
    exists: async (path: string) => probes.has(path) || folders.has(path),
    mkdir: async (path: string) => {
      folders.add(path)
    },
    writeBinary: async (path: string, bytes: ArrayBuffer) => {
      probes.set(path, new Uint8Array(bytes))
    },
    remove: async (path: string) => {
      probes.delete(path)
    },
    stat: async (path: string) => ({
      type: 'file',
      size: probes.get(path)?.length ?? size,
      mtime: 1,
      ctime: 1,
    }),
    readBinary: whole,
  } as unknown as DataAdapter
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const probe = probes.get(url.split('/sample/')[1])
    const range = new Headers(init?.headers).get('Range')
    const [, start, end] = range
      ? /^bytes=(\d+)-(\d+)$/.exec(range)!
      : ['', '0', String(probe!.length - 1)]
    const length = Number(end) - Number(start) + 1
    if (!probe) {
      readBytes += length
      maxRead = Math.max(maxRead, length)
    }
    const bytes = probe
      ? probe.slice(Number(start), Number(end) + 1)
      : new Uint8Array(length).fill(73)
    return new Response(bytes, {
      status: range ? 206 : 200,
      headers: range ? { 'Content-Range': `bytes ${start}-${end}/${probe?.length ?? size}` } : {},
    })
  })
  const root = connectionPrivateRoot('sample-connection')
  const scoped = connectionAdapter(adapter, 'Shared', root)
  const io = () => new BoundedVaultIo(scoped, undefined, undefined, undefined, '.obsidian', root)
  const source = () => io().openRead('Shared/sample.bin')
  await expect(io().openRead('Private/other.bin')).rejects.toThrow()
  const token = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder', id: 'root', path: '/' },
  })
  const client = () =>
    new V2EngineClient(token, {
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/begin'))
          return Response.json({
            upload_id: 'sample-upload',
            part_size: MAX_CHUNK_BYTES,
            parts: 200,
            received: [...received.keys()],
          })
        if (path.endsWith('/complete')) {
          completed = true
          return new Response(null, { status: 204 })
        }
        const part = Number(path.split('/').at(-1))
        if (killed && part === 17) throw new Error('simulated termination')
        expect(received.has(part)).toBe(false)
        const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
        expect(bytes.length).toBe(MAX_CHUNK_BYTES)
        received.set(part, hex(sha256(bytes)))
        return new Response(null, { status: 204 })
      },
    })
  await expect(client().putBlobSource(expected, await source())).rejects.toThrow()
  expect(completed).toBe(false)
  expect(received.size).toBe(17)
  killed = false
  readBytes = 0
  await client().putBlobSource(expected, await source())
  expect(readBytes).toBe(size)
  expect(maxRead).toBe(MAX_CHUNK_BYTES)
  expect(received.size).toBe(200)
  expect(completed).toBe(true)
  expect(new Set(received.values())).toEqual(
    new Set([hex(sha256(new Uint8Array(MAX_CHUNK_BYTES).fill(73)))])
  )
  // Eviction's byte proof uses the same bounded fingerprint port on a fresh runtime.
  readBytes = 0
  expect(await io().fingerprint('Shared/sample.bin')).toMatchObject(expected)
  expect(readBytes).toBe(size)
  expect(maxRead).toBe(MAX_CHUNK_BYTES)
  expect(whole).not.toHaveBeenCalled()
  expect(probes.size).toBe(0)
  expect(
    [...folders].every(
      (path) => path === root || root.startsWith(path + '/') || path.startsWith(root + '/')
    )
  ).toBe(true)
}, 30000)

it('never completes or commits corrupt multipart content and closes its source', async () => {
  const paths: string[] = [],
    close = vi.fn(async () => {})
  const token = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder', id: 'root', path: '/' },
  })
  const client = new V2EngineClient(token, {
    fetch: async (url) => {
      const path = new URL(String(url)).pathname
      paths.push(path)
      if (path.endsWith('/begin'))
        return Response.json({
          upload_id: 'sample',
          part_size: MAX_CHUNK_BYTES,
          parts: 2,
          received: [],
        })
      return new Response(null, { status: 204 })
    },
  })
  await expect(
    client.putBlobSource(
      { sha: 'a'.repeat(64), size: 2 * MAX_CHUNK_BYTES },
      {
        size: 2 * MAX_CHUNK_BYTES,
        read: async (_at, length) => new Uint8Array(length),
        assertUnchanged: async () => {},
        close,
      }
    )
  ).rejects.toMatchObject({ code: 'hash_mismatch' })
  expect(paths).toHaveLength(3)
  expect(
    paths.every((path) => path.startsWith('/v2/uploads/') && !path.endsWith('/complete'))
  ).toBe(true)
  expect(close).toHaveBeenCalledOnce()
})
