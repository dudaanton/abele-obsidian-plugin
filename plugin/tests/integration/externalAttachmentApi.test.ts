import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExternalState } from '@/sync/external/state'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { AttachmentStore } from '@/sync/external/attachmentStore'
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
  const store = await IndexedDbStateStore.open(new IDBFactory(), crypto.randomUUID())
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
    sync: async () => {},
    serial: { run: async <T>(work: () => Promise<T>) => work() },
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
  })
  return {
    api,
    store,
    state,
    fake,
    host,
    verify,
    download,
    base,
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
      expect(restored.status).toMatch(/complete|cleanup-pending/)
      expect(new Uint8Array(await s.fake.vault.adapter.readBinary(path))).toEqual(content)
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
      expect(intercepted).toHaveBeenCalledOnce()
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

  it.fails(
    'BUG: an unpublished edit can publish before eviction without losing its expected-version intent',
    async () => {
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
        const publish = vi
          .spyOn(s.store, 'byFileId')
          .mockImplementation(async (id) =>
            id === s.base.fileId ? { ...head, wirePath: path } : null
          )
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
        expect(publish).toHaveBeenCalled()
      } finally {
        s.close()
      }
    }
  )

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
