import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  scan,
  sha256,
  applyStaged,
  ExpectedWrites,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { reconciliationScan } from '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
import { ExternalRepresentation } from '@/sync/external/representation'
import {
  projectionInspectionIdentity,
  trustedProjectionInspectionReason,
  type InspectionEntry,
} from '@/sync/external/inspectionIdentity'
import { readIgnore } from '@/sync/scope'

it('reports the exact indexed identity mismatch without probing the disk', () => {
  const path = 'sample.md'
  const app = buildFakeVault([{ path, content: 'sample', mtime: 1000, ctime: 100 }])
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const prior = { size: 6, mtime: 1000, ctime: 100 }
  const stat = app.vault.getFileByPath(path)!.stat
  expect(trustedProjectionInspectionReason(app as never, path, prior)).toBe('hit')
  stat.ctime = 101
  expect(trustedProjectionInspectionReason(app as never, path, prior)).toBe('ctime-mismatch')
  stat.ctime = 100
  stat.mtime = 2000
  expect(trustedProjectionInspectionReason(app as never, path, prior)).toBe('mtime-mismatch')
  stat.mtime = 1000
  stat.size = 7
  expect(trustedProjectionInspectionReason(app as never, path, prior)).toBe('size-mismatch')
})

it.each([true, false])(
  'upgrades legacy classification, reuses restart and rereads replacement, native=%s',
  async (native) => {
    const path = 'sample.md'
    const app = buildFakeVault([{ path, content: 'first', mtime: 1000, ctime: 100 }])
    if (native) withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as never)
    const read = vi.spyOn(fs, 'readPrefix')
    let entries: readonly InspectionEntry[] = [{ path, size: 5, mtime: 1000, marker: false }]
    const open = () =>
      ExternalRepresentation.open({
        state: null,
        emptyView: {
          ledgerId: 'sample-ledger',
          binding: {
            endpoint: 'https://sync.example.invalid',
            vaultId: 'sample-vault',
            mode: 'personal',
            principalId: 'sample-device',
            principalType: 'device',
            grantId: null,
            generation: 1,
            credentialAssociation: 'sample-slot',
          },
        },
        ledger: new MemoryStateStore(),
        fs,
        assertOwned: () => {},
        scriptsFolder: () => 'Scripts',
        inspection: {
          entries,
          identity: (path, prior) => projectionInspectionIdentity(app as never, path, prior),
          save: (updated) => {
            entries = updated
          },
        },
        verify: async () => {
          throw new Error('unexpected verification')
        },
        installProjection: async () => {
          throw new Error('unexpected projection')
        },
      })
    const first = await open()
    for await (const _ of first.fileSystem().list()) {
      /* persist inspection */
    }
    expect(read).toHaveBeenCalledTimes(1)
    const restarted = await open()
    for await (const _ of restarted.fileSystem().list()) {
      /* reuse inspection */
    }
    expect(read).toHaveBeenCalledTimes(1)
    await app.vault.adapter.remove(path)
    await app.vault.adapter.write(path, 'other', { mtime: 1000, ctime: 200 })
    expect(await restarted.classify(path)).toEqual({ kind: 'ordinary' })
    expect(read).toHaveBeenCalledTimes(2)
  }
)

it('reuses unchanged ignore rules after restart and rereads an identity-only replacement', async () => {
  const path = '.abele-sync-ignore'
  const app = buildFakeVault([{ path, content: 'first', mtime: 1000 }])
  withDesktopFs(app)
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  expect(await readIgnore(app as never)).toBe('first')
  expect(await readIgnore(app as never)).toBe('first')
  expect(read).toHaveBeenCalledTimes(1)
  await app.vault.adapter.remove(path)
  await app.vault.adapter.write(path, 'other', { mtime: 1000 })
  expect(await readIgnore(app as never)).toBe('other')
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not reuse a byte classification without native identity or portable creation time', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'first', mtime: 1000 }])
  const indexed = app.vault.getFileByPath('sample.md')!
  Object.assign(indexed.stat, { ctime: undefined })
  const fs = new ObsidianFileSystem(app as never)
  const read = vi.spyOn(fs, 'readPrefix')
  const representation = await ExternalRepresentation.open({
    state: null,
    emptyView: {
      ledgerId: 'sample-ledger',
      binding: {
        endpoint: 'https://sync.example.invalid',
        vaultId: 'sample-vault',
        mode: 'personal',
        principalId: 'sample-device',
        principalType: 'device',
        grantId: null,
        generation: 1,
        credentialAssociation: 'sample-slot',
      },
    },
    ledger: new MemoryStateStore(),
    fs,
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
    inspection: {
      entries: [],
      identity: (path, prior) => projectionInspectionIdentity(app as never, path, prior),
      save: () => {},
    },
    verify: async () => {
      throw new Error('unexpected verification')
    },
    installProjection: async () => {
      throw new Error('unexpected projection')
    },
  })
  expect(await representation.classify('sample.md')).toEqual({ kind: 'ordinary' })
  expect(await representation.classify('sample.md')).toEqual({ kind: 'ordinary' })
  expect(read).toHaveBeenCalledTimes(2)
})

it.each([false, 'stat', 'object'] as const)(
  'restarts a synced vault without content reads, changed=%s',
  async (changed) => {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'baseline bytes', mtime: 1000 }])
    withDesktopFs(app)
    const state = new MemoryStateStore()
    const filter = { excluded: () => false }
    const original = new ObsidianFileSystem(app as never)
    await scan(original, state, filter)
    await state.put({
      path: 'sample.bin',
      wirePath: 'sample.bin',
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: await sha256(new TextEncoder().encode('baseline bytes')),
      size: 14,
      mtime: 1000,
    })
    if (changed === 'object') await app.vault.adapter.remove('sample.bin')
    if (changed)
      await app.vault.adapter.write('sample.bin', 'modified bytes', {
        mtime: changed === 'object' ? 1000 : 2000,
      })
    const restarted = new ObsidianFileSystem(app as never)
    const fingerprint = vi.spyOn(restarted, 'fingerprint')
    const result = await reconciliationScan(restarted, state, filter, 0)
    expect(fingerprint).toHaveBeenCalledTimes(changed ? 1 : 0)
    expect(result.found.dirty.has('sample.bin')).toBe(!!changed)
    if (changed) expect(result.found.ops).toContainEqual(expect.objectContaining({ op: 'modify' }))
  }
)

it('records the final identity and timestamp of a streamed pull before restart', async () => {
  const app = buildFakeVault([])
  withDesktopFs(app)
  const state = new MemoryStateStore()
  const bytes = new Uint8Array(1024 * 1024 + 17).fill(23)
  const sha = await sha256(bytes)
  const filter = { excluded: () => false }
  const client = {
    openVersion: async () => ({
      size: bytes.length,
      read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
      assertUnchanged: async () => {},
      close: async () => {},
    }),
  } as unknown as EngineClient
  await applyStaged(
    client,
    new ObsidianFileSystem(app as never),
    state,
    [
      {
        seq: 1,
        file_id: 'sample-file',
        version_id: 'sample-version',
        path: 'sample.bin',
        prev_path: null,
        op: 'create',
        kind: 'attachment',
        sha,
        size: bytes.length,
        mtime: 1234,
        at: '',
        actor: { kind: 'system', id: 'sample', name: 'Sample' },
      },
    ],
    {
      filter,
      dirty: new Set(),
      expected: new ExpectedWrites(),
      prefetchBytes: 0,
    }
  )
  const restarted = new ObsidianFileSystem(app as never)
  const fingerprint = vi.spyOn(restarted, 'fingerprint')
  const result = await reconciliationScan(restarted, state, filter, 0)
  expect(fingerprint).not.toHaveBeenCalled()
  expect(result.found.dirty.size).toBe(0)
  expect((await state.get('sample.bin'))?.mtime).toBe((await restarted.stat('sample.bin'))?.mtime)
})
