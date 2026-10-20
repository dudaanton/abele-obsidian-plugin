import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncEngine } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExternalState } from '@/sync/external/state'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { SCRIPT_SENTINEL, SCRIPT_TRUST_KEY } from '@/scripting/trust/scriptTrustStorage'
import { tokenBuildFixture } from '../helpers/tokenBuildFixture'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function fixture(extraPath?: string) {
  const s = await tokenBuildFixture(extraPath)
  cleanups.push(s.close)
  return s
}
async function pending(s: Awaited<ReturnType<typeof fixture>>) {
  const binding = s.binding
  const state = await ExternalState.open(s.store, s.record.ledgerId, binding)
  await state.commit({
    expectedRevision: 0,
    operations: [
      {
        expectedRevision: null,
        next: {
          schema: 1,
          operationId: 'sample-eviction',
          kind: 'eviction',
          phase: 'delete-ready',
          revision: 0,
          connectionGeneration: 1,
          expected: {
            fileId: 'sample-file',
            versionId: 'sample-version',
            path: 'Media/sample.bin',
            sha: 'a'.repeat(64),
            size: 15,
          },
          sourcePath: 'Media/sample.bin',
          targetPath: 'Media/sample.bin.abele-ref',
          previousRepresentation: 'hydrated',
          localBase: null,
          desiredRepresentation: 'remote-only',
          projectionDigest: 'b'.repeat(64),
          ownedArtifacts: [],
          unresolvedOutcome: 'delete outcome unknown',
          cleanupReason: null,
        },
      },
    ],
  })
}

describe('external recovery before ordinary engine activation', () => {
  it('does not impose a configuration-directory depth limit on ordinary content folders', async () => {
    const s = await fixture('Nested/'.repeat(40) + 'sample.md')
    s.store.close()
    const built = await s.build()
    expect(built.store.permitsEngineEffects).toBe(true)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('does not complete startup after losing ownership during awaited external inspection', async () => {
    const s = await fixture()
    s.store.close()
    let release!: () => void, enter!: () => void
    const hold = new Promise<void>((resolve) => {
        release = resolve
      }),
      entered = new Promise<void>((resolve) => {
        enter = resolve
      })
    const read = IndexedDbStateStore.prototype.getExternalState
    vi.spyOn(IndexedDbStateStore.prototype, 'getExternalState').mockImplementationOnce(
      async function () {
        enter()
        await hold
        return read.call(this)
      }
    )
    const first = s.build().catch((error) => error)
    await entered
    const next = await s.build()
    release()
    expect(await first).toBeInstanceOf(Error)
    expect(next.store.permitsEngineEffects).toBe(true)
    expect(s.app.loadLocalStorage(SCRIPT_TRUST_KEY)).toBeNull()
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('completes installation recovery before creating script provenance state or sentinel', async () => {
    const s = await fixture()
    s.store.close()
    const recover = vi
      .spyOn(ObsidianFileSystem.prototype, 'recover')
      .mockImplementation(async () => {
        expect(s.app.loadLocalStorage(SCRIPT_TRUST_KEY)).toBeNull()
        expect(await s.app.vault.adapter.exists(SCRIPT_SENTINEL)).toBe(false)
        throw new Error('sample installation recovery hold')
      })
    await expect(s.build()).rejects.toThrow('sample installation recovery hold')
    expect(recover).toHaveBeenCalledOnce()
    expect(s.app.loadLocalStorage(SCRIPT_TRUST_KEY)).toBeNull()
  })

  it('does not construct scope work or activate publication/replay over an unresolved external journal', async () => {
    const s = await fixture()
    await pending(s)
    s.store.close()
    const scope = vi.spyOn(SyncEngine.prototype, 'recordScope')
    await expect(s.build()).rejects.toThrow(/recovery|external/i)
    expect(scope).not.toHaveBeenCalled()
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('holds every runner mutation, including rescan, delete decisions and deferred apply/keep, before recovery', async () => {
    const s = await fixture()
    await pending(s)
    s.store.close()
    const scope = vi.spyOn(SyncEngine.prototype, 'recordScope')
    s.host.start()
    await s.ui.connectionsChanged()
    expect(s.ui.runtimes.has(s.id)).toBe(false)
    await expect(s.ui.sync(s.id)).rejects.toThrow(/available|connect|recovery/i)
    expect(scope).not.toHaveBeenCalled()
    expect(s.ui.activity.value[s.id]?.error).toMatch(/recovery|external/i)
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('fences a retained Restore client after the runtime ledger loses ownership', async () => {
    const s = await fixture()
    s.store.close()
    const built = await s.build()
    built.store.close()
    await expect(built.vault.restore('sample-file', 'sample-version')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    await expect(built.vault.restoreDeleted('sample-file')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('rechecks ownership after awaited inspection immediately before a filesystem removal', async () => {
    const s = await fixture()
    s.store.close()
    const built = await s.build()
    const original = s.app.vault.adapter.stat.bind(s.app.vault.adapter)
    vi.spyOn(s.app.vault.adapter, 'stat').mockImplementation(async (path) => {
      const value = await original(path)
      if (path === 'Media/sample.bin') built.store.close()
      return value
    })
    await expect(
      Promise.resolve().then(() => (built as any).fs.remove('Media/sample.bin'))
    ).rejects.toThrow(/ownership|held|recovery/i)
    expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  })

  it('a successor claim fences an older runtime even while both database handles remain open', async () => {
    const s = await fixture()
    s.store.close()
    const first = await s.build()
    const next = await s.build()
    await expect(first.vault.restore('sample-file', 'sample-version')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    await expect(
      Promise.resolve().then(() => (first as any).fs.remove('Media/sample.bin'))
    ).rejects.toThrow(/ownership|held|recovery/i)
    expect(next.store.permitsEngineEffects).toBe(true)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  })

  it('does not issue later upload parts after ownership is lost during an earlier request', async () => {
    const s = await fixture()
    s.store.close()
    let built: Awaited<ReturnType<typeof s.build>>
    s.fetcher.mockImplementation(async (input: any) => {
      if (String(input).endsWith('/begin'))
        return new Response(
          JSON.stringify({ upload_id: 'sample-upload', part_size: 8 * 1024 * 1024, parts: 2 })
        )
      if (String(input).endsWith('/0')) built.store.close()
      return new Response('{}')
    })
    built = await s.build()
    await expect(
      built.vault.putBlob('a'.repeat(64), new Uint8Array(9 * 1024 * 1024))
    ).rejects.toThrow()
    expect(s.fetcher).toHaveBeenCalledTimes(2)
  })

  it('holds an unreadable publication journal before constructor scope changes', async () => {
    const s = await fixture()
    await s.store.setJournal({ batchId: '', ops: [], idempotencyKey: '', startedAt: '' })
    s.store.close()
    const scope = vi.spyOn(SyncEngine.prototype, 'recordScope')
    await expect(s.build()).rejects.toThrow(/journal|recovery|external/i)
    expect(scope).not.toHaveBeenCalled()
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('uses the durable connection descriptor at each effect, not a stale host snapshot', async () => {
    const s = await fixture()
    s.store.close()
    const built = await s.build()
    s.keys.set(s.record.secretReference, 'b'.repeat(43))
    await expect(built.vault.restore('sample-file', 'sample-version')).rejects.toThrow(
      /ownership|held|recovery/i
    )
    expect(s.fetcher).not.toHaveBeenCalled()
  })

  it('never spends a fresh bootstrap grant over a recognizable renamed projection', async () => {
    const s = await fixture()
    s.store.close()
    await IndexedDbStateStore.delete(s.factory, s.record.ledgerId)
    await s.app.vault.adapter.write(
      'Media/sample-moved.txt',
      JSON.stringify({
        format: 'abele.external',
        schema: 1,
        vaultId: s.record.spaceId,
        fileId: 'sample-file',
        path: 'Media/sample.bin',
        observedVersionId: 'sample-version',
        sha256: 'a'.repeat(64),
        size: 15,
        mime: 'application/octet-stream',
        mtime: 1000,
      })
    )
    await expect(s.build()).rejects.toThrow(/recovery|external|projection/i)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
})
