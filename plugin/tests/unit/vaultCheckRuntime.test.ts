import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { runtimeVaultCheck } from '@/sync/vaultCheckRuntime'
import { sha256 } from '@/sync/external/hash'

const encoded = btoa(
  JSON.stringify({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder', id: 'root', path: '/' },
  })
)
it('reads fresh content, skips directory records and only issues read-only manifest requests', async () => {
  const fs = new MemoryFileSystem()
  const bytes = new TextEncoder().encode('sample bytes')
  await fs.writeAtomic('sample.md', bytes, 1)
  const stale = vi.fn(async () => {
    throw new Error('Cached fingerprint must not be used')
  })
  Object.assign(fs, { fingerprint: stale })
  const write = vi.spyOn(fs, 'writeAtomic')
  const remove = vi.spyOn(fs, 'remove')
  const send = vi.fn(async () => {})
  const sha = await sha256(bytes)
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + 'a'.repeat(43))
    return Response.json(
      {
        cursor: 1,
        next: null,
        items: [
          {
            path: 'folder',
            file_id: 'directory-id',
            version_id: 'directory-version',
            kind: 'directory',
            mtime: 1,
          },
          {
            path: 'sample.md',
            file_id: 'sample-id',
            version_id: 'sample-version',
            kind: 'note',
            sha,
            size: bytes.length,
            mtime: 1,
          },
        ],
      },
      { headers: { 'abele-restore-generation': 'generation-one' } }
    )
  })
  const source = runtimeVaultCheck({
    fs,
    encoded,
    fetch,
    localPath: (path) => path,
    excluded: () => false,
    entry: async () => null,
    send,
  })
  await source.run()
  expect(source.state.value).toMatchObject({ kind: 'matched', total: 1, bytes: bytes.length })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(stale).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})
it('does not trust a paginated inventory across a server restore with an unchanged cursor', async () => {
  let requests = 0
  const source = runtimeVaultCheck({
    fs: new MemoryFileSystem(),
    encoded,
    fetch: async () =>
      Response.json(
        { items: [], cursor: 1, next: requests++ === 0 ? 'page-two' : null },
        { headers: { 'abele-restore-generation': requests === 1 ? 'before' : 'after' } }
      ),
    localPath: (path) => path,
    excluded: () => false,
    entry: async () => null,
    send: async () => {},
  })
  await source.run()
  expect(source.state.value.kind).toBe('unreachable')
})
