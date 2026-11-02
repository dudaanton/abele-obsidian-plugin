// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { ExpectedWrites, MAX_CHUNK_BYTES, V2EngineClient, pull } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { nativeVault, countTransactions } from '../helpers/nativeRestartVault'

it('pulls 256 MiB through one suffix response with bounded durable native appends', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-large-pull-')))
  const server = await v2Server()
  const factory = new IDBFactory()
  const transactions = countTransactions(factory)
  const state = await IndexedDbStateStore.open(factory, 'sample-large-pull')
  let host: HostSyncStorage | undefined
  const size = 256 * MAX_CHUNK_BYTES
  // The fixture defaults to a 200 MiB limit; this case exercises a larger transfer.
  server.config.maxFileBytes = size
  const chunk = new Uint8Array(MAX_CHUNK_BYTES).fill(73)
  const digest = createHash('sha256')
  for (let i = 0; i < 256; i++) digest.update(chunk)
  const sha = digest.digest('hex')
  const counts = { requests: 0, writes: 0, writtenBytes: 0, dataSyncs: 0, otherSyncs: 0 }
  const ranges: (string | null)[] = []
  // Only the peer port is instrumented: server blob-store writes are setup work.
  const native = {
    ...disk,
    open: async (...args: Parameters<typeof disk.open>) => {
      const handle = await disk.open(...args)
      const path = String(args[0])
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'write')
            return async (
              bytes: Uint8Array,
              offset?: number,
              length?: number,
              position?: number
            ) => {
              expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
              const result = await target.write(bytes, offset, length, position)
              counts.writes++
              counts.writtenBytes += result.bytesWritten
              return result
            }
          if (key === 'sync')
            return async () => {
              if (path.endsWith('.tmp')) counts.dataSyncs++
              else counts.otherSyncs++
              await target.sync()
            }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
  desktopFsPort(native)
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    await server.db
      .updateTable('spaces')
      .set({ settings: JSON.stringify({ max_file_bytes: size }) })
      .execute()
    const sender = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    await sender.putBlobSource(
      { size, sha },
      {
        size,
        read: async (_offset, length) => {
          expect(length).toBeLessThanOrEqual(MAX_CHUNK_BYTES)
          return chunk.subarray(0, length)
        },
        assertUnchanged: async () => {},
        close: async () => {},
      }
    )
    await sender.commitRaw(
      [{ op: 'create', path: 'sample-large.bin', sha, size, mtime: 1000 }],
      crypto.randomUUID()
    )
    const receiver = new V2EngineClient(user.token, {
      fetch: async (url, init) => {
        const range = new Headers(init?.headers).get('Range')
        if (range) {
          counts.requests++
          ranges.push(range)
        }
        return globalThis.fetch(url, init)
      },
    })
    await receiver.connection()
    const app = nativeVault(root, native)
    host = await HostSyncStorage.open(factory, 'sample-large-pull', app)
    const files = new ObsidianFileSystem(app as unknown as App, { storage: host, ledger: state })
    state.observeCommittedEntries((entries) => files.acknowledgeWrites(entries))
    await files.recover()
    const beforeTransactions = { ...transactions }
    const started = performance.now()
    const report = await pull(receiver, files, state, {
      dirty: new Set(),
      expected: new ExpectedWrites(),
      filter: { excluded: () => false },
    })
    const elapsedMs = performance.now() - started
    console.log(
      '[native-large-pull]',
      JSON.stringify({
        ...counts,
        readTransactions: transactions.readonly - beforeTransactions.readonly,
        writeTransactions: transactions.readwrite - beforeTransactions.readwrite,
        elapsedMs,
        mibPerSecond: 256000 / elapsedMs,
      })
    )
    expect(report.held).toEqual([])
    expect(report.applied).toBe(1)
    // One continuous suffix response replaces 256 independently fetched MiB ranges.
    expect(ranges).toEqual([`bytes=0-${size - 1}`])
    expect(counts.requests).toBe(1)
    // Native installation batches retain durable ownership, then flush the sealed
    // inode once before publication; they do not acknowledge durable chunk offsets.
    // Standalone streaming stages retain their per-append durability barriers.
    expect(counts.dataSyncs).toBe(1)
    expect(transactions.readwrite - beforeTransactions.readwrite).toBeLessThanOrEqual(16)
    expect(counts.writes).toBeGreaterThanOrEqual(256)
    expect(counts.writes).toBeLessThanOrEqual(264)
    expect(counts.otherSyncs).toBeLessThanOrEqual(32)
    expect(counts.writtenBytes).toBe(size)
    const installed = createHash('sha256')
    for await (const bytes of createReadStream(join(root, 'sample-large.bin')))
      installed.update(bytes)
    expect(installed.digest('hex')).toBe(sha)
    expect((await state.get('sample-large.bin'))?.sha).toBe(sha)
  } finally {
    state.close()
    host?.close()
    await server.close()
    await disk.rm(root, { recursive: true, force: true })
  }
}, 300000)
