import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExternalState } from '@/sync/external/state'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { AttachmentStore } from '@/sync/external/attachmentStore'
import { requireExternalLifecycleSafety } from '@/sync/external/pluginSafety'
import { EXTERNAL_ACTIVATION_KEY } from '@/sync/external/recovery'
import { buildFakeVault } from '../helpers/fakeVault'

const path = 'Media/sample-image.bin'
const content = new TextEncoder().encode('sample attachment bytes')
const binding = {
  endpoint: 'https://sync.example.invalid',
  vaultId: 'sample-vault',
  mode: 'personal' as const,
  principalId: 'sample-device',
  principalType: 'device' as const,
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-slot',
}

async function setup(mode: 'personal' | 'scoped' = 'personal') {
  const identity =
    mode === 'personal'
      ? binding
      : {
          ...binding,
          mode: 'scoped' as const,
          principalType: 'installation' as const,
          principalId: 'sample-reader',
          grantId: 'sample-grant',
        }
  const factory = new IDBFactory(),
    database = crypto.randomUUID()
  const store = await IndexedDbStateStore.open(factory, database)
  const state = await ExternalState.open(store, 'sample-ledger', identity)
  const fake = buildFakeVault([{ path, content: 'sample attachment bytes' }])
  ;(
    fake.workspace as unknown as { iterateAllLeaves(fn: (leaf: unknown) => void): void }
  ).iterateAllLeaves = () => {}
  const host = new ExternalFileHost(fake as unknown as App, {
    platform: 'mobile',
    assertOwned: () => {},
  })
  const base = {
    fileId: 'sample-file',
    versionId: 'sample-v1',
    path,
    sha: await sha256(content),
    size: content.length,
    mtime: 1000,
  }
  await store.put({
    path,
    wirePath: path,
    fileId: base.fileId,
    versionId: base.versionId,
    sha: base.sha,
    size: base.size,
    mtime: base.mtime,
  })
  const verify = vi.fn(
    async (
      fileId: string,
      request: { version_id: string; path: string; sha: string; size: number }
    ) => ({ file_id: fileId, ...request, verified: true as const })
  )
  const download = vi.fn(async () => content)
  let consent: string | null = null
  const sync = vi.fn<() => Promise<unknown>>(async () => {})
  const api = new AttachmentStore({
    state,
    ledger: store,
    host,
    binding: identity,
    verify,
    download,
    scopedHead: async (fileId) => ({
      file_id: fileId,
      version_id: base.versionId,
      path,
      sha: base.sha,
      size: base.size,
      mtime: base.mtime,
    }),
    consent: {
      read: async () => consent,
      write: async (value) => {
        consent = value
      },
    },
    sync,
    serial: { run: async <T>(work: () => Promise<T>) => work() },
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
  })
  return {
    api,
    factory,
    database,
    store,
    state,
    fake,
    host,
    verify,
    download,
    sync,
    base,
    close: () => {
      host.close()
      store.close()
    },
  }
}

describe('disconnect materialization', () => {
  it('includes acknowledged desktop staging links in readiness without deleting them', async () => {
    const s = await setup()
    try {
      s.fake.saveLocalStorage(EXTERNAL_ACTIVATION_KEY, {
        schema: 1,
        ledgers: [
          {
            ledgerId: 'sample-ledger',
            databaseName: s.database,
            databaseIdentity: s.store.databaseIdentity,
            binding,
            phase: 'active',
          },
        ],
      })
      await s.api.evict(s.base.fileId, {
        operationId: 'sample-offload',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      const artifact = (await s.state.snapshot()).operations[0].ownedArtifacts[0]
      const sidecar = await s.fake.vault.adapter.readBinary(path + '.abele-ref')
      await s.fake.vault.adapter.writeBinary(artifact.path, sidecar)
      expect(
        (await s.api.materializeForDisconnect({ operationId: 'sample-departure' })).status
      ).toBe('complete')
      await expect(
        requireExternalLifecycleSafety(s.fake as unknown as App, s.factory)
      ).resolves.toBeUndefined()
      expect(await s.fake.vault.adapter.exists(artifact.path)).toBe(true)
      await s.fake.vault.adapter.write(artifact.path, 'sample changed retained artifact')
      expect(await s.api.inspectDisconnect()).toMatchObject({ safe: false })
    } finally {
      s.close()
    }
  })
  it('permits departure only after committed readiness and rechecks local bytes', async () => {
    const s = await setup()
    try {
      s.fake.saveLocalStorage(EXTERNAL_ACTIVATION_KEY, {
        schema: 1,
        ledgers: [
          {
            ledgerId: 'sample-ledger',
            databaseName: s.database,
            databaseIdentity: s.store.databaseIdentity,
            binding,
            phase: 'active',
          },
        ],
      })
      await s.api.evict(s.base.fileId, {
        operationId: 'sample-offload',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      await expect(
        requireExternalLifecycleSafety(s.fake as unknown as App, s.factory)
      ).rejects.toThrow(/external/i)
      await s.api.materializeForDisconnect({ operationId: 'sample-departure' })
      await expect(
        requireExternalLifecycleSafety(s.fake as unknown as App, s.factory)
      ).resolves.toBeUndefined()
      await s.fake.vault.adapter.write(path, 'sample outside edit')
      await expect(
        requireExternalLifecycleSafety(s.fake as unknown as App, s.factory)
      ).rejects.toThrow(/external/i)
    } finally {
      s.close()
    }
  })
  it('persists preparation, installs originals and reopens ready without discarding recovery bytes', async () => {
    const s = await setup()
    try {
      await s.api.evict(s.base.fileId, {
        operationId: 'sample-offload',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      expect(await s.api.inspectDisconnect()).toMatchObject({
        safe: false,
        requiredBytes: content.length,
      })
      expect(
        (await s.api.materializeForDisconnect({ operationId: 'sample-departure' })).status
      ).toBe('complete')
      expect(new Uint8Array(await s.fake.vault.adapter.readBinary(path))).toEqual(content)
      expect((await s.state.snapshot()).operations.at(-1)?.phase).toBe('hydrated')
      const reopened = await restart(s)
      try {
        expect(await reopened.api.inspectDisconnect()).toMatchObject({
          safe: true,
          requiredBytes: 0,
        })
        expect((await reopened.state.snapshot()).files[0].retained.length).toBeGreaterThan(0)
        expect(
          (
            await reopened.api.evict(s.base.fileId, {
              operationId: 'sample-late-eviction',
              expectedRevision: 6,
              expectedVersionId: s.base.versionId,
            })
          ).status
        ).toBe('busy')
      } finally {
        reopened.close()
      }
    } finally {
      s.close()
    }
  })

  it.each(['offline', 'no-space', 'version-changed', 'approval-required', 'unavailable'])(
    'keeps dependencies when preparation fails with %s',
    async (reason) => {
      const s = await setup()
      try {
        await s.api.evict(s.base.fileId, {
          operationId: 'sample-offload',
          expectedRevision: 0,
          expectedVersionId: s.base.versionId,
        })
        vi.spyOn(s.api, 'hydrate').mockResolvedValueOnce({
          status: reason as any,
          reclaimedBytes: 0,
        })
        expect(
          (await s.api.materializeForDisconnect({ operationId: 'sample-departure' })).status
        ).toBe(reason)
        expect((await s.state.snapshot()).files[0].representation).toBe('remote-only')
        expect(await s.api.inspectDisconnect()).toMatchObject({ safe: false })
        expect(await s.fake.vault.adapter.exists(path + '.abele-ref')).toBe(true)
      } finally {
        s.close()
      }
    }
  )

  it.each(['deleted', 'detached', 'unavailable'] as const)(
    'retains unresolved %s files in preparation inventory',
    async (availability) => {
      const s = await setup()
      try {
        await s.api.evict(s.base.fileId, {
          operationId: 'sample-offload',
          expectedRevision: 0,
          expectedVersionId: s.base.versionId,
        })
        const doc = await s.state.snapshot(),
          file = doc.files[0]
        await s.state.commit({
          expectedRevision: doc.revision,
          files: [
            {
              expectedRevision: file.localRevision,
              next: { ...file, localRevision: file.localRevision + 1, availability },
            },
          ],
        })
        expect(
          (await s.api.materializeForDisconnect({ operationId: 'sample-departure' })).status
        ).toBe('unavailable')
        expect((await s.state.snapshot()).files[0].availability).toBe(availability)
        expect(await s.api.inspectDisconnect()).toMatchObject({ safe: false })
        expect(s.download).not.toHaveBeenCalled()
      } finally {
        s.close()
      }
    }
  )
})

async function restart(s: Awaited<ReturnType<typeof setup>>) {
  s.close()
  const store = await IndexedDbStateStore.open(s.factory, s.database)
  const state = await ExternalState.open(store, 'sample-ledger', binding)
  const host = new ExternalFileHost(s.fake as unknown as App, {
    platform: 'mobile',
    assertOwned: () => {},
  })
  const api = new AttachmentStore({
    state,
    ledger: store,
    host,
    binding,
    verify: s.verify,
    download: s.download,
    sync: s.sync,
    serial: { run: async <T>(job: () => Promise<T>) => job() },
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
  })
  return {
    api,
    state,
    store,
    close: () => {
      host.close()
      store.close()
    },
  }
}

describe('manual attachment store', () => {
  it('verifies before sidecar changes, evicts, and hydrates the same bytes', async () => {
    const s = await setup()
    try {
      const result = await s.api.evict(s.base.fileId, {
        operationId: 'sample-evict',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      expect(result).toMatchObject({ status: 'complete', reclaimedBytes: content.length })
      expect(await s.fake.vault.adapter.exists(path)).toBe(false)
      expect(await s.fake.vault.adapter.exists(path + '.abele-ref')).toBe(true)
      expect(s.verify).toHaveBeenCalledOnce()
      const restored = await s.api.hydrate(s.base.fileId, {
        operationId: 'sample-hydrate',
        expectedVersionId: s.base.versionId,
      })
      expect(restored.status).toBe('complete')
      expect(await s.fake.vault.adapter.exists(path + '.abele-ref')).toBe(false)
      expect(new Uint8Array(await s.fake.vault.adapter.readBinary(path))).toEqual(content)
      expect((await s.state.snapshot()).files[0]).toMatchObject({
        representation: 'hydrated',
        pendingOperationId: null,
        projectionPath: null,
      })
    } finally {
      s.close()
    }
  })
  it('hydrates but preserves a changed or foreign placeholder as held cleanup', async () => {
    const s = await setup()
    try {
      await s.api.evict(s.base.fileId, {
        operationId: 'sample-evict',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      const changed = new TextEncoder().encode('sample foreign sidecar')
      await s.fake.vault.adapter.writeBinary(path + '.abele-ref', changed.buffer)
      expect(
        (
          await s.api.hydrate(s.base.fileId, {
            operationId: 'sample-hydrate',
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('cleanup-pending')
      expect(new Uint8Array(await s.fake.vault.adapter.readBinary(path + '.abele-ref'))).toEqual(
        changed
      )
      expect((await s.state.snapshot()).files[0].pendingOperationId).toBe('sample-hydrate')
    } finally {
      s.close()
    }
  })

  it('rejects server failure without creating a projection or removing the original', async () => {
    const s = await setup()
    try {
      s.verify.mockRejectedValueOnce(Error('offline'))
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-offline',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('offline')
      expect(await s.fake.vault.adapter.exists(path)).toBe(true)
      expect(await s.fake.vault.adapter.exists(path + '.abele-ref')).toBe(false)
    } finally {
      s.close()
    }
  })
  it('keeps original after cancellation at prepared, and never retries its first sidecar mutation', async () => {
    const s = await setup()
    try {
      const abort = new AbortController()
      const commit = s.state.commit.bind(s.state)
      vi.spyOn(s.state, 'commit').mockImplementation(async (change) => {
        const result = await commit(change)
        if (change.operations?.[0]?.next?.phase === 'prepared') abort.abort()
        return result
      })
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-cancel',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
            signal: abort.signal,
          })
        ).status
      ).toBe('recovery-required')
      expect(await s.fake.vault.adapter.exists(path)).toBe(true)
      expect((await s.api.recover()).pending).toBe(1)
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-cancel',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('recovery-required')
    } finally {
      s.close()
    }
  })

  it('holds a failed delete outcome, and retry never deletes a reappeared original', async () => {
    const s = await setup()
    try {
      const remove = vi
        .spyOn(s.fake.vault.adapter, 'remove')
        .mockRejectedValueOnce(Error('uncertain'))
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-uncertain',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('recovery-required')
      expect(await s.fake.vault.adapter.exists(path)).toBe(true)
      expect((await s.api.recover()).pending).toBe(1)
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-uncertain',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('recovery-required')
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      s.close()
    }
  })

  it('does not overwrite an occupied hydration destination, even with identical bytes', async () => {
    const s = await setup()
    try {
      await s.api.evict(s.base.fileId, {
        operationId: 'sample-e1',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      await s.fake.vault.adapter.writeBinary(path, content.buffer as ArrayBuffer)
      expect(
        (
          await s.api.hydrate(s.base.fileId, {
            operationId: 'sample-h1',
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('collision')
      expect(new Uint8Array(await s.fake.vault.adapter.readBinary(path))).toEqual(content)
      expect(s.download).not.toHaveBeenCalled()
    } finally {
      s.close()
    }
  })

  it.each([
    ...['prepared', 'delete-ready', 'remote-only'].flatMap((phase) =>
      ['before', 'after'].map((edge) => ({ kind: 'eviction', boundary: phase, edge }))
    ),
    ...['download-intent', 'ready-to-install', 'cleanup-pending', 'hydrated'].flatMap((phase) =>
      ['before', 'after'].map((edge) => ({ kind: 'hydration', boundary: phase, edge }))
    ),
    ...['eviction', 'hydration'].flatMap((kind) =>
      ['stage', 'install', ...(kind === 'eviction' ? ['delete'] : ['retire'])].flatMap((boundary) =>
        ['before', 'after'].map((edge) => ({ kind, boundary, edge }))
      )
    ),
  ])(
    'reopens safely after $kind $edge $boundary without blind mutation replay',
    async ({ kind, boundary, edge }) => {
      const s = await setup()
      try {
        if (kind === 'hydration')
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-base',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        const operationId = 'sample-terminated'
        const commit = s.state.commit.bind(s.state)
        let hit = false,
          mutations = 0
        const crash = () => {
          hit = true
          throw Error('sample terminated')
        }
        vi.spyOn(s.state, 'commit').mockImplementation(async (change) => {
          const selected = change.operations?.[0]?.next?.phase === boundary
          if (selected && edge === 'before') crash()
          const result = await commit(change)
          if (selected && edge === 'after') crash()
          return result
        })
        const adapter = s.fake.vault.adapter
        for (const method of ['writeBinary', 'rename', 'remove'] as const) {
          const original = adapter[method].bind(adapter) as (...args: any[]) => Promise<void>
          vi.spyOn(adapter, method).mockImplementation(async (...args: any[]) => {
            const selected =
              (boundary === 'stage' && method === 'writeBinary') ||
              (boundary === 'install' && method === 'rename' && args[0].endsWith('.incoming')) ||
              (boundary === 'delete' && method === 'remove' && args[0] === path) ||
              (boundary === 'retire' && method === 'rename' && args[0] === path + '.abele-ref')
            if (selected && edge === 'before') crash()
            mutations++
            await original(...args)
            if (selected && edge === 'after') crash()
          })
        }
        try {
          const result =
            kind === 'eviction'
              ? await s.api.evict(s.base.fileId, {
                  operationId,
                  expectedRevision: 0,
                  expectedVersionId: s.base.versionId,
                })
              : await s.api.hydrate(s.base.fileId, {
                  operationId,
                  expectedVersionId: s.base.versionId,
                })
          expect(result.reclaimedBytes).toBe(0)
        } catch (error) {
          expect(String(error)).toContain('terminated')
        }
        expect(hit).toBe(true)
        const count = mutations
        const restarted = await restart(s)
        try {
          await restarted.api.recover()
          const doc = await restarted.state.snapshot()
          if (doc.operations.some((op) => op.operationId === operationId)) {
            if (kind === 'eviction')
              await restarted.api.evict(s.base.fileId, {
                operationId,
                expectedRevision: 0,
                expectedVersionId: s.base.versionId,
              })
            else
              await restarted.api.hydrate(s.base.fileId, {
                operationId,
                expectedVersionId: s.base.versionId,
              })
          }
          expect(mutations).toBe(count)
          if (await adapter.exists(path))
            expect(new Uint8Array(await adapter.readBinary(path))).toEqual(content)
          else expect(await adapter.exists(path + '.abele-ref')).toBe(true)
        } finally {
          restarted.close()
        }
      } finally {
        vi.restoreAllMocks()
        s.close()
      }
    }
  )

  it('holds each interrupted eviction phase without deleting again on restart', async () => {
    for (const phase of ['prepared', 'delete-ready', 'remote-only'] as const) {
      const s = await setup()
      try {
        const commit = s.state.commit.bind(s.state)
        vi.spyOn(s.state, 'commit').mockImplementation(async (change) => {
          const answer = await commit(change)
          if (change.operations?.[0]?.next?.phase === phase) throw Error('sample terminated')
          return answer
        })
        await expect(
          s.api.evict(s.base.fileId, {
            operationId: 'sample-interrupted',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).rejects.toThrow('terminated')
        const saved = (await s.state.snapshot()).operations[0]
        expect(saved.phase).toBe(phase)
        const recovered = await ExternalState.open(s.store, 'sample-ledger', binding)
        const next = new AttachmentStore({
          state: recovered,
          ledger: s.store,
          host: s.host,
          binding,
          verify: s.verify,
          download: s.download,
          sync: async () => {},
          serial: { run: async <T>(work: () => Promise<T>) => work() },
          assertOwned: () => {},
          scriptsFolder: () => 'Scripts',
        })
        await next.recover()
        expect(await s.fake.vault.adapter.exists(path)).toBe(phase !== 'remote-only')
        expect((await recovered.snapshot()).files[0].representation).toBe(
          phase === 'remote-only' ? 'remote-only' : 'hydrated'
        )
      } finally {
        s.close()
      }
    }
  })

  it('finishes bookkeeping after a terminated delete acknowledgement, without replaying delete', async () => {
    const s = await setup()
    try {
      const remove = s.fake.vault.adapter.remove.bind(s.fake.vault.adapter)
      const intercepted = vi
        .spyOn(s.fake.vault.adapter, 'remove')
        .mockImplementationOnce(async (target) => {
          await remove(target)
          throw Error('sample lost acknowledgement')
        })
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-lost-delete',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('recovery-required')
      expect((await s.state.snapshot()).operations[0].phase).toBe('delete-ready')
      expect(await s.fake.vault.adapter.exists(path)).toBe(false)
      await s.api.recover()
      expect((await s.state.snapshot()).files[0].representation).toBe('remote-only')
      expect(
        await s.api.evict(s.base.fileId, {
          operationId: 'sample-lost-delete',
          expectedRevision: 0,
          expectedVersionId: s.base.versionId,
        })
      ).toEqual({ status: 'complete', reclaimedBytes: 0 })
      expect(intercepted).toHaveBeenCalledOnce()
    } finally {
      s.close()
    }
  })

  it('settles interrupted projection retirement from committed installation evidence after reopening', async () => {
    const s = await setup()
    try {
      await s.api.evict(s.base.fileId, {
        operationId: 'sample-evict',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      })
      const rename = s.fake.vault.adapter.rename.bind(s.fake.vault.adapter)
      vi.spyOn(s.fake.vault.adapter, 'rename').mockImplementation(async (from, to) => {
        await rename(from, to)
        if (from === path + '.abele-ref') throw Error('sample lost retirement acknowledgement')
      })
      expect(
        (
          await s.api.hydrate(s.base.fileId, {
            operationId: 'sample-hydrate',
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('cleanup-pending')
      const restarted = await restart(s)
      try {
        expect((await restarted.api.recover()).pending).toBe(0)
        expect((await restarted.api.get(s.base.fileId))?.representation).toBe('hydrated')
        expect(new Uint8Array(await s.fake.vault.adapter.readBinary(path))).toEqual(content)
      } finally {
        restarted.close()
      }
    } finally {
      s.close()
    }
  })

  it('rejects altered and truncated downloaded versions without installing an original', async () => {
    for (const received of [
      new TextEncoder().encode('sample wrong contents'),
      content.subarray(0, 2),
    ]) {
      const s = await setup()
      try {
        await s.api.evict(s.base.fileId, {
          operationId: 'sample-offload',
          expectedRevision: 0,
          expectedVersionId: s.base.versionId,
        })
        s.download.mockResolvedValueOnce(received)
        expect(
          (
            await s.api.hydrate(s.base.fileId, {
              operationId: 'sample-fetch',
              expectedVersionId: s.base.versionId,
            })
          ).status
        ).toBe('version-changed')
        expect(await s.fake.vault.adapter.exists(path)).toBe(false)
        expect((await s.state.snapshot()).operations.at(-1)?.phase).toBe('download-intent')
      } finally {
        s.close()
      }
    }
  })

  it('keeps a use lease for the full verified read, blocking a concurrent eviction', async () => {
    const s = await setup()
    try {
      await s.api.setPinned(s.base.fileId, false)
      let finish!: (bytes: Uint8Array) => void
      const waiting = new Promise<Uint8Array>((resolve) => {
        finish = resolve
      })
      const readBinary = s.fake.vault.adapter.readBinary.bind(s.fake.vault.adapter)
      vi.spyOn(s.fake.vault.adapter, 'readBinary').mockImplementation(async (target) => {
        if (target === path) return (await waiting).buffer as ArrayBuffer
        return readBinary(target)
      })
      const reading = s.api.read(s.base.fileId, { expectedVersionId: s.base.versionId })
      await Promise.resolve()
      let reserved = false
      try {
        const ticket = s.host.coordination.reserve({
          operationId: 'sample-read-race',
          fileId: s.base.fileId,
          paths: [path],
        })
        reserved = true
        ticket.release()
      } catch {
        /* The active read must block reservation. */
      }
      finish(content)
      expect(await reading).toMatchObject({ versionId: s.base.versionId, bytes: content })
      expect(reserved).toBe(false)
    } finally {
      s.close()
    }
  })

  it('does not report reclaimed content bytes while a full retained copy still exists', async () => {
    const s = await setup()
    try {
      await s.api.setPinned(s.base.fileId, false)
      const doc = await s.state.snapshot(),
        file = doc.files[0]
      const retained = {
        path: 'Media/.abele-external-sample-retained.incoming',
        sha: s.base.sha,
        size: content.length,
        role: 'retained' as const,
        operationId: 'sample-retained',
      }
      await s.fake.vault.adapter.writeBinary(retained.path, content.buffer as ArrayBuffer)
      await s.state.commit({
        expectedRevision: doc.revision,
        files: [
          {
            expectedRevision: file.localRevision,
            next: {
              ...file,
              localRevision: file.localRevision + 1,
              retained: [retained],
            },
          },
        ],
      })
      const request = {
        operationId: 'sample-retained-evict',
        expectedRevision: file.localRevision + 1,
        expectedVersionId: s.base.versionId,
      }
      expect(await s.api.evict(s.base.fileId, request)).toEqual({
        status: 'complete',
        reclaimedBytes: 0,
      })
      expect(await s.api.evict(s.base.fileId, request)).toEqual({
        status: 'complete',
        reclaimedBytes: 0,
      })
      expect(new Uint8Array(await s.fake.vault.adapter.readBinary(retained.path))).toEqual(content)
    } finally {
      s.close()
    }
  })

  it('pins against eviction and serializes an active use lease', async () => {
    const s = await setup()
    try {
      expect((await s.api.setPinned(s.base.fileId, true)).status).toBe('complete')
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-pinned',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('pinned')
      const lease = s.api.acquireUse(s.base.fileId)
      await expect(
        s.api.evict(s.base.fileId, {
          operationId: 'sample-leased',
          expectedRevision: 0,
          expectedVersionId: s.base.versionId,
        })
      ).rejects.toThrow('busy')
      lease.release()
    } finally {
      s.close()
    }
  })

  it('an unpublished edit can publish before eviction without losing its expected-version intent', async () => {
    const s = await setup()
    try {
      const modified = new TextEncoder().encode('sample changed attachment')
      await s.fake.vault.adapter.writeBinary(path, modified.buffer as ArrayBuffer)
      const head = {
        ...s.base,
        versionId: 'sample-v2',
        sha: await sha256(modified),
        size: modified.length,
      }
      const publish = s.sync.mockImplementation(async () => {
        await s.store.put({ ...head, wirePath: path })
        return {
          published: [
            {
              file_id: head.fileId,
              version_id: head.versionId,
              path,
              sha: head.sha,
              size: head.size,
            },
          ],
        }
      })
      // Simulate ordinary publication completing before the engine's exclusive attachment job.
      // A version selected before publication cannot silently switch to an unrelated live head.
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-publish',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('complete')
      expect(publish).toHaveBeenCalledOnce()
      expect(await s.fake.vault.adapter.exists(path)).toBe(false)
      expect((await s.state.snapshot()).operations[0].expected?.versionId).toBe('sample-v2')
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-publish',
            expectedRevision: 0,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('complete')
      expect(
        (
          await s.api.evict(s.base.fileId, {
            operationId: 'sample-publish',
            expectedRevision: 1,
            expectedVersionId: s.base.versionId,
          })
        ).status
      ).toBe('recovery-required')
    } finally {
      s.close()
    }
  })

  it('requires explicit scoped acknowledgement for reader eviction and rejects changed operation IDs', async () => {
    const s = await setup('scoped')
    try {
      const request = {
        operationId: 'sample-scoped',
        expectedRevision: 0,
        expectedVersionId: s.base.versionId,
      }
      expect((await s.api.evict(s.base.fileId, request)).status).toBe('warning-required')
      expect(
        (await s.api.evict(s.base.fileId, { ...request, acknowledgeScopedWarning: true })).status
      ).toBe('complete')
      expect(
        (await s.api.evict(s.base.fileId, { ...request, expectedVersionId: 'sample-other' })).status
      ).toBe('recovery-required')
    } finally {
      s.close()
    }
  })
})
