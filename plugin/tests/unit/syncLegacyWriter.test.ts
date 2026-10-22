import { expect, it, vi } from 'vitest'
import { VaultWriter, WriteJournal } from '@/sync/vaultWrites'
import { buildFakeVault } from '../helpers/fakeVault'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

it('does not archive an unproven public retained-backup locator', async () => {
  const app = buildFakeVault([]),
    disk = app.vault.adapter
  await disk.write('sample.md', 'independent local bytes')
  const journal = new WriteJournal(app)
  await journal.persist(() => journal.preserve({ target: 'other.md', backup: 'sample.md' }))
  const archiveBackup = vi.fn(async () => '/sample-recovery/retained.old')
  const writer = new VaultWriter({
    conditionalFile: vi.fn(async () => false),
    stagingDirectory: '.staging',
    filesystem: disk as never,
    native: { archiveBackup } as never,
    journal,
    indexed: () => false,
    makeParents: async () => {},
  })
  await expect(writer.recover()).rejects.toThrow('private artifact')
  expect(archiveBackup).not.toHaveBeenCalled()
  expect(await disk.read('sample.md')).toBe('independent local bytes')
  expect((await journal.currentRecovered())[0].backup).toBe('sample.md')
})

it('uses two durable journal mutations and one payload write for an absent publication', async () => {
  const app = buildFakeVault([])
  const diagnostic = vi.fn()
  const disk = new ObsidianFileSystem(app as never, { diagnostic })
  const write = vi.spyOn(app.vault.adapter, 'writeBinary')
  expect(
    await disk.conditionalFile({
      path: 'sample.md',
      expected: null,
      effect: { kind: 'write', bytes: new Uint8Array([1]), mtime: 1000, receipt: 'sample-receipt' },
    })
  ).toBe(true)
  expect(write).toHaveBeenCalledTimes(1)
  await disk.discardInstallation('sample-receipt')
  expect(diagnostic.mock.calls.filter(([operation]) => operation === 'journal save')).toHaveLength(
    2
  )
  expect(await app.vault.adapter.exists('sample.md')).toBe(true)
})

it('does not overwrite an independently occupied receipt data path', async () => {
  const app = buildFakeVault([])
  const path = '.obsidian/plugins/abele/sync-staging/.abele-receipt-sample-receipt.tmp'
  await app.vault.adapter.mkdir(path.slice(0, path.lastIndexOf('/')))
  await app.vault.adapter.write(path, 'independent bytes')
  const disk = new ObsidianFileSystem(app as never)
  await expect(
    disk.conditionalFile({
      path: 'sample.md',
      expected: null,
      effect: { kind: 'write', bytes: new Uint8Array([1]), mtime: 1000, receipt: 'sample-receipt' },
    })
  ).rejects.toThrow('retained evidence')
  expect(await app.vault.adapter.read(path)).toBe('independent bytes')
})

it('keeps an uncertain receipt retry quiet without replaying it over a later save', async () => {
  const app = buildFakeVault([]),
    disk = new ObsidianFileSystem(app as never)
  const operation = {
    path: 'sample.md',
    expected: null,
    effect: {
      kind: 'write' as const,
      bytes: new Uint8Array([1]),
      mtime: 1000,
      receipt: 'sample-retry',
    },
  }
  expect(await disk.conditionalFile(operation)).toBe(true)
  await app.vault.adapter.write('sample.md', 'later local save')
  expect(await disk.conditionalFile(operation)).toBe(false)
  expect(await app.vault.adapter.read('sample.md')).toBe('later local save')
})

it('propagates a lost publication acknowledgement and keeps its exact journal', async () => {
  const app = buildFakeVault([]),
    disk = new ObsidianFileSystem(app as never)
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  const failure = Object.assign(new Error('acknowledgement lost'), { code: 'EIO' })
  app.vault.adapter.rename = async (from, to) => {
    await rename(from, to)
    throw failure
  }
  await expect(
    disk.conditionalFile({
      path: 'sample.md',
      expected: null,
      effect: {
        kind: 'write',
        bytes: new Uint8Array([1]),
        mtime: 1000,
        receipt: 'sample-uncertain',
      },
    })
  ).rejects.toBe(failure)
  expect(await new WriteJournal(app).currentEntries()).toHaveLength(1)
  expect(await app.vault.adapter.exists('sample.md')).toBe(true)
})

it.each(['write', 'stage', 'respell'] as const)(
  'refuses legacy %s publication when the conditional port refuses',
  async (kind) => {
    const app = buildFakeVault([])
    const disk = app.vault.adapter
    await disk.writeBinary('sample.md', new TextEncoder().encode('before').buffer, { mtime: 1000 })
    const conditionalFile = vi.fn(async () => false)
    const writer = new VaultWriter({
      conditionalFile,
      stagingDirectory: '.staging',
      filesystem: disk as never,
      native: null,
      journal: new WriteJournal(null),
      indexed: () => false,
      makeParents: async () => {},
      fingerprint: async () => ({ size: 6, sha: 'a'.repeat(64) }),
    })
    const operation =
      kind === 'write'
        ? () =>
            writer.write(
              'sample.md',
              new Uint8Array([1]),
              2000,
              true,
              new TextEncoder().encode('before').buffer
            )
        : kind === 'stage'
          ? () =>
              writer.publishStage({
                target: 'sample.md',
                temp: '.staging/sample.tmp',
                streaming: { mtime: 2000, base: null, sealed: { size: 1, sha: 'b'.repeat(64) } },
              })
          : () => writer.respell('sample.md', 'Sample.md', async () => true)
    await expect(operation()).rejects.toMatchObject({ code: 'conflict' })
    expect(conditionalFile).toHaveBeenCalledOnce()
    expect(await disk.read('sample.md')).toBe('before')
  }
)

it('does not restore a legacy backup through an unconditional rename', async () => {
  const app = buildFakeVault([]),
    disk = app.vault.adapter
  await disk.writeBinary('.abele-sync-abcd1234.old', new Uint8Array([1]).buffer)
  const values = new Map<string, unknown>()
  const journal = new WriteJournal({
    loadLocalStorage: (key) => values.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      values.set(key, value)
    },
  })
  const entry = { target: 'sample.md', backup: '.abele-sync-abcd1234.old' }
  await journal.persist(() => journal.add(entry))
  const conditionalFile = vi.fn(async () => false)
  const writer = new VaultWriter({
    conditionalFile,
    stagingDirectory: '.staging',
    filesystem: disk as never,
    native: null,
    journal,
    indexed: () => false,
    makeParents: async () => {},
    fingerprint: async () => ({ size: 1, sha: 'a'.repeat(64) }),
  })
  await expect(writer.recover()).rejects.toThrow('cannot recover')
  expect(conditionalFile).toHaveBeenCalledOnce()
  expect(await disk.exists(entry.backup)).toBe(true)
  expect(await disk.exists(entry.target)).toBe(false)
  expect(await journal.currentEntries()).toEqual([entry])
})

it.each(['temp', 'backup'] as const)(
  'refuses an unproven public %s locator in legacy recovery',
  async (field) => {
    const app = buildFakeVault([]),
      disk = app.vault.adapter
    await disk.write('sample.md', 'independent local bytes')
    const journal = new WriteJournal(app)
    const entry = { target: 'other.md', [field]: 'sample.md' }
    await journal.persist(() => journal.add(entry))
    const conditionalFile = vi.fn(async () => false)
    const writer = new VaultWriter({
      conditionalFile,
      stagingDirectory: '.staging',
      filesystem: disk as never,
      native: null,
      journal,
      indexed: () => false,
      makeParents: async () => {},
      fingerprint: async () => ({ size: 23, sha: 'a'.repeat(64) }),
    })
    await expect(writer.recover()).rejects.toThrow('private artifact')
    expect(conditionalFile).not.toHaveBeenCalled()
    expect(await disk.read('sample.md')).toBe('independent local bytes')
    expect(await journal.currentEntries()).toEqual([entry])
  }
)
