import { expect, it, vi } from 'vitest'
import { ExpectedWrites, MemoryStateStore, push, scan, sha256 } from '@abele/sync-sdk/core'
import type { CommitOp } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

const confirmMissing = Symbol.for('abele.sync.confirm-missing-v1')
const inventoryPass = Symbol.for('abele.sync.inventory-pass-v1')

it('checks the physical disk before publishing a deletion despite a cached inventory absence', async () => {
  const app = buildFakeVault([{ path: 'other.md', content: 'another upload', mtime: 2 }])
  const fs = new ObsidianFileSystem(app as never)
  const state = new MemoryStateStore()
  const content = new TextEncoder().encode('restored sample')
  await state.put({
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(content),
    size: content.length,
    mtime: 1,
  })
  const lookup = app.vault.getFileByPath.bind(app.vault)
  vi.spyOn(app.vault, 'getFileByPath').mockImplementation((path) =>
    path === 'sample.md' ? null : lookup(path)
  )
  const commitRaw = vi.fn(async (ops: CommitOp[]) => ({
    replayed: false,
    body: {
      head_seq: 1,
      results: ops.map((op, n) => ({
        status: 'applied',
        seq: n + 1,
        file_id: 'file_id' in op ? op.file_id : 'other-file',
        version_id: `v${n}`,
        path: op.op === 'create' ? op.path : 'sample.md',
        sha: 'sha' in op ? op.sha : null,
        size: 'size' in op ? op.size : 0,
        mtime: 'mtime' in op ? op.mtime : 0,
      })),
    },
  }))
  const client = {
    commitRaw,
    hasBlob: async () => {
      await app.vault.adapter.write('sample.md', 'restored sample')
      // No host event: the inventory still reports the old absence.
      expect(await fs.stat('sample.md')).toBeNull()
      return true
    },
  }
  await Reflect.get(fs, inventoryPass).call(fs, async () => {
    expect(await fs.stat('sample.md')).toBeNull()
    const found = await scan(fs, state, { excluded: () => false })
    expect(found.ops).toContainEqual(expect.objectContaining({ op: 'delete' }))
    await push(client as never, fs, state, found, { expected: new ExpectedWrites() })
  })
  expect(commitRaw.mock.calls.flatMap(([ops]) => ops).some((op) => op.op === 'delete')).toBe(false)
  expect(await app.vault.adapter.read('sample.md')).toBe('restored sample')
})

it('maps fresh absence checks through placement and enforces connection scope', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  const confirm = vi.fn(async () => true)
  Object.assign(fs, { [confirmMissing]: confirm })
  const placed = new LocalFolderPlacement('Shared', 'Local').fileSystem(fs)
  expect(await Reflect.get(placed, confirmMissing)('Shared/sample.md')).toBe(true)
  expect(confirm).toHaveBeenCalledExactlyOnceWith('Local/sample.md')
  const scoped = scopedFileSystem(
    fs,
    (path) => {
      if (!path.startsWith('Local/')) throw new Error('outside scope')
    },
    (path) => path.startsWith('Local/')
  )
  expect(() => Reflect.get(scoped, confirmMissing)('Other/sample.md')).toThrow('outside scope')
  expect(confirm).toHaveBeenCalledTimes(1)
})
