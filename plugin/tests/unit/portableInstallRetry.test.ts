import { afterEach, expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { WriteJournal } from '@/sync/writeJournal'
import { requireExternalEnrollmentSafety } from '@/sync/external/pluginSafety'
import { buildFakeVault } from '../helpers/fakeVault'
import {
  applyStaged,
  ExpectedWrites,
  MemoryStateStore,
  recoverPendingPullWrites,
  sha256,
  EngineError,
} from '@abele/sync-sdk/core'

afterEach(() => vi.restoreAllMocks())
it('settles SDK pull intent and portable receipt after a failed installation and relaunch', async () => {
  const app = buildFakeVault([]),
    state = new MemoryStateStore()
  const path = 'Shared/sample.md',
    bytes = new TextEncoder().encode('sample server bytes')
  const change = {
    seq: 1,
    op: 'modify' as const,
    path,
    file_id: 'sample-file',
    version_id: 'sample-version',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1000,
    prev_path: null,
    kind: 'note' as const,
    at: '',
    actor: { kind: 'system' as const, id: 'sample', name: 'Sample' },
  }
  const client = {
    getBlob: async () => bytes,
    openVersion: async () => ({
      size: bytes.length,
      read: async (at: number, length: number) => bytes.slice(at, at + length),
      assertUnchanged: async () => {},
      close: async () => {},
    }),
  } as never
  const opts = {
    filter: { excluded: () => false },
    dirty: new Set<string>(),
    expected: new ExpectedWrites(),
  }
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  const cut = vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    if (to === path) throw new EngineError('offline', 'sample installation interruption')
    return rename(from, to)
  })
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  await expect(applyStaged(client, fs, state, [change], opts)).rejects.toThrow()
  cut.mockRestore()
  expect(await app.vault.adapter.exists(path)).toBe(false)
  expect(await new WriteJournal(app).currentEntries()).toHaveLength(1)
  const restarted = new ObsidianFileSystem(app as never, { ledger: state })
  await restarted.recover()
  await recoverPendingPullWrites(restarted, state, ['sample-file'], client)
  await applyStaged(client, restarted, state, [change], opts)
  const entry = await state.get(path)
  expect(entry?.versionId).toBe(change.version_id)
  await restarted.acknowledgeWrites([entry!])
  expect(await app.vault.adapter.read(path)).toBe('sample server bytes')
  expect(await new WriteJournal(app).currentEntries()).toEqual([])
  await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
})
it.each([false, true])(
  'resumes a portable receipt after interruption before publication (stage exists=%s)',
  async (written) => {
    const app = buildFakeVault([])
    const path = 'Shared/sample.md'
    const effect = {
      kind: 'write' as const,
      bytes: new TextEncoder().encode('sample incoming bytes'),
      mtime: 1000,
      receipt: 'sample-interrupted',
    }
    const first = new ObsidianFileSystem(app as never)
    const method = written ? 'rename' : 'writeBinary'
    const original = app.vault.adapter[method].bind(app.vault.adapter)
    const cut = vi
      .spyOn(app.vault.adapter, method)
      .mockImplementation(async (...args: unknown[]) => {
        if (
          (written && args[1] === path) ||
          (!written && String(args[0]).includes('.abele-receipt-'))
        )
          throw new Error('sample interrupted installation')
        return Reflect.apply(original, app.vault.adapter, args)
      })
    await expect(first.conditionalFile({ path, expected: null, effect })).rejects.toThrow(
      'sample interrupted installation'
    )
    cut.mockRestore()
    expect(await new WriteJournal(app).currentEntries()).toHaveLength(1)
    const restarted = new ObsidianFileSystem(app as never)
    await restarted.recover()
    await expect(restarted.conditionalFile({ path, expected: null, effect })).resolves.toBe(true)
    expect(await app.vault.adapter.read(path)).toBe('sample incoming bytes')
    await restarted.discardInstallation(effect.receipt)
    expect(await new WriteJournal(app).currentEntries()).toEqual([])
    await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
  }
)

it('keeps an independently modified private stage when retrying a portable receipt', async () => {
  const app = buildFakeVault([])
  const path = 'Shared/sample.md'
  const effect = {
    kind: 'write' as const,
    bytes: new TextEncoder().encode('incoming'),
    mtime: 1000,
    receipt: 'sample-changed',
  }
  const fs = new ObsidianFileSystem(app as never)
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  const cut = vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    if (to === path) throw new Error('sample cut')
    return rename(from, to)
  })
  await expect(fs.conditionalFile({ path, expected: null, effect })).rejects.toThrow('sample cut')
  cut.mockRestore()
  const [entry] = await new WriteJournal(app).currentEntries()
  await app.vault.adapter.write(entry.temp!, 'independent edit')
  const restarted = new ObsidianFileSystem(app as never)
  await expect(restarted.conditionalFile({ path, expected: null, effect })).resolves.toBe(false)
  expect(await app.vault.adapter.read(entry.temp!)).toBe('independent edit')
  expect(await app.vault.adapter.exists(path)).toBe(false)
  expect(await new WriteJournal(app).currentEntries()).toHaveLength(1)
})

it('does not replay an interrupted portable receipt over a newly created target', async () => {
  const app = buildFakeVault([])
  const path = 'Shared/sample.md'
  const effect = {
    kind: 'write' as const,
    bytes: new TextEncoder().encode('incoming'),
    mtime: 1000,
    receipt: 'sample-occupied',
  }
  const fs = new ObsidianFileSystem(app as never)
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  const cut = vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    if (to === path) throw new Error('sample cut')
    return rename(from, to)
  })
  await expect(fs.conditionalFile({ path, expected: null, effect })).rejects.toThrow('sample cut')
  cut.mockRestore()
  await app.vault.adapter.write(path, 'new local edit')
  const [entry] = await new WriteJournal(app).currentEntries()
  const restarted = new ObsidianFileSystem(app as never)
  await expect(restarted.conditionalFile({ path, expected: null, effect })).resolves.toBe(false)
  expect(await app.vault.adapter.read(path)).toBe('new local edit')
  expect(await app.vault.adapter.read(entry.temp!)).toBe('incoming')
  expect(await new WriteJournal(app).currentEntries()).toHaveLength(1)
})
