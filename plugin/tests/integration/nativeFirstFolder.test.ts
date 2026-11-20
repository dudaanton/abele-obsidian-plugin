// @vitest-environment node
import '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { SyncEngine, selectiveDefaults, sha256, type EngineClient } from '@abele/sync-sdk/core'
import { VaultSettingsSchema } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it.for([3, 50, 1000])(
  'installs a fresh native folder before reporting idle (%i server files)',
  async (count, { signal }) => {
    const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-first-folder-')))
    const app = buildFakeVault([])
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: disk,
      queue: async <T>(work: () => Promise<T>) => work(),
    })
    const bytes = new TextEncoder().encode('sample server content')
    const sha = await sha256(bytes)
    const items = Array.from({ length: count }, (_, i) => ({
      file_id: `sample-file-${i}`,
      version_id: `sample-version-${i}`,
      path: `Notes/sample-${i}.md`,
      sha,
      size: bytes.length,
      mtime: 1000,
      seq: 1,
      kind: 'note' as const,
    }))
    let pages = 0
    let applied = 0
    const factory = new IDBFactory()
    const storage = await HostSyncStorage.open(factory, 'sample-first-folder', app)
    const state = await IndexedDbStateStore.open(factory, 'sample-first-folder')
    // The fake retains completed transaction histories; the browser does not.
    // Keep active/queued lifetimes without making the fixture quadratic at scale.
    for (const db of [
      Reflect.get(storage, 'db') as IDBDatabase,
      Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase,
    ]) {
      const transaction = db.transaction.bind(db)
      db.transaction = ((...args: Parameters<typeof db.transaction>) => {
        const raw = Reflect.get(db, '_rawDatabase') as { transactions: { _state: string }[] }
        raw.transactions = raw.transactions.filter((tx) => tx._state !== 'finished')
        return transaction(...args)
      }) as typeof db.transaction
    }
    const engine = new SyncEngine({
      fs: new ObsidianFileSystem(app as never, { storage, ledger: state, fileScope: 'Notes' }),
      state,
      placementConcurrency: 16,
      onApplied: () => {
        applied++
      },
      selective: selectiveDefaults(),
      client: {
        state: async () => ({ head_seq: 1, settings: VaultSettingsSchema.parse({}), usage: {} }),
        manifest: async (next: string | null) => {
          pages++
          const offset = Number(next ?? 0)
          const end = Math.min(offset + 37, count)
          return {
            items: items.slice(offset, end),
            head_seq: 1,
            next: end < count ? String(end) : null,
          }
        },
        changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
        getBlob: async () => bytes,
        openVersion: async () => ({
          size: bytes.length,
          read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
          assertUnchanged: async () => {},
          close: async () => {},
        }),
      } as unknown as EngineClient,
    })
    const stop = () => {
      void engine.stop()
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      await engine.sync()
      expect(engine.status.state).toBe('idle')
      expect(pages).toBe(Math.ceil(count / 37))
      for (const item of items) {
        expect(new Uint8Array(await disk.readFile(join(root, item.path)))).toEqual(bytes)
        expect((await state.byFileId(item.file_id))?.versionId).toBe(item.version_id)
      }
    } finally {
      console.log('native first-folder delivery', { count, pages, applied, status: engine.status })
      signal.removeEventListener('abort', stop)
      await engine.stop()
      state.close()
      storage.close()
      await disk.rm(root, { recursive: true, force: true })
    }
  },
  30000
)
