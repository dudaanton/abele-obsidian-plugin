import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { MemoryStateStore, MemoryFileSystem, scan } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { reconciliationScan } from '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'

it('maps cached hash requests and rejects paths outside the connection scope', async () => {
  const method = Symbol.for('abele.sync.cached-scan-hash-v1')
  const cached = vi.fn(async () => null)
  const fs = Object.assign(new MemoryFileSystem(), { [method]: cached })
  const mapped = new LocalFolderPlacement('Shared', 'Local').fileSystem(fs)
  await Reflect.get(mapped, method)('Shared/sample.md')
  expect(cached).toHaveBeenCalledExactlyOnceWith('Local/sample.md')
  const scoped = scopedFileSystem(
    fs,
    (path) => {
      if (!path.startsWith('Local/')) throw new Error('outside')
    },
    (path) => path.startsWith('Local/')
  )
  expect(() => Reflect.get(scoped, method)('Other/sample.md')).toThrow('outside')
  expect(cached).toHaveBeenCalledTimes(1)
})

const content = '\uFEFF# Sample\r\nRaw café bytes\r\n'
const sha = createHash('sha256').update(Buffer.from(content)).digest('hex')

it('reuses the current host hash when the recorded note stat no longer matches', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content, mtime: 1000 }])
  Object.assign(app.metadataCache, {
    getFileInfo: () => ({ hash: sha, size: Buffer.byteLength(content), mtime: 1000 }),
  })
  const state = new MemoryStateStore()
  await state.put({
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample',
    versionId: 'v1',
    sha: 'a'.repeat(64),
    size: 1,
    mtime: 500,
  })
  const fs = new ObsidianFileSystem(app as never)
  const fingerprint = vi.spyOn(fs, 'fingerprint')
  const result = await reconciliationScan(fs, state, { excluded: () => false }, 0)
  expect(result.found.hashes.get('sample.md')).toBe(sha)
  expect(result.found.ops).toContainEqual(expect.objectContaining({ op: 'modify', sha }))
  expect(fingerprint).not.toHaveBeenCalled()
})

it.each(['valid', 'missing', 'uppercase', 'stale', 'rebuilding', 'binary', 'explicit'])(
  'uses a host raw-byte SHA-256 only with current stat evidence: %s',
  async (mode) => {
    const path = mode === 'binary' ? 'sample.bin' : 'sample.md'
    const app = buildFakeVault([{ path, content, mtime: 1000 }])
    const row = {
      hash: mode === 'uppercase' ? sha.toUpperCase() : sha,
      size: Buffer.byteLength(content),
      mtime: mode === 'stale' ? 999 : 1000,
    }
    Object.assign(app.metadataCache, {
      initialized: true,
      isCacheClean: () => mode !== 'rebuilding',
      getFileInfo: mode === 'missing' ? undefined : () => row,
    })
    const fs = new ObsidianFileSystem(app as never)
    const fingerprint = vi.spyOn(fs, 'fingerprint')
    const result = await scan(
      fs,
      new MemoryStateStore(),
      { excluded: () => false },
      mode === 'explicit' ? { revalidate: 'all' } : {}
    )
    expect(result.hashes.get(path)).toBe(sha)
    expect(fingerprint).toHaveBeenCalledTimes(['valid', 'binary'].includes(mode) ? 0 : 1)
  }
)
