// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TFolder, type App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { pull, ExpectedWrites, sha256, type FileSystem } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { buildFakeVault } from '../helpers/fakeVault'
import { WriteJournal } from '@/sync/writeJournal'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { ExternalRepresentation } from '@/sync/external/representation'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { collectHeap } from '../helpers/collectHeap'
import { WatchReports } from '../../node_modules/@abele/sync-sdk/dist/internal/core/watchReports.js'

function discardFinishedFakeTransactions(db: IDBDatabase): void {
  // The fake retains finished transactions as history, unlike the browser. At
  // scale that history both pins request results and makes scheduling quadratic.
  // Keep every active/queued transaction; only completed lifetimes are discarded.
  const raw = Reflect.get(db, '_rawDatabase') as { transactions: { _state: string }[] }
  raw.transactions = raw.transactions.filter((tx) => tx._state !== 'finished')
}

for (const fault of [
  'none',
  'batch-tail',
  'directory-flush',
  'publication',
  'sealed-cache',
  'ordered-operations',
  'ledger-abort',
  'occupied-target',
  'occupied-coordinated',
  'scoped',
  'coordinated',
  'live-recovery',
  'composed',
  'directory-projection',
  'directory-interruption',
  'path-candidates',
  'admission',
  'pause-notification',
  'pause-admission',
  'pause-mid-batch',
  'install-fingerprint',
  'install-fingerprint-backlog',
  'install-fingerprint-notification',
  'install-fingerprint-folder-notification',
  'install-fingerprint-repeat',
  'install-fingerprint-pull',
  'install-fingerprint-interrupted-publication',
  'install-fingerprint-watch-declined',
  'install-fingerprint-watch-reload',
  'install-fingerprint-adopt-reload',
  'install-fingerprint-adopt-reload-edited',
  'install-fingerprint-pull-invalidated',
  'install-fingerprint-inflight',
  'install-fingerprint-publication',
  'install-fingerprint-single',
  'install-fingerprint-single-edited',
  'install-fingerprint-own-event',
  'install-fingerprint-invalidated',
  'second-ledger-abort',
  'acknowledgement-reads',
  'acknowledgement-yields',
  'acknowledgement-parent-race',
] as const)
  it(
    `bounds native peer installation persistence and retained payloads by a batch (${fault})`,
    // The test's signal stops this pull when the case times out. Otherwise it keeps running
    // beside the next case, through the next case's desktop filesystem port.
    async ({ signal: ended }) => {
      const directoryCase =
        fault === 'directory-projection' ||
        fault === 'directory-interruption' ||
        fault === 'path-candidates'
      const normal = ![
        'directory-flush',
        'publication',
        'sealed-cache',
        'ledger-abort',
        'occupied-target',
        'occupied-coordinated',
        'second-ledger-abort',
      ].includes(fault)
      const count = directoryCase
        ? fault === 'path-candidates'
          ? 2000
          : 2048
        : fault.startsWith('install-fingerprint-single')
          ? 1
          : fault.startsWith('acknowledgement-')
            ? 32
            : fault === 'batch-tail'
              ? 65
              : fault === 'second-ledger-abort' || fault === 'ordered-operations'
                ? 128
                : normal
                  ? Number(process.env.PEER_PULL_FILES ?? (fault === 'none' ? 33000 : 64))
                  : 8
      const size = normal ? Number(process.env.PEER_PULL_BYTES ?? 4096) : 4096
      const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-peer-pull-')))
      const app = buildFakeVault([])
      let adapterLists = 0
      if (directoryCase)
        Object.assign(app.vault.adapter, {
          stat: async (path: string) => {
            const stat = await disk.stat(join(root, path)).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null
              throw error
            })
            return (
              stat && {
                type: stat.isDirectory() ? 'folder' : 'file',
                size: stat.size,
                mtime: stat.mtimeMs,
                ctime: stat.birthtimeMs,
              }
            )
          },
          list: async (path: string) => {
            adapterLists++
            const entries = await disk.readdir(join(root, path), { withFileTypes: true })
            const name = (entry: { name: string }) => (path ? path + '/' + entry.name : entry.name)
            return {
              files: entries.filter((one) => one.isFile()).map(name),
              folders: entries.filter((one) => one.isDirectory()).map(name),
            }
          },
        })
      // The directory manifest is installed before its file payloads in a real pull.
      // Populate that native tree; an empty adapter would hide whole-tree projections.
      if (directoryCase)
        for (let i = 0; i < (fault === 'path-candidates' ? 1 : 128); i++) {
          const path = `Notes/Section ${i}`
          await disk.mkdir(join(root, path), { recursive: true })
          await app.vault.adapter.mkdir(path)
        }
      const factory = new IDBFactory()
      let host = await HostSyncStorage.open(factory, 'sample-peer', app)
      let state = await IndexedDbStateStore.open(factory, 'sample-peer')
      if (fault === 'ordered-operations') {
        // The local file is already gone. The earlier remote deletion must retire
        // its ledger identity before later creates turn that spelling into a folder.
        await disk.mkdir(join(root, 'Notes'))
        await state.put({
          path: 'Notes/Section 0',
          wirePath: 'Notes/Section 0',
          fileId: 'sample-deleted',
          versionId: 'sample-old',
          sha: 'e'.repeat(64),
          size: 1,
          mtime: 1,
        })
        await state.setCursor(1)
      }
      const payloadBuffers = new WeakSet<ArrayBufferLike>()
      let payloadBackingBytes = 0
      const flushes = new Map<string, number>()
      const durableDirectories = new Set<string>()
      let commits = 0,
        hostCommits = 0,
        maxCommitBytes = 0,
        entryCommits = 0
      const hostDb = Reflect.get(host, 'db') as IDBDatabase
      const hostTransaction = hostDb.transaction.bind(hostDb)
      hostDb.transaction = ((...args: Parameters<typeof hostDb.transaction>) => {
        discardFinishedFakeTransactions(hostDb)
        const tx = hostTransaction(...args)
        if (args[1] === 'readwrite') tx.addEventListener('complete', () => hostCommits++)
        return tx
      }) as typeof hostDb.transaction
      let armed = !normal,
        publications = 0,
        downloads = 0
      // Directory barriers that started after a pause, in ms after it.
      const afterPause: number[] = []
      let pausedAt = 0,
        linked = 0,
        contentReads = 0
      // Count acknowledged ledger transactions, rather than calls which may abort.
      const db = Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase
      const transaction = db.transaction.bind(db)
      db.transaction = ((...args: Parameters<typeof db.transaction>) => {
        discardFinishedFakeTransactions(db)
        const tx = transaction(...args)
        let commitBytes = 0
        const observed = new WeakSet<IDBObjectStore>()
        if (args[1] === 'readwrite') tx.addEventListener('complete', () => commits++)
        tx.addEventListener('complete', () => {
          maxCommitBytes = Math.max(maxCommitBytes, commitBytes)
          if (commitBytes) entryCommits++
        })
        if (args[1] === 'readwrite') {
          const objectStore = tx.objectStore.bind(tx)
          tx.objectStore = ((name: string) => {
            const store = objectStore(name),
              put = store.put.bind(store)
            if (name === 'entries' && !observed.has(store)) {
              observed.add(store)
              store.put = ((...values: Parameters<typeof store.put>) => {
                const entry = values[0] as { path: string }
                commitBytes += size
                expect(
                  durableDirectories.has(entry.path.slice(0, entry.path.lastIndexOf('/')))
                ).toBe(true)
                if (
                  armed &&
                  (fault === 'ledger-abort' ||
                    (fault === 'second-ledger-abort' && entryCommits === 1))
                ) {
                  armed = false
                  tx.abort()
                }
                return put(...values)
              }) as typeof store.put
            }
            return store
          }) as typeof tx.objectStore
        }
        return tx
      }) as typeof db.transaction
      // Only this case's own files count. A call for another root is passed through untouched.
      const own = (path: string) => path.startsWith(root + '/')
      const fs = {
        ...disk,
        link: async (from: string, to: string) => {
          if (!own(from)) return disk.link(from, to)
          expect(durableDirectories.has(from.slice(root.length + 1))).toBe(true)
          if (armed && fault === 'sealed-cache') {
            armed = false
            throw new Error('sample sealed cache interrupted before publication')
          }
          if (
            armed &&
            (fault === 'occupied-target' || fault === 'occupied-coordinated') &&
            ++publications === 4
          ) {
            armed = false
            await disk.writeFile(to, 'sample independent edit')
          }
          if (armed && fault === 'publication' && ++publications === 4) {
            armed = false
            throw new Error('sample publication interrupted')
          }
          await disk.link(from, to)
          if (fault === 'install-fingerprint-publication' && to.endsWith('.bin')) {
            const path = to.slice(root.length + 1)
            inflight.push(files.fingerprint(path, undefined, true))
            // The host can deliver its watcher while publication still awaits reconciliation.
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          if (
            (fault === 'pause-mid-batch' ||
              fault === 'install-fingerprint-interrupted-publication') &&
            ++linked === 2
          ) {
            pausedAt = performance.now()
            stopped.abort()
          }
        },
        open: async (...args: Parameters<typeof disk.open>) => {
          const handle = await disk.open(...args)
          const opened = String(args[0])
          return new Proxy(handle, {
            get(target, key) {
              if (key === 'read' || key === 'write')
                return (bytes: Uint8Array, ...args: [number, number, number]) => {
                  expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
                  if (key === 'write' && own(opened) && !payloadBuffers.has(bytes.buffer)) {
                    payloadBuffers.add(bytes.buffer)
                    payloadBackingBytes += bytes.buffer.byteLength
                  }
                  if (key === 'read' && own(opened) && !opened.endsWith('.tmp')) {
                    contentReads++
                  }
                  return handle[key](bytes, ...args)
                }
              if (key === 'sync')
                return async () => {
                  if (!own(String(args[0]))) return handle.sync()
                  const path = String(args[0]).slice(root.length + 1)
                  flushes.set(path, (flushes.get(path) ?? 0) + 1)
                  if (pausedAt && !path.endsWith('.tmp'))
                    afterPause.push(performance.now() - pausedAt)
                  if (armed && fault === 'directory-flush' && path === 'Notes/Section 0') {
                    armed = false
                    throw new Error('sample directory barrier interrupted')
                  }
                  await handle.sync()
                  durableDirectories.add(path)
                }
              const value = Reflect.get(target, key, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        },
      }
      desktopFsPort(fs)
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => join(root, path),
        fsPromises: fs,
        queue: async <T>(work: () => Promise<T>) => work(),
      })
      const capturedPaths = new Set<string>()
      let captures = 0,
        recoveredLive = false,
        admissions = 0
      let stopped = new AbortController()
      const inflight: Promise<unknown>[] = []
      const makeFiles = () =>
        new ObsidianFileSystem(app as unknown as App, {
          storage: host,
          ledger: state,
          ...(fault.startsWith('acknowledgement-') ||
          fault === 'directory-interruption' ||
          fault === 'path-candidates'
            ? { prepareStartupInventory: async () => {} }
            : {}),
          ...(fault === 'install-fingerprint-inflight'
            ? {
                onEngineWrite: (path) => {
                  if (!path.endsWith('.bin')) return
                  const watcher = new WatchReports({
                    fs: files,
                    expected,
                    debounceMs: 60000,
                    onChange: () => {},
                  })
                  watcher.noticed.add(path)
                  inflight.push(watcher.examine().then((changed) => expect(changed).toBe(false)))
                },
              }
            : {}),
          ...(fault === 'admission' || fault === 'pause-admission'
            ? {
                beforeEngineMutation: async () => {
                  admissions++
                  if (fault === 'pause-admission') stopped.abort()
                },
              }
            : {}),
          ...(fault === 'scoped' || fault === 'composed' || directoryCase
            ? { connectionId: 'sample-connection', fileScope: 'Notes' }
            : {}),
        })
      let files = makeFiles()
      // Retain only active work for pause; settled placements must not grow a
      // history which is scanned or kept alive by every later installation.
      const mutationCost = { added: 0, removed: 0, peak: 0, iterations: 0 }
      const mutations = Reflect.get(files, 'scanMutationWork') as Set<Promise<unknown>>
      if (fault === 'none') {
        const add = mutations.add.bind(mutations),
          remove = mutations.delete.bind(mutations)
        const iterator = mutations[Symbol.iterator].bind(mutations)
        mutations.add = (work) => {
          mutationCost.added++
          add(work)
          mutationCost.peak = Math.max(mutationCost.peak, mutations.size)
          return mutations
        }
        mutations.delete = (work) => {
          mutationCost.removed++
          return remove(work)
        }
        mutations[Symbol.iterator] = () => {
          mutationCost.iterations++
          return iterator()
        }
      }
      if (fault === 'acknowledgement-parent-race') {
        const candidates = files.trustedPathCandidates!
        let creating: Promise<void> | undefined
        let placing = false
        const install = Symbol.for('abele.sync.install-batch-v1')
        const batch = Reflect.get(files, install).bind(files)
        Object.defineProperty(files, install, {
          configurable: true,
          value: (
            items: unknown,
            work: (fs: FileSystem, flush: () => Promise<void>) => Promise<unknown>
          ) =>
            batch(items, async (fs: FileSystem, flush: () => Promise<void>) => {
              placing = true
              try {
                return await work(fs, flush)
              } finally {
                placing = false
              }
            }),
        })
        Object.defineProperty(files, 'trustedPathCandidates', {
          configurable: true,
          value: {
            lookup: async (directory: string, name: string) => {
              const rows = await candidates.lookup(directory, name)
              if (
                placing &&
                directory === '' &&
                name === 'Notes' &&
                rows?.length === 0 &&
                !creating
              ) {
                // A sibling placement creates the shared parent after this lookup
                // captured its absence, before the resolver's live validation.
                creating = Reflect.get(files, 'makeParents').call(
                  files,
                  'Notes/Section 0/Sample 0.bin'
                )
              }
              return rows
            },
            lstat: async (path: string) => {
              if (path === 'Notes') await creating
              return candidates.lstat(path)
            },
          },
        })
      }
      state.observeCommittedEntries((entries) => files.acknowledgeWrites(entries))
      let directoryCalls = 0,
        directoryItems = 0,
        childCalls = 0,
        absentHits = 0,
        absentMisses = 0
      const directoryPort = Symbol.for('abele.sync.inventory-directories-v1')
      const instrumentDirectories = () => {
        const readDirectories = Reflect.get(files, directoryPort).bind(files)
        const childPort = Symbol.for('abele.sync.inventory-children-v1')
        const absentPort = Symbol.for('abele.sync.index-absent-v1')
        const children = Reflect.get(files, childPort).bind(files)
        const absent = Reflect.get(files, absentPort).bind(files)
        Object.assign(files, {
          [childPort]: (...args: unknown[]) => {
            childCalls++
            return children(...args)
          },
          [absentPort]: async (...args: unknown[]) => {
            const result = await absent(...args)
            if (result) absentHits++
            else absentMisses++
            return result
          },
          [directoryPort]: async (...args: unknown[]) => {
            const rows = await readDirectories(...args)
            directoryCalls++
            directoryItems += rows.length
            return rows
          },
        })
      }
      instrumentDirectories()
      let coreChildren = 0
      let composed: import('@abele/sync-sdk/core').FileSystem | undefined
      const makeComposed = async () => {
        if (fault === 'composed' || directoryCase) {
          const placement = new LocalFolderPlacement('Notes', 'Notes')
          const representation = await ExternalRepresentation.open({
            state: null,
            ledger: state,
            fs: placement.fileSystem(files),
            emptyView: {
              ledgerId: 'sample-ledger',
              binding: {
                endpoint: 'https://sync.example.invalid',
                vaultId: 'sample-vault',
                mode: 'personal',
                principalId: 'sample-principal',
                principalType: 'device',
                grantId: null,
                generation: 1,
                credentialAssociation: 'sample-slot',
              },
            },
            assertOwned: () => {},
            scriptsFolder: () => 'Scripts',
            verify: async () => {
              throw new Error('unexpected verification')
            },
            installProjection: async () => {
              throw new Error('unexpected installation')
            },
          })
          const includes = (path: string) => path === 'Notes' || path.startsWith('Notes/')
          const locks = new PathCoordinator(),
            manager = new TokenOffloadCoordinator(locks)
          const coordinated = coordinatedFileSystem(
            manager.fileSystem(placement.localFileSystem(representation.fileSystem()), includes),
            locks,
            () => {},
            async (paths) => {
              for await (const _ of files.placementFiles(paths)) {
                /* preserve */
              }
            }
          )
          composed = placement.fileSystem(
            scopedFileSystem(
              coordinated,
              (path) => {
                if (!includes(path)) throw new Error('sample scope refusal')
              },
              includes,
              connectionPrivateRoot('sample-connection'),
              directoryCase ? 'Notes' : undefined
            )
          )
        }
      }
      await makeComposed()
      if (fault === 'path-candidates') {
        const target = composed!
        composed = new Proxy(target, {
          get(fs, key) {
            const value = Reflect.get(fs, key)
            if (key === 'listChildren' || key === Symbol.for('abele.sync.inventory-children-v1'))
              return (...args: unknown[]) => {
                coreChildren++
                return value.apply(fs, args)
              }
            return typeof value === 'function' ? value.bind(fs) : value
          },
        })
      }
      const bytes = new Uint8Array(size).fill(37)
      const payload = (i: number) => {
        const result = bytes.slice()
        new DataView(result.buffer).setUint32(0, i)
        return result
      }
      const items = []
      for (let i = 0; i < count; i++)
        items.push({
          file_id: `sample-file-${i}`,
          version_id: `sample-version-${i}`,
          seq: i + 1,
          path: `Notes/Section ${i % (fault === 'path-candidates' ? 1 : directoryCase ? 128 : 16)}/Sample ${directoryCase ? 'K ' : ''}${i}.bin`,
          sha: await sha256(payload(i)),
          size,
          mtime: 2000,
          kind: 'attachment',
        })
      const rss: { files: number; ms: number; rss: number; arrayBuffers: number }[] = []
      const started = performance.now()
      let installed = 0
      const sample = () => {
        const row = {
          files: installed,
          ms: performance.now() - started,
          rss: process.memoryUsage().rss,
          arrayBuffers: process.memoryUsage().arrayBuffers,
          heapUsed: process.memoryUsage().heapUsed,
        }
        rss.push(row)
        console.log('[peer-pull-rss]', JSON.stringify(row))
      }
      sample()
      const expected = new ExpectedWrites()
      // Force time-based scan checkpoints even on an idle host. Scheduler waits
      // must not turn a native cohort into per-file durable commits.
      const now = performance.now.bind(performance)
      let checkpoints = 0
      const clock =
        fault === 'acknowledgement-yields'
          ? vi.spyOn(performance, 'now').mockImplementation(() => now() + ++checkpoints * 10)
          : undefined
      let schedulerYields = 0
      const Channel = globalThis.MessageChannel
      const channels = clock
        ? vi.spyOn(globalThis, 'MessageChannel').mockImplementation(
            class extends Channel {
              constructor() {
                super()
                schedulerYields++
              }
            }
          )
        : undefined
      try {
        let stopAfter = 512
        const rawRun = () =>
          pull(
            {
              manifest: async (cursor: string | null, limit: number) => {
                const offset = Number(cursor ?? 0),
                  end = Math.min(offset + limit, count)
                return {
                  items: items.slice(offset, end),
                  head_seq: count,
                  next: end < count ? String(end) : null,
                }
              },
              changes: async (since: number) =>
                fault === 'ordered-operations'
                  ? {
                      items:
                        since === 1
                          ? [
                              {
                                seq: 2,
                                file_id: 'sample-deleted',
                                version_id: 'sample-delete',
                                op: 'delete',
                                path: 'Notes/Section 0',
                                prev_path: null,
                                sha: null,
                                size: null,
                                mtime: null,
                                kind: 'attachment',
                                actor: { kind: 'system', id: 'sample', name: 'sample' },
                                at: '',
                              },
                              ...items.map((item, i) => ({
                                ...item,
                                seq: i + 3,
                                op: 'create',
                                prev_path: null,
                                actor: { kind: 'system', id: 'sample', name: 'sample' },
                                at: '',
                              })),
                            ]
                          : [],
                      head_seq: count + 2,
                      next_since: count + 2,
                    }
                  : { items: [], head_seq: count, next_since: count },
              getBlob: async (sha: string) => payload(items.findIndex((item) => item.sha === sha)),
              openVersion: async (id: string) => {
                downloads++
                return {
                  size,
                  read: async (offset: number, length: number) => {
                    const index = Number(id.split('-').at(-1))
                    // The rest of the cohort is still downloading when the pause comes, and a
                    // network read does not end the moment it is cancelled.
                    if (fault === 'pause-mid-batch' && index >= 2)
                      await new Promise((resolve) => setTimeout(resolve, 300))
                    return payload(index).slice(offset, offset + length)
                  },
                  assertUnchanged: async () => {},
                  close: async () => {
                    if (fault === 'live-recovery' && !recoveredLive) {
                      recoveredLive = true
                      await Reflect.get(files, 'writer').recover()
                    }
                  },
                }
              },
            } as never,
            composed ??
              (fault === 'coordinated' || fault === 'occupied-coordinated'
                ? coordinatedFileSystem(
                    files,
                    new PathCoordinator(),
                    () => {},
                    async (paths) => {
                      for (const path of paths) capturedPaths.add(path)
                      for await (const _info of files.placementFiles(paths)) captures++
                      captures++
                    }
                  )
                : fault === 'scoped'
                  ? scopedFileSystem(
                      files,
                      (path) => {
                        if (!path.startsWith('Notes/')) throw new Error('sample scope refusal')
                      },
                      (path) => path.startsWith('Notes/'),
                      connectionPrivateRoot('sample-connection')
                    )
                  : files),
            state,
            {
              signal:
                fault === 'directory-interruption' ||
                fault === 'pause-notification' ||
                fault === 'pause-admission' ||
                fault === 'pause-mid-batch' ||
                fault === 'install-fingerprint-interrupted-publication'
                  ? AbortSignal.any([stopped.signal, ended])
                  : ended,
              dirty: new Set(),
              expected:
                fault === 'install-fingerprint-interrupted-publication' ||
                fault === 'install-fingerprint-watch-declined' ||
                fault === 'install-fingerprint-watch-reload' ||
                fault === 'install-fingerprint-backlog' ||
                fault === 'install-fingerprint-inflight'
                  ? expected
                  : new ExpectedWrites(),
              filter: { excluded: () => false },
              placementConcurrency: 16,
              onApplied: () => {
                installed++
                if (fault === 'path-candidates' && installed === 1)
                  Object.assign(app.metadataCache, { isCacheClean: () => false })
                if (fault === 'directory-interruption' && installed === stopAfter) stopped.abort()
                if (fault === 'pause-notification' && installed === 1) stopped.abort()
                if (installed % 256 === 0 || installed === count) sample()
              },
            }
          )
        // Indexed hosts run pull inside the engine's inventory pass, including
        // publication proofs for parents that the host has not indexed yet.
        const run = () =>
          directoryCase || fault.startsWith('acknowledgement-')
            ? Reflect.get(files, Symbol.for('abele.sync.inventory-pass-v1')).call(
                files,
                async () => {
                  if (fault === 'directory-interruption')
                    await Reflect.get(files, directoryPort).call(files)
                  return rawRun()
                }
              )
            : rawRun()
        if (fault === 'ordered-operations') {
          const report = await run()
          expect(report.held).toEqual([])
          expect(await state.byFileId('sample-deleted')).toBeNull()
          expect(report.cursor).toBe(count + 2)
          for (const item of items)
            expect(await sha256(await disk.readFile(join(root, item.path)))).toBe(item.sha)
          return
        }
        if (fault === 'occupied-target' || fault === 'occupied-coordinated') {
          const report = await run()
          expect(armed).toBe(false)
          expect(report.held).toHaveLength(1)
          expect(report.applied).toBe(count - 1)
          const held = report.held[0]
          expect(await disk.readFile(join(root, held.path), 'utf8')).toBe('sample independent edit')
          expect(await state.get(held.path)).toBeNull()
          for (const item of items.filter((item) => item.path !== held.path)) {
            expect(await sha256(await disk.readFile(join(root, item.path)))).toBe(item.sha)
            expect((await state.get(item.path))?.versionId).toBe(item.version_id)
          }
          return
        }
        if (!normal) {
          await expect(run()).rejects.toBeDefined()
          expect(armed).toBe(false)
          const rows = []
          for await (const row of state.all()) rows.push(row)
          if (fault === 'second-ledger-abort') expect(rows).toHaveLength(64)
          else expect(rows).toEqual([])
          const publicPaths = new Set<string>()
          for (const item of items) {
            const data = await disk.readFile(join(root, item.path)).catch(() => null)
            if (data) {
              expect(await sha256(data)).toBe(item.sha)
              publicPaths.add(item.path)
            }
          }
          const before = downloads
          const reusable = new Set<string>()
          for (const entry of await new WriteJournal(host).currentEntries()) {
            if (!entry.temp) continue
            const data = await disk.readFile(join(root, entry.temp)).catch(() => null)
            if (data && (await sha256(data)) === entry.replacementSha) reusable.add(entry.target)
          }
          if (fault === 'sealed-cache') expect(reusable.size).toBeGreaterThan(0)
          // Reopen the ledger and filesystem capabilities; no process-local batch proof survives.
          state.close()
          host.close()
          host = await HostSyncStorage.open(factory, 'sample-peer', app)
          state = await IndexedDbStateStore.open(factory, 'sample-peer')
          files = new ObsidianFileSystem(app as unknown as App, { storage: host, ledger: state })
          state.observeCommittedEntries((entries) => files.acknowledgeWrites(entries))
          await files.recover()
          const report = await run()
          expect(report.held).toEqual([])
          expect(downloads - before).toBe(count - new Set([...reusable, ...publicPaths]).size)
          expect(await new WriteJournal(host).currentEntries()).toEqual([])
          expect(await state.getMeta('pull-cleanup-head')).toBeNull()
          for (const item of items) {
            expect(await sha256(await disk.readFile(join(root, item.path)))).toBe(item.sha)
            expect((await state.get(item.path))?.versionId).toBe(item.version_id)
          }
          return
        }
        if (fault === 'pause-admission') {
          await expect(run()).rejects.toBeDefined()
          expect(admissions).toBeGreaterThan(0)
          expect(installed).toBe(0)
          expect(await Array.fromAsync(state.all())).toEqual([])
          for (const item of items)
            expect(await disk.stat(join(root, item.path)).catch(() => null)).toBeNull()
          return
        }
        if (fault === 'install-fingerprint-interrupted-publication') {
          await expect(run()).rejects.toBeDefined()
          const published = []
          for (const item of items)
            if (await disk.stat(join(root, item.path)).catch(() => null)) published.push(item)
          expect(published.length).toBeGreaterThan(0)
          contentReads = 0
          // A delayed host event can retain its own-write expectation across an aborted cohort.
          for (const item of published) expected.expect(item.path, item.sha)
          const watcher = new WatchReports({
            fs: files,
            expected,
            debounceMs: 60000,
            onChange: () => {},
          })
          try {
            watcher.notice(published.map((item) => item.path))
            expect(await watcher.examine()).toBe(false)
            expect(contentReads).toBe(0)
          } finally {
            watcher.cancel()
          }
          host.close()
          host = await HostSyncStorage.open(factory, 'sample-peer', app)
          files = makeFiles()
          await files.recover()
          for (const item of published)
            expect((await files[Symbol.for('abele.sync.fingerprint-pull-v1')](item.path)).sha).toBe(
              item.sha
            )
          expect(contentReads).toBe(0)
          const edited = published[0],
            prior = await disk.stat(join(root, edited.path))
          await disk.writeFile(join(root, edited.path), payload(0).fill(91))
          await disk.utimes(join(root, edited.path), prior.atime, prior.mtime)
          expect((await files[Symbol.for('abele.sync.fingerprint-pull-v1')](edited.path)).sha).toBe(
            await sha256(payload(0).fill(91))
          )
          expect(contentReads).toBeGreaterThan(0)
          return
        }
        if (
          fault === 'install-fingerprint' ||
          fault === 'install-fingerprint-backlog' ||
          fault === 'install-fingerprint-notification' ||
          fault === 'install-fingerprint-folder-notification' ||
          fault === 'install-fingerprint-repeat' ||
          fault === 'install-fingerprint-watch-declined' ||
          fault === 'install-fingerprint-watch-reload' ||
          fault === 'install-fingerprint-adopt-reload' ||
          fault === 'install-fingerprint-adopt-reload-edited' ||
          fault === 'install-fingerprint-pull' ||
          fault === 'install-fingerprint-pull-invalidated' ||
          fault === 'install-fingerprint-inflight' ||
          fault === 'install-fingerprint-publication' ||
          fault === 'install-fingerprint-single' ||
          fault === 'install-fingerprint-single-edited' ||
          fault === 'install-fingerprint-own-event' ||
          fault === 'install-fingerprint-invalidated'
        ) {
          if (fault === 'install-fingerprint' || fault === 'install-fingerprint-own-event') {
            const identity = files.fileIdentity!.bind(files)
            Reflect.set(files, 'fileIdentity', async (path: string) => {
              const result = await identity(path)
              // Another path's watcher event can arrive while this identity is being read.
              Reflect.get(files, 'noteWatchChange').call(
                files,
                fault === 'install-fingerprint-own-event' ? path : 'Unrelated/sample.md'
              )
              return result
            })
          }
          if (fault === 'install-fingerprint-single-edited') {
            const discard = files.discardInstallation.bind(files)
            files.discardInstallation = async (receipt) => {
              const path = join(root, items[0].path)
              const before = await disk.stat(path)
              await disk.writeFile(path, payload(0).fill(91))
              await disk.utimes(path, before.atime, before.mtime)
              await discard(receipt)
            }
          }
          const installStarted = performance.now()
          await run()
          const installMs = performance.now() - installStarted
          if (fault === 'install-fingerprint-single-edited') {
            expect((await files.fingerprint(items[0].path, undefined, true)).sha).toBe(
              await sha256(payload(0).fill(91))
            )
            expect(contentReads).toBeGreaterThan(0)
            return
          }
          if (
            fault === 'install-fingerprint-inflight' ||
            fault === 'install-fingerprint-publication'
          ) {
            await Promise.all(inflight)
            expect(inflight.length).toBeGreaterThan(0)
            expect(contentReads).toBe(0)
          }
          if (fault === 'install-fingerprint-watch-declined')
            expect(
              await files[Symbol.for('abele.sync.install-batch-v1')]!(items, async () => {
                throw new Error('existing files must not enter an install batch')
              })
            ).toBeUndefined()
          if (fault.includes('-reload')) {
            expect(
              (await host.readScanFingerprint(files.pathKey(items[0].path)))?.installation
            ).toBe(true)
            host.close()
            host = await HostSyncStorage.open(factory, 'sample-peer', app)
            if (fault.startsWith('install-fingerprint-adopt-reload')) {
              state.close()
              state = await IndexedDbStateStore.open(factory, 'sample-peer-adoption')
            }
            files = makeFiles()
            expect(
              (await host.readScanFingerprint(files.pathKey(items[0].path)))?.installation
            ).toBe(true)
            state.observeCommittedEntries((entries) => files.acknowledgeWrites(entries))
          }
          contentReads = 0
          if (
            fault === 'install-fingerprint-watch-reload' ||
            fault === 'install-fingerprint-watch-declined'
          ) {
            const watcher = new WatchReports({
              fs: files,
              expected,
              debounceMs: 60000,
              onChange: () => {},
            })
            try {
              watcher.notice(items.map((item) => item.path))
              expect(await watcher.examine()).toBe(false)
              expect(contentReads).toBe(0)
            } finally {
              watcher.cancel()
            }
            return
          }
          if (fault.startsWith('install-fingerprint-adopt-reload')) {
            if (fault.endsWith('-edited')) {
              const path = join(root, items[0].path),
                prior = await disk.stat(path)
              await disk.writeFile(path, payload(0).fill(91))
              await disk.utimes(path, prior.atime, prior.mtime)
              expect(
                (await files[Symbol.for('abele.sync.fingerprint-pull-v1')](items[0].path)).sha
              ).toBe(await sha256(payload(0).fill(91)))
              expect(contentReads).toBeGreaterThan(0)
            } else {
              const before = downloads
              await run()
              expect(downloads).toBe(before)
              expect(contentReads).toBe(0)
              for (const item of items) expect((await state.get(item.path))?.sha).toBe(item.sha)
            }
            return
          }
          const receiptTimers = [
            'setTimeout',
            'clearTimeout',
            'setInterval',
            'clearInterval',
          ] as const
          const previousTimers = receiptTimers.map((key) =>
            Object.getOwnPropertyDescriptor(window, key)
          )
          for (const key of receiptTimers)
            Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
          const stopReceiptWatch = files.watch(() => {})
          try {
            if (fault === 'install-fingerprint-notification')
              for (const item of items) app.emit('vault', 'modify', { path: item.path })
            if (fault === 'install-fingerprint-folder-notification')
              app.emit('vault', 'create', Object.assign(new TFolder(), { path: 'Notes' }))
            if (fault === 'install-fingerprint-repeat')
              for (const item of items)
                expect((await files.fingerprint(item.path)).sha).toBe(item.sha)
            if (fault === 'install-fingerprint-pull') {
              // Equal-file adoption must honor the same verified installation proof as
              // an own-write watcher; an untrusted scan hint is still insufficient.
              for (const item of items)
                expect(
                  (await files[Symbol.for('abele.sync.fingerprint-pull-v1')](item.path)).sha
                ).toBe(item.sha)
              expect(contentReads).toBe(0)
            }
            if (
              fault === 'install-fingerprint-invalidated' ||
              fault === 'install-fingerprint-pull-invalidated'
            ) {
              // Another filesystem instance shares the host's mutation fence. Even a write
              // that restores the same stat must retire the earlier installation receipt.
              const item = items[0]
              await host.withScanMutation([files.pathKey(item.path)], async () => {})
              const result =
                fault === 'install-fingerprint-pull-invalidated'
                  ? await files[Symbol.for('abele.sync.fingerprint-pull-v1')](item.path)
                  : await files.fingerprint(item.path)
              expect(result.sha).toBe(item.sha)
              expect(contentReads).toBeGreaterThan(0)
              return
            }
            // The watcher's own-write check fingerprints every file the pull installed. The batch
            // verified those bytes before publishing them; reading them again doubled a pull's IO.
            if (fault === 'install-fingerprint-backlog') {
              // Cross the real revision-clock boundary without thousands of durable
              // installs. hostMutationCohort separately keeps 4,200 installation proofs.
              const revision = host.scanFingerprintRevision(items[0].path)
              await host.withScanMutation(['Unrelated'], async () => {
                for (let i = 0; i < 4200; i++)
                  await host.withScanMutation([`Unrelated/Sample ${i}.md`], async () => {})
              })
              expect(host.scanFingerprintRevision(items[0].path)).toBeGreaterThan(revision)
              // A debounced watcher still examines the whole real pull after eviction.
              const watcher = new WatchReports({
                fs: files,
                expected,
                debounceMs: 60000,
                onChange: () => {},
              })
              const fingerprints = vi.spyOn(files, 'fingerprint')
              watcher.notice(items.map((item) => item.path))
              const watchStarted = performance.now()
              try {
                expect(await watcher.examine()).toBe(false)
                expect(watcher.reported.size).toBe(0)
                expect(fingerprints.mock.calls.map(([path]) => path)).toEqual(
                  items.map((item) => item.path)
                )
              } finally {
                watcher.cancel()
                fingerprints.mockRestore()
              }
              console.log('[peer-backlog-costs]', {
                count,
                installMs,
                watchMs: performance.now() - watchStarted,
                contentReads,
                hostCommits,
                ledgerCommits: commits,
                durabilityBarriers: [...flushes.values()].reduce((sum, value) => sum + value, 0),
              })
            } else
              for (const item of items)
                expect(
                  (
                    await Reflect.get(files, Symbol.for('abele.sync.fingerprint-fresh-v1')).call(
                      files,
                      item.path
                    )
                  ).sha
                ).toBe(item.sha)
            expect(contentReads).toBe(0)
          } finally {
            stopReceiptWatch()
            receiptTimers.forEach((key, i) => {
              if (previousTimers[i]) Object.defineProperty(window, key, previousTimers[i]!)
              else Reflect.deleteProperty(window, key)
            })
          }
          if (fault === 'install-fingerprint-notification') {
            // A stale index can retain size/mtime and object identity after an edit.
            const changed = items[Math.min(3, items.length - 1)]
            const rawStat = Reflect.get(files, 'rawStat').bind(files)
            const priorStat = await rawStat(changed.path)
            const edited = payload(3).fill(91)
            await disk.writeFile(join(root, changed.path), edited)
            Reflect.set(files, 'rawStat', async (path: string) =>
              path === changed.path ? priorStat : rawStat(path)
            )
            try {
              expect((await files.fingerprint(changed.path, undefined, true)).sha).toBe(
                await sha256(edited)
              )
              expect(contentReads).toBeGreaterThan(0)
            } finally {
              Reflect.set(files, 'rawStat', rawStat)
            }
          }
          // A file changed afterwards is read again.
          const changed = items[Math.min(3, items.length - 1)]
          await new Promise((resolve) => setTimeout(resolve, 5))
          await disk.writeFile(join(root, changed.path), 'sample local edit')
          expect((await files.fingerprint(changed.path)).sha).toBe(
            await sha256(new TextEncoder().encode('sample local edit'))
          )
          expect(contentReads).toBeGreaterThan(0)
          return
        }
        if (fault === 'pause-mid-batch') {
          await expect(run()).rejects.toBeDefined()
          expect(linked).toBeGreaterThanOrEqual(2)
          // Pause stops within one file. Names already published are made durable at once,
          // not after the rest of the cohort's downloads give up.
          expect(afterPause.filter((ms) => ms > 100)).toEqual([])
          for (const item of items)
            if (await disk.stat(join(root, item.path)).catch(() => null))
              expect(durableDirectories.has(item.path.slice(0, item.path.lastIndexOf('/')))).toBe(
                true
              )
          return
        }
        if (fault === 'pause-notification') {
          await expect(run()).rejects.toBeDefined()
          expect(installed).toBe(1)
          for (const item of items)
            expect((await state.get(item.path))?.versionId).toBe(item.version_id)
          return
        }
        if (fault === 'directory-interruption') {
          const phases: {
            phase: string
            installed: number
            calls: number
            rows: number
            children: number
            lists: number
            absentHits: number
            absentMisses: number
          }[] = []
          const record = (phase: string) => {
            phases.push({
              phase,
              installed,
              calls: directoryCalls,
              rows: directoryItems,
              children: childCalls,
              lists: adapterLists,
              absentHits,
              absentMisses,
            })
            directoryCalls =
              directoryItems =
              childCalls =
              adapterLists =
              absentHits =
              absentMisses =
                0
          }
          const settleHostIndex = async () => {
            const indexed = []
            for (const item of items) {
              const stat = await disk.stat(join(root, item.path)).catch(() => null)
              if (stat)
                indexed.push({
                  path: item.path,
                  content: 'x'.repeat(stat.size),
                  mtime: stat.mtimeMs,
                  ctime: stat.birthtimeMs,
                })
            }
            const settled = buildFakeVault(indexed)
            // Reindex/reload exposes the installed files, not an empty synthetic index.
            for (const key of [
              'getFiles',
              'getMarkdownFiles',
              'getAbstractFileByPath',
              'getFileByPath',
              'getAllLoadedFiles',
              'getRoot',
            ] as const)
              Object.assign(app.vault, { [key]: settled.vault[key].bind(settled.vault) })
          }
          await expect(run()).rejects.toBeDefined()
          record('before-pause')
          await settleHostIndex()
          stopped = new AbortController()
          stopAfter = 1024
          await expect(run()).rejects.toBeDefined()
          record('after-resume')
          await settleHostIndex()
          // A restarted engine reopens its ledger and reconstructs every path adapter.
          stopped = new AbortController()
          stopAfter = -1
          state.close()
          host.close()
          host = await HostSyncStorage.open(factory, 'sample-peer', app)
          state = await IndexedDbStateStore.open(factory, 'sample-peer')
          // Browser transactions do not remain in an ever-growing scheduler history.
          // The reopened handles need the same fake-only pruning as the original ones.
          for (const reopened of [
            Reflect.get(host, 'db') as IDBDatabase,
            Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase,
          ]) {
            const transaction = reopened.transaction.bind(reopened)
            reopened.transaction = ((...args: Parameters<typeof reopened.transaction>) => {
              discardFinishedFakeTransactions(reopened)
              return transaction(...args)
            }) as typeof reopened.transaction
          }
          state.observeCommittedEntries((entries) => files.acknowledgeWrites(entries))
          files = makeFiles()
          instrumentDirectories()
          await makeComposed()
          await run()
          record('after-restart')
          console.log('[directory-interruption-counts]', JSON.stringify(phases))
          for (const phase of phases) {
            expect(phase.calls, phase.phase).toBeLessThanOrEqual(4)
            expect(phase.rows, phase.phase).toBeLessThanOrEqual(count * 4)
          }
          for (const item of items)
            expect(await sha256(await disk.readFile(join(root, item.path)))).toBe(item.sha)
          return
        }
        const report = await run()
        if (clock) expect(schedulerYields).toBeGreaterThanOrEqual(count)
        if (fault === 'path-candidates') {
          console.log('[path-candidate-counts]', {
            installed,
            coreChildren,
            childCalls,
            directoryCalls,
            directoryItems,
          })
          expect(installed).toBe(2000)
          expect(coreChildren).toBe(0)
        }
        if (directoryCase) {
          console.log(
            '[directory-projection-counts]',
            JSON.stringify({ count, directoryCalls, directoryItems })
          )
          expect(directoryCalls).toBeLessThanOrEqual(4)
          expect(directoryItems).toBeLessThanOrEqual(count * 4)
        }
        if (fault.startsWith('acknowledgement-'))
          expect(contentReads, 'pull acknowledgement must reuse installed transfer bytes').toBe(0)
        if (count >= 33000) {
          await collectHeap()
          console.log('native settled pull memory', process.memoryUsage())
          expect(process.memoryUsage().heapUsed).toBeLessThan(512 * 1024 * 1024)
          expect(process.memoryUsage().arrayBuffers).toBeLessThan(64 * 1024 * 1024)
        }
        if (fault === 'admission') expect(admissions).toBe(count)
        expect(downloads).toBe(count)
        if (fault === 'coordinated')
          expect([...capturedPaths].sort()).toEqual(items.map((item) => item.path).sort())
        if (fault === 'live-recovery') expect(recoveredLive).toBe(true)
        sample()
        if (fault === 'none') {
          console.log('[peer-pull-mutation-cost]', JSON.stringify(mutationCost))
          expect(mutations.size, 'finished pull retains no mutation promises').toBe(0)
          expect(mutationCost.removed).toBe(mutationCost.added)
          expect(
            mutationCost.peak,
            'bounded by the active cohort, not the vault'
          ).toBeLessThanOrEqual(256)
          expect(mutationCost.iterations, 'normal placement does not scan pause work').toBe(0)
          expect(
            mutationCost.added,
            'constant tracking work per installed file'
          ).toBeLessThanOrEqual(count * 16 + 64)
        }
        console.log(
          '[peer-pull-profile]',
          JSON.stringify({
            count,
            size,
            installed,
            commits,
            hostCommits,
            maxCommitBytes,
            fault,
            ...(clock ? { schedulerYields } : {}),
            elapsedMs: performance.now() - started,
            flushes: Object.fromEntries(flushes),
            rss,
          })
        )
        expect(report.applied).toBe(count)
        expect(report.held).toEqual([])
        // Budget backing stores reaching native writes, including small-buffer pool slack.
        // This does not claim to count VM metadata or copies which never reach the port.
        expect(payloadBackingBytes).toBeLessThanOrEqual(count * (size + 8192))
        for (const item of items) {
          expect(await sha256(await disk.readFile(join(root, item.path)))).toBe(item.sha)
          expect((await state.get(item.path))?.versionId).toBe(item.version_id)
        }
        // Bytes are flushed once; directory durability and ledger writes amortize over cohorts.
        expect([...flushes.values()].reduce((a, b) => a + b, 0)).toBeLessThan(count * 2 + 64)
        const batchLimit = Math.min(64, Math.max(1, Math.floor((16 * 1024 * 1024) / size)))
        const batches =
          Math.floor(count / 5000) * Math.ceil(5000 / batchLimit) +
          Math.ceil((count % 5000) / batchLimit)
        if (fault === 'coordinated') expect(captures).toBe(batches)
        expect(commits).toBeLessThanOrEqual(batches + Math.ceil(count / 5000) * 4 + 4)
        expect(hostCommits).toBeLessThanOrEqual(batches * 3 + 8)
        expect(maxCommitBytes).toBeLessThanOrEqual(Math.max(16 * 1024 * 1024, size))
        for (const [path, flushCount] of flushes) {
          if (path.endsWith('.tmp')) expect(flushCount).toBe(1)
          else expect(flushCount).toBeLessThanOrEqual(batches)
        }
        expect(await new WriteJournal(host).currentEntries()).toEqual([])
      } finally {
        channels?.mockRestore()
        clock?.mockRestore()
        state.close()
        host.close()
        await disk.rm(root, { recursive: true, force: true })
      }
    },
    // This is a persistence/payload work test, not a throughput benchmark.
    // The 33k case needs about 1,000 s alone and over 1,200 s with capped sibling work;
    // keep wall-time headroom while the per-batch commit, flush and byte bounds stay strict.
    process.env.PEER_PULL_FILES
      ? 3_600_000
      : fault === 'none'
        ? 2_700_000
        : fault === 'install-fingerprint-backlog' ||
            fault === 'path-candidates' ||
            fault === 'directory-projection' ||
            fault === 'directory-interruption'
          ? 120_000
          : 30_000
  )
