import { afterEach, expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
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
    // Staging failed before the rename boundary: no durable publication intent yet.
    expect(await new WriteJournal(app).currentEntries()).toHaveLength(written ? 1 : 0)
    const restarted = new ObsidianFileSystem(app as never)
    await restarted.recover()
    await expect(restarted.conditionalFile({ path, expected: null, effect })).resolves.toBe(true)
    expect(await app.vault.adapter.read(path)).toBe('sample incoming bytes')
    await restarted.discardInstallation(effect.receipt)
    expect(await new WriteJournal(app).currentEntries()).toEqual([])
    await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
  }
)

it('resumes an exact portable stage left before the publication intent was committed', async () => {
  const app = buildFakeVault([])
  const path = 'Shared/sample.md'
  const effect = {
    kind: 'write' as const,
    bytes: new TextEncoder().encode('sample incoming bytes'),
    mtime: 1000,
    receipt: 'sample-staged',
  }
  const first = new ObsidianFileSystem(app as never)
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  const cut = vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementation(async (...args) => {
    await write(...args)
    if (String(args[0]).includes('.abele-receipt-'))
      throw new Error('sample interruption after staging')
  })
  await expect(first.conditionalFile({ path, expected: null, effect })).rejects.toThrow(
    'sample interruption after staging'
  )
  cut.mockRestore()
  expect(await new WriteJournal(app).currentEntries()).toEqual([])
  const restarted = new ObsidianFileSystem(app as never)
  await restarted.recover()
  await expect(restarted.conditionalFile({ path, expected: null, effect })).resolves.toBe(true)
  expect(await app.vault.adapter.read(path)).toBe('sample incoming bytes')
})

it.each(['retry', 'discard'])(
  'recovers an interrupted multi-chunk portable stage on %s after restart',
  async (action) => {
    const app = buildFakeVault([])
    const path = 'Shared/sample-large.md'
    const receipt = 'sample-partial-stage'
    const bytes = new Uint8Array(MAX_CHUNK_BYTES + 17).fill(42)
    bytes[bytes.length - 1] = 43
    const effect = { kind: 'write' as const, bytes, mtime: 1000, receipt }
    const stage = `.obsidian/plugins/abele/sync-staging/.abele-receipt-${receipt}.tmp`
    Object.assign(app.vault.adapter, {
      appendBinary: async () => {
        throw new Error('sample interruption after first chunk')
      },
    })
    await expect(
      new ObsidianFileSystem(app as never).conditionalFile({ path, expected: null, effect })
    ).rejects.toThrow('sample interruption after first chunk')
    expect((await app.vault.adapter.readBinary(stage)).byteLength).toBe(MAX_CHUNK_BYTES)
    expect(await new WriteJournal(app).currentEntries()).toEqual([])
    Object.assign(app.vault.adapter, {
      appendBinary: async (at: string, chunk: ArrayBuffer) => {
        const before = new Uint8Array(await app.vault.adapter.readBinary(at))
        const combined = new Uint8Array(before.length + chunk.byteLength)
        combined.set(before)
        combined.set(new Uint8Array(chunk), before.length)
        await app.vault.adapter.writeBinary(at, combined.buffer)
      },
    })
    const restarted = new ObsidianFileSystem(app as never)
    await restarted.recover()
    if (action === 'retry') {
      await expect(restarted.conditionalFile({ path, expected: null, effect })).resolves.toBe(true)
      expect(new Uint8Array(await app.vault.adapter.readBinary(path))).toEqual(bytes)
      expect(await app.vault.adapter.exists(stage)).toBe(false)
    } else {
      await restarted.discardInstallation(receipt)
      expect(await app.vault.adapter.exists(stage)).toBe(false)
      expect(await app.vault.adapter.exists(path)).toBe(false)
    }
  },
  15_000
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
