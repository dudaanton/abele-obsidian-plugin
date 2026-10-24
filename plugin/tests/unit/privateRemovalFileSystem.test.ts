import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { expect, it } from 'vitest'
import {
  MemoryFileSystem,
  retainRemoval,
  recoverRemovals,
  retentionSnapshot,
  sha256,
} from '@abele/sync-sdk/core'
import { privateRemovalFileSystem, PRIVATE_REMOVAL_FILES } from '@/sync/privateRemovalFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'

it('isolates durable removal summaries per connection while mapping public sources', async () => {
  const raw = new MemoryFileSystem()
  const own = '.obsidian/plugins/sample/connections/first'
  Object.assign(raw, {
    [PRIVATE_REMOVAL_FILES]: (map?: (path: string) => string) =>
      privateRemovalFileSystem(raw, own, map),
  })
  const placed = new LocalFolderPlacement('Shared', 'Moved').fileSystem(raw)
  const includes = (path: string) => path === 'Shared' || path.startsWith('Shared/')
  const scoped = scopedFileSystem(
    placed,
    (path) => {
      if (!includes(path)) throw new Error('outside scope')
    },
    includes
  )
  const fs = Reflect.get(scoped, PRIVATE_REMOVAL_FILES)() as typeof raw
  await fs.writeAtomic('.abele-sync/retained-removals/summary.json', new Uint8Array([1]), 1)
  expect(await raw.read(own + '/retained-removals/summary.json')).toEqual(new Uint8Array([1]))
  const second = privateRemovalFileSystem(raw, '.obsidian/plugins/sample/connections/second')
  expect(await second.stat('.abele-sync/retained-removals/summary.json')).toBeNull()
  await fs.writeAtomic('Shared/sample.md', new Uint8Array([2]), 1)
  expect(await raw.read('Moved/sample.md')).toEqual(new Uint8Array([2]))
  await expect(async () => fs.stat('Outside/sample.md')).rejects.toThrow('outside scope')
  await expect(async () =>
    fs.remove('.abele-sync/retained-removals/../../sample.md')
  ).rejects.toThrow('Invalid retained removal path')
  await expect(async () =>
    scoped.stat('.abele-sync/retained-removals/summary.json')
  ).rejects.toThrow()
})

it('keeps a captured removal through the minimum age and preserves changed bytes at reclamation', async () => {
  const raw = new MemoryFileSystem()
  const fs = privateRemovalFileSystem(raw, '.obsidian/plugins/sample/connections/retained')
  Object.assign(raw, { [PRIVATE_REMOVAL_FILES]: () => fs })
  const bytes = new Uint8Array([1, 2]),
    sha = await sha256(bytes)
  await raw.writeAtomic('sample.md', bytes, 1)
  const now = 1000000000
  const op = {
    path: 'sample.md',
    expected: { sha, size: 2, mtime: 1 },
    effect: { kind: 'remove' as const },
  }
  await expect(retainRemoval(raw, op, { now, clock: () => now })).resolves.toBe(true)
  const rows = await retentionSnapshot(raw)
  expect(rows).toHaveLength(1)
  expect(await raw.stat('sample.md')).toBeNull()
  await recoverRemovals(raw, undefined, { now: () => now + 1000, maxBytes: 0 })
  expect(await fs.read(rows[0].victim)).toEqual(bytes)
  await fs.writeAtomic(rows[0].victim, new Uint8Array([9, 8, 7]), 1)
  await recoverRemovals(raw, undefined, { now: () => now + 8 * 86400000, maxBytes: 0 })
  expect(await raw.read('sample.md')).toEqual(new Uint8Array([9, 8, 7]))
})

it.each([
  'pull-cleanup-head',
  'pull-cleanup:sample',
  'removal-decision:sample',
  'removal-source:sample',
])('refuses raw ledger deletion while %s owns cleanup', async (key) => {
  const { assertDiscardableSyncLedger } = await import('@/sync/privateRemovalFileSystem')
  expect(() => assertDiscardableSyncLedger(new Map([['plugin:' + key, 'sample owner']]))).toThrow(
    'SDK cleanup'
  )
})

it.each([false, true])(
  'keeps retained summaries connection-local without a folder mount (filtered=%s)',
  async (filtered) => {
    const app = buildFakeVault([{ path: 'Notes/sample.md', content: 'sample', mtime: 1000 }])
    const raw = new ObsidianFileSystem(app as never, {
      journalOwner: 'sample-default-owner',
      ...(filtered
        ? {
            discovery: { roots: ['Notes'], includes: (path: string) => path === 'Notes/sample.md' },
          }
        : {}),
    })
    const fs = raw[PRIVATE_REMOVAL_FILES]()
    await fs.writeAtomic(
      '.abele-sync/retained-removals/summary.json',
      new TextEncoder().encode('[]'),
      1000
    )
    expect(
      await app.vault.adapter.read(
        '.abele-sync/connections/sample-default-owner/retained-removals/summary.json'
      )
    ).toBe('[]')
    expect(await app.vault.adapter.exists('.abele-sync/retained-removals/summary.json')).toBe(false)
  }
)
