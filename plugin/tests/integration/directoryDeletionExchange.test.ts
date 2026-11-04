// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStateStore, SyncEngine, V2EngineClient } from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { selectiveFrom } from '@/sync/connection'
import { TokenEngines } from '@/sync/tokenEngines'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { IDBFactory } from 'fake-indexeddb'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { V2Client } from '@/sync/v2/client'
import { nativeVault } from '../helpers/nativeRestartVault'
import { TokenSyncLive } from '../e2e/helpers/tokenSyncLive'
import { connectionJournalApp } from '@/sync/connectionScope'
import {
  settleStoppedInstallationsForDeletion,
  requireExternalEnrollmentSafety,
} from '@/sync/external/pluginSafety'
import { WriteJournal } from '@/sync/writeJournal'

it(
  'retires the peer-deleted renamed folder with a settled whole-vault index',
  () => runExchange({ delivery: false, indexed: true }),
  30000
)

it.each([
  { name: 'delivers recipient creates and edits through the actual e2e cycle', delivery: true },
  { name: 'retires a renamed directory after its last remotely deleted child', delivery: false },
])('$name', runExchange)
// Four durable phases on two peers; this is not a single UI action's deadline.
it(
  'delivers a sixty-file server deletion and bulk restore to both native peers',
  () => runExchange({ delivery: false, bulk: true }),
  240000
)

async function runExchange({
  delivery,
  bulk,
  indexed,
}: {
  delivery: boolean
  bulk?: boolean
  indexed?: boolean
}) {
  const useIndex = bulk || indexed
  const apps: ReturnType<typeof nativeVault>[] = []
  const hosts: ReturnType<typeof tokenHostFixture>[] = []
  if (useIndex)
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    })
  const server = await v2Server()
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-directory-delete-')))
  const engines: SyncEngine[] = []
  const refreshers: ((path: string) => Promise<void>)[] = []
  const removals = new Map<string, number>()
  const cycles: { device: number; phase: string; elapsedMs: number }[] = []
  const durability = new Map<string, { calls: number; totalMs: number; maxMs: number }>()
  let phase = 'initial',
    operations = 0,
    latest = ''
  const timer = bulk
    ? setInterval(
        () =>
          console.debug('[sample bulk progress]', {
            phase,
            operations,
            latest,
            removedPaths: removals.size,
            removalAttempts: [...removals.values()].reduce((sum, n) => sum + n, 0),
            states: engines.map((one) => one.status),
          }),
        10000
      )
    : undefined
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    for (const name of ['primary', 'peer']) {
      const home = join(root, name)
      await disk.mkdir(indexed ? home : join(home, 'Sample'), { recursive: true })
      const app = nativeVault(home, disk)
      apps.push(app)
      if (indexed) {
        const remove = app.vault.delete.bind(app.vault)
        app.vault.delete = async (file) => {
          if ('children' in file) await app.vault.adapter.rmdir(file.path, true)
          await remove(file)
          app.emit('vault', 'delete', file)
        }
      }
      if (indexed) {
        const stat = app.vault.adapter.stat.bind(app.vault.adapter)
        app.vault.adapter.stat = async (path) => {
          const info = await stat(path)
          return info && { ...info, ctime: Math.round(info.ctime), mtime: Math.round(info.mtime) }
        }
      }
      if (indexed)
        await disk.writeFile(
          join(home, '.abele-sync-ignore'),
          '*\n!Sample/\n!Sample/**\n.obsidian/\n'
        )
      if (useIndex) {
        // The host's current folder children outlive content-indexing work.
        let busyUntil = 0
        Object.assign(app.metadataCache, {
          initialized: true,
          isCacheClean: () => Date.now() >= busyUntil,
        })
        if (!indexed) await app.vault.createFolder('Sample')
        const refresh = async (path: string) => {
          if (!path.startsWith('Sample/')) return
          const file = app.vault.getFileByPath(path)
          const stat = await disk.stat(join(home, path)).catch((error: unknown) => {
            if ((error as { code?: string }).code === 'ENOENT') return null
            throw error
          })
          if (!stat) {
            if (file) {
              await app.vault.delete(file)
              app.emit('vault', 'delete', file)
            }
          } else if (stat.isFile()) {
            const row =
              file ?? (await app.vault.create(path, await disk.readFile(join(home, path), 'utf8')))
            Object.assign(row.stat, {
              size: stat.size,
              mtime: stat.mtimeMs,
              ctime: stat.birthtimeMs,
            })
            app.emit('vault', file ? 'modify' : 'create', row)
          }
          busyUntil = Date.now() + 20
        }
        Object.assign(app.vault.adapter, { reconcileInternalFile: refresh })
        refreshers.push(refresh)
      }
      if (indexed) {
        const fixture = tokenHostFixture(globalThis.fetch, [], { app, factory: new IDBFactory() })
        fixture.registry.forget(fixture.id)
        fixture.id = fixture.registry.add()
        const token = decodeAccessToken(user.token)
        const authority = await new V2EngineClient(user.token, {
          fetch: globalThis.fetch,
        }).connection()
        fixture.registry.attach(fixture.id, token, authority, {
          get: (key) => fixture.keys.get(key) ?? null,
          set: (key, value) => {
            fixture.keys.set(key, value)
          },
          remove: (key) => {
            fixture.keys.delete(key)
          },
        })
        await fixture.host.close(false)
        fixture.host = new TokenEngines(
          app as never,
          fixture.ui,
          (key) => fixture.keys.get(key) ?? null,
          {
            indexedDB: fixture.factory,
            fetch: globalThis.fetch,
            fallbackMs: 60000,
            pollMs: 60000,
            WebSocket: class {
              constructor() {
                throw new Error('Fixture uses polling')
              }
            } as never,
          }
        )
        hosts.push(fixture)
        fixture.host.start()
        await fixture.ui.connectionsChanged()
        await vi.waitFor(
          () => expect(fixture.host.live.get(fixture.id)?.engine.status.state).toBe('idle'),
          { timeout: 10000 }
        )
        engines.push(fixture.host.live.get(fixture.id)!.engine)
        // Keep watcher proofs, but drive exchanges explicitly so an extra watcher
        // cycle cannot accidentally finish a parent deferred by the requested cycle.
        Reflect.set(engines.at(-1)!, 'trigger', () => {})
        continue
      }
      const files = new ObsidianFileSystem(app as never, {
        fileScope: 'Sample',
        journalOwner: name,
        connectionId: name,
        preserveEmptyDirectories: true,
        ...(useIndex ? { prepareStartupInventory: async () => {} } : {}),
        ...(bulk
          ? {
              diagnostic: (
                operation: string,
                _at: number,
                outcome: string,
                paths?: readonly string[]
              ) => {
                operations++
                latest = operation + ':' + outcome + ':' + paths?.[0]
                if (operation === 'native sync' && outcome === 'complete') {
                  const key = name + ':' + phase
                  const row = durability.get(key) ?? { calls: 0, totalMs: 0, maxMs: 0 }
                  const elapsed = Date.now() - _at
                  row.calls++
                  row.totalMs += elapsed
                  row.maxMs = Math.max(row.maxMs, elapsed)
                  durability.set(key, row)
                }
              },
            }
          : {}),
      })
      if (useIndex) await files.waitForStartupIndex()

      if (bulk) {
        const conditional = files.conditionalFile.bind(files)
        files.conditionalFile = async (operation) => {
          if (
            operation.path.startsWith('Sample/bulk/') &&
            ['move', 'remove'].includes(operation.effect.kind)
          ) {
            const key = name + ':' + operation.path
            removals.set(key, (removals.get(key) ?? 0) + 1)
          }
          return conditional(operation)
        }
      }
      engines.push(
        new SyncEngine({
          fs: coordinatedFileSystem(files, new PathCoordinator()),
          state: new MemoryStateStore(),
          client: new V2EngineClient(user.token, { fetch: globalThis.fetch }),
          selective: selectiveFrom(undefined),
          log: (message) => console.debug('[sample directory exchange]', name, message),
        })
      )
    }
    // Exercise the actual e2e round-trip helper and native adapters, rather than
    // supplying a correct head callback which could mask its protocol mistake.
    const sync = async (device: number) => {
      const started = Date.now()
      if (indexed) await hosts[device].ui.sync(hosts[device].id)
      else await engines[device].sync()
      if (bulk) cycles.push({ device, phase, elapsedMs: Date.now() - started })
    }
    const cycle = () =>
      TokenSyncLive.prototype.cycle.call({
        client: () => new V2EngineClient(user.token, { fetch: globalThis.fetch }),
        primary: { syncNow: () => sync(0) },
        peer: { syncNow: () => sync(1) },
      } as unknown as TokenSyncLive)
    if (indexed) await cycle()
    await disk.mkdir(join(root, 'primary/Sample/from'), { recursive: true })
    await disk.writeFile(join(root, 'primary/Sample/from/sample.md'), 'sample')
    if (useIndex) await refreshers[0]('Sample/from/sample.md')
    await cycle()
    if (bulk) {
      phase = 'upload sixty'
      await disk.mkdir(join(root, 'primary/Sample/bulk'))
      for (let i = 0; i < 60; i++)
        await disk.writeFile(join(root, `primary/Sample/bulk/note-${i}.md`), 'sample restore bytes')
      for (let i = 0; i < 60; i++) await refreshers[0](`Sample/bulk/note-${i}.md`)
      await cycle()
      phase = 'delete sixty'
      const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      const items = (await client.manifest(null)).items.filter((item) =>
        item.path.startsWith('Sample/bulk/')
      )
      expect(items).toHaveLength(60)
      const started = Date.now()
      await client.commit(
        items.map((item) => ({
          op: 'delete' as const,
          file_id: item.file_id,
          base_version_id: item.version_id,
        })),
        crypto.randomUUID()
      )
      await cycle()
      phase = 'restore sixty'
      expect(await disk.readdir(join(root, 'peer/Sample/bulk')).catch(() => [])).toEqual([])
      await client.restoreDeletedMany(items.map((item) => item.file_id))
      phase = 'pull restored sixty'
      await cycle()
      for (const name of ['primary', 'peer'])
        for (let i = 0; i < 60; i++)
          expect(await disk.readFile(join(root, `${name}/Sample/bulk/note-${i}.md`), 'utf8')).toBe(
            'sample restore bytes'
          )
      console.debug('[sample native bulk restore]', { elapsedMs: Date.now() - started })
      expect(removals.size).toBe(120)
      expect([...removals.values()].reduce((sum, n) => sum + n, 0)).toBe(120)
      console.debug('[sample native bulk cycles]', cycles)
      console.debug('[sample native bulk durability]', Object.fromEntries(durability))
      return
    }
    if (delivery) {
      await disk.writeFile(join(root, 'peer/Sample/recipient.md'), 'recipient creates')
      await cycle()
      expect(await disk.readFile(join(root, 'primary/Sample/recipient.md'), 'utf8')).toBe(
        'recipient creates'
      )
      await disk.writeFile(join(root, 'peer/Sample/recipient.md'), 'recipient edits')
      await cycle()
      expect(await disk.readFile(join(root, 'primary/Sample/recipient.md'), 'utf8')).toBe(
        'recipient edits'
      )
      return
    }
    if (indexed) await apps[1].vault.adapter.rename('Sample/from', 'Sample/to')
    else await disk.rename(join(root, 'peer/Sample/from'), join(root, 'peer/Sample/to'))
    if (indexed) {
      const folder = apps[1].vault.getAbstractFileByPath('Sample/from')!
      await apps[1].vault.rename(folder, 'Sample/to')
      apps[1].emit('vault', 'rename', folder, 'Sample/from')
    }
    await cycle()
    expect(await disk.readFile(join(root, 'primary/Sample/to/sample.md'), 'utf8')).toBe('sample')
    if (indexed) {
      const folder = apps[1].vault.getAbstractFileByPath('Sample/to')!
      await apps[1].vault.delete(folder)
      // Deliver the complete host batch before scanning, as on a busy live vault.
      await vi.waitFor(() =>
        expect(Reflect.get(engines[1], 'watch').noticed.has('Sample/to')).toBe(true)
      )
      await hosts[1].ui.sync(hosts[1].id)
      const manifest = await new V2Client(
        decodeAccessToken(user.token),
        globalThis.fetch
      ).manifest()
      expect(manifest.items.some((item) => item.path === 'Sample/to')).toBe(false)
      expect(engines[1].status.headSeq).toBe(manifest.cursor)
      expect(engines[1].status.cursor).toBe(manifest.cursor)
    } else await disk.rm(join(root, 'peer/Sample/to'), { recursive: true })
    await cycle()
    expect(await disk.stat(join(root, 'primary/Sample/to')).catch(() => null)).toBeNull()
    expect(await disk.stat(join(root, 'primary/Sample/from')).catch(() => null)).toBeNull()
  } catch (error) {
    console.debug('[sample bulk failure]', { phase, operations, latest, error })
    throw error
  } finally {
    if (timer !== undefined) clearInterval(timer)
    for (const fixture of hosts) await fixture.host.close()
    for (const engine of engines) await engine.stop()
    await server.close()
    await disk.rm(root, { recursive: true, force: true })
  }
}

it('finishes a whole-vault native installation interrupted before its SDK acknowledgement', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-native-departure-')))
  try {
    const app = nativeVault(root, disk),
      owner = 'sample-in-flight'
    const fs = new ObsidianFileSystem(app as never, { journalOwner: owner })
    expect(
      await fs.conditionalFile({
        path: 'Sample/kept.md',
        expected: null,
        effect: {
          kind: 'write',
          bytes: new TextEncoder().encode('native incoming bytes'),
          mtime: 1000,
          receipt: 'sample-native',
        },
      })
    ).toBe(true)
    const view = connectionJournalApp(app as never, owner)
    const journal = new WriteJournal(view, undefined, owner)
    expect(await journal.currentEntries()).toHaveLength(1)
    // Stop before the pull ledger acknowledges this receipt, as departure does
    // during an initial download. Both the public name and private alias exist.
    await settleStoppedInstallationsForDeletion(view, () => {})
    expect(await journal.currentEntries()).toEqual([])
    const [kept] = await journal.currentRecovered()
    expect(kept.archived).toBe(true)
    expect(await disk.readFile(join(root, kept.backup), 'utf8')).toBe('native incoming bytes')
    expect(await disk.readFile(join(root, 'Sample/kept.md'), 'utf8')).toBe('native incoming bytes')
    await new ObsidianFileSystem(app as never, { journalOwner: owner }).recover()
    await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
})
