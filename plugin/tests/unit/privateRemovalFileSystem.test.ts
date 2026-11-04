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
import { WriteJournal } from '@/sync/writeJournal'
import { requireExternalLifecycleSafety } from '@/sync/external/pluginSafety'
import { failureDetails } from '@/sync/tokenUi'
import { indexedDB } from 'fake-indexeddb'

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

it('retires obsolete owned removal metadata instead of retaining each summary generation', async () => {
  const app = buildFakeVault([])
  const raw = new ObsidianFileSystem(app as never, { journalOwner: 'sample-summary-owner' })
  const fs = raw[PRIVATE_REMOVAL_FILES]()
  const path = '.abele-sync/retained-removals/summary.json'
  await fs.writeAtomic(path, new TextEncoder().encode('[ ]'), 1000)
  await fs.writeAtomic(path, new TextEncoder().encode('[\n]'), 2000)
  await fs.writeAtomic(path, new TextEncoder().encode('[]'), 3000)
  expect(new TextDecoder().decode(await fs.read(path))).toBe('[]')
  const folder = '.abele-sync/connections/sample-summary-owner/retained-removals'
  expect((await app.vault.adapter.list(folder)).files).toEqual([folder + '/summary.json'])
  const conditional = Reflect.get(raw, 'conditional')
  expect((await conditional.host.retention.summary()).count).toBe(0)
})

it('preserves independently changed private metadata instead of retiring it', async () => {
  const app = buildFakeVault([])
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  let changed = false,
    enabled = false
  app.vault.adapter.rename = async (from: string, to: string) => {
    await rename(from, to)
    if (enabled && !changed && from.endsWith('/summary.json') && to.endsWith('/victim')) {
      changed = true
      await app.vault.adapter.write(to, 'independently edited metadata')
    }
  }
  const raw = new ObsidianFileSystem(app as never, { journalOwner: 'sample-changed-summary' })
  const fs = raw[PRIVATE_REMOVAL_FILES]()
  const path = '.abele-sync/retained-removals/summary.json'
  await fs.writeAtomic(path, new TextEncoder().encode('[ ]'), 1000)
  enabled = true
  await expect(fs.writeAtomic(path, new TextEncoder().encode('[]'), 2000)).rejects.toThrow(
    'File changed before publication'
  )
  expect(changed).toBe(true)
  const contents: string[] = []
  const collect = async (folder: string) => {
    const entries = await app.vault.adapter.list(folder)
    for (const file of entries.files) contents.push(await app.vault.adapter.read(file))
    for (const child of entries.folders) await collect(child)
  }
  await collect('.abele-sync')
  expect(contents).toContain('independently edited metadata')
})

it('refuses to remove a decision directory containing unexpected bytes', async () => {
  const app = buildFakeVault([])
  const raw = new ObsidianFileSystem(app as never, { journalOwner: 'sample-private-directory' })
  const fs = raw[PRIVATE_REMOVAL_FILES]()
  const folder = '.abele-sync/retained-removals/11111111-1111-4111-8111-111111111111'
  await fs.mkdir!(folder)
  await fs.writeAtomic(folder + '/victim', new Uint8Array([7]), 1000)
  await expect(fs.removeDirectory!(folder)).rejects.toThrow('not empty')
  expect(await fs.read(folder + '/victim')).toEqual(new Uint8Array([7]))
})

it.each([
  'pull-cleanup-head',
  'pull-cleanup:sample',
  'removal-decision:sample',
  'removal-source:sample',
])('refuses raw ledger deletion while %s owns cleanup', async (key) => {
  const { assertDiscardableSyncLedger } = await import('@/sync/privateRemovalFileSystem')
  expect(() => assertDiscardableSyncLedger(new Map([['plugin:' + key, 'sample owner']]))).toThrow(
    'SDK cleanup must settle before ledger deletion: plugin:' + key
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
    expect(
      await new WriteJournal(app as never, undefined, 'sample-default-owner').currentEntries()
    ).toEqual([])
  }
)

it.each([undefined, 'sample-conditional'])(
  'retires a stale private summary install intent after a newer valid summary was saved (%s)',
  async (conditionalReceipt) => {
    const owner = 'sample-owner'
    const app = buildFakeVault([])
    const target = `.abele-sync/connections/${owner}/retained-removals/summary.json`
    const temp = `.abele-sync/connections/${owner}/writes/.abele-receipt-sample.tmp`
    const id = 'sample-retained'
    const victim = `.abele-sync/connections/${owner}/retained-removals/${id}/victim`
    const summary = JSON.stringify([
      {
        id,
        path: 'Notes/sample.md',
        victim: `.abele-sync/retained-removals/${id}/victim`,
        capturedAt: 1000,
        expected: {
          path: 'Notes/sample.md',
          wirePath: 'Notes/sample.md',
          fileId: 'sample-file',
          versionId: 'sample-version',
          sha: 'b'.repeat(64),
          size: 4,
          mtime: 1000,
        },
        phase: 'committed',
      },
    ])
    const bytes = new TextEncoder().encode(summary)
    for (const path of [
      '.abele-sync',
      '.abele-sync/connections',
      `.abele-sync/connections/${owner}`,
      `.abele-sync/connections/${owner}/retained-removals`,
      `.abele-sync/connections/${owner}/retained-removals/${id}`,
    ])
      await app.vault.adapter.mkdir(path)
    await app.vault.adapter.writeBinary(target, bytes.buffer as ArrayBuffer)
    await app.vault.adapter.write(victim, 'kept')
    const journal = new WriteJournal(app as never, undefined, owner)
    await journal.persist(() =>
      journal.add({ target, temp, replacementSha: 'a'.repeat(64), conditionalReceipt })
    )
    const raw = new ObsidianFileSystem(app as never, {
      journalOwner: owner,
      ledger: { readCommittedEntries: async () => [] } as never,
    })

    await raw.recover()

    expect(await journal.currentEntries()).toEqual([])
    expect(await app.vault.adapter.read(target)).toBe(summary)
    expect(await app.vault.adapter.read(victim)).toBe('kept')
  }
)

it('identifies the retained installation record in startup failure diagnostics', async () => {
  const app = buildFakeVault([])
  const target = '.abele-sync/connections/sample-owner/retained-removals/summary.json'
  const temp = '.abele-sync/connections/sample-owner/writes/.abele-receipt-sample.tmp'
  const journal = new WriteJournal(app as never)
  await journal.persist(() => journal.add({ target, temp, replacementSha: 'a'.repeat(64) }))

  let error: unknown
  try {
    await requireExternalLifecycleSafety(app as never, indexedDB)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(Error)
  expect(failureDetails(error)).toMatchObject({
    recoveryRecord: { kind: 'installation', id: '.abele-receipt-sample.tmp', path: target },
  })
})

it.each([undefined, 'sample-conditional'])(
  'keeps the install intent when the private summary cannot be validated (%s)',
  async (conditionalReceipt) => {
    const owner = 'sample-owner'
    const app = buildFakeVault([])
    const target = `.abele-sync/connections/${owner}/retained-removals/summary.json`
    const temp = `.abele-sync/connections/${owner}/writes/.abele-receipt-sample.tmp`
    for (const path of [
      '.abele-sync',
      '.abele-sync/connections',
      `.abele-sync/connections/${owner}`,
      `.abele-sync/connections/${owner}/retained-removals`,
    ])
      await app.vault.adapter.mkdir(path)
    await app.vault.adapter.write(target, '{unreadable')
    const journal = new WriteJournal(app as never, undefined, owner)
    await journal.persist(() =>
      journal.add({ target, temp, replacementSha: 'a'.repeat(64), conditionalReceipt })
    )
    const raw = new ObsidianFileSystem(app as never, {
      journalOwner: owner,
      ledger: { readCommittedEntries: async () => [] } as never,
    })

    let failure: unknown
    try {
      await raw.recover()
    } catch (error) {
      failure = error
    }
    expect(failureDetails(failure)).toMatchObject({
      recoveryRecord: { kind: 'installation', id: '.abele-receipt-sample.tmp', path: target },
    })
    expect(await journal.currentEntries()).toHaveLength(1)
    expect(await app.vault.adapter.read(target)).toBe('{unreadable')
  }
)
