import { afterEach, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import type { App, DataAdapter } from 'obsidian'
import { sha256 } from '@noble/hashes/sha2'
import {
  ExpectedWrites,
  MemoryStateStore,
  push,
  type EngineClient,
  sha256 as digest,
} from '@abele/sync-sdk/core'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { privatePlacementStages } from '@/sync/privatePlacementStages'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { JOURNAL_KEY, WriteJournal } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
  'recovers an owned pull stage with installed edits (published=%s)',
  async (published) => {
    const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'local edit' }])
    const privateRoot = connectionPrivateRoot('sample')
    const make = () => {
      const disk = new ObsidianFileSystem(app as unknown as App, {
        adapter: connectionAdapter(app.vault.adapter, 'Shared', privateRoot),
        connectionId: 'sample',
        fileScope: 'Shared',
      })
      return {
        disk,
        scoped: scopedFileSystem(
          disk,
          (path) => {
            if (!path.startsWith('Shared/')) throw new Error('outside scope')
          },
          (path) => path.startsWith('Shared/'),
          privateRoot
        ),
      }
    }
    const foreign = { owner: 'other', target: 'Other/kept.md', temp: 'Other/kept.tmp' }
    app.saveLocalStorage(JOURNAL_KEY, [foreign])
    const first = make()
    const stage = await first.scoped.beginAtomicWrite!('Shared/sample.md', 1000, null)
    const bytes = new TextEncoder().encode('incoming version')
    await stage.append(0, bytes.slice(0, 4))
    if (published) await app.vault.adapter.remove(stage.id)
    const restarted = make()
    await restarted.disk.recover()
    const recovery = await Reflect.get(
      restarted.scoped,
      Symbol.for('abele.sync.recover-published-pull-v1')
    )(stage.id, 'Shared/sample.md', 1000, null)
    expect(recovery.id.startsWith(privateRoot + '/writes/')).toBe(true)
    expect(await restarted.scoped.stat(recovery.id)).not.toBeNull()
    await recovery.append(recovery.offset, bytes.slice(recovery.offset))
    await recovery.seal({ size: bytes.length, sha: await digest(bytes) })
    await recovery.commit()
    await recovery.discard()
    expect(await app.vault.adapter.read('Shared/sample.md')).toBe('incoming version')
    const journal = new WriteJournal(app, undefined, 'sample')
    expect(journal.entries()).toEqual([])
    expect(journal.recovered()).toHaveLength(1)
    const retained = journal.recovered()[0]
    expect(retained.owner).toBe('sample')
    expect(retained.backup.startsWith(privateRoot + '/writes/')).toBe(true)
    expect(await app.vault.adapter.read(retained.backup)).toBe('local edit')
    expect(new WriteJournal(app).entries()).toEqual([foreign])
  }
)

it('cleans a committed private outbox download without applying user-directory bookkeeping', async () => {
  const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'kept' }])
  const privateRoot = connectionPrivateRoot('sample')
  const adapter = connectionAdapter(app.vault.adapter, 'Shared', privateRoot)
  const fs = new ObsidianFileSystem(app as unknown as App, {
    adapter,
    connectionId: 'sample',
    fileScope: 'Shared',
    preserveEmptyDirectories: true,
  })
  const stages = privatePlacementStages(fs, privateRoot)
  const path = '.abele-sync/placement-outbox/' + 'a'.repeat(64) + '/' + 'b'.repeat(64)
  await stages.writeAtomic(path, new Uint8Array([1, 2]), 1000)
  expect(await stages.read(path)).toEqual(new Uint8Array([1, 2]))
  const source = await stages.openRead(path)
  expect(await source.read(0, 2)).toEqual(new Uint8Array([1, 2]))
  await source.close()
  await stages.remove(path)
  expect(await app.vault.adapter.exists(privateRoot + path.slice('.abele-sync'.length))).toBe(false)
  expect(await app.vault.adapter.read('Shared/sample.md')).toBe('kept')
})

it('pulls and uploads more than 50 MiB with mobile bounded reads inside the owned folder boundary', async () => {
  const MiB = 1024 * 1024,
    size = 51 * MiB + 13
  const chunk = new Uint8Array(MiB).fill(7)
  const encodedChunk = Buffer.from(chunk.buffer).toString('base64')
  const readBytes = new Map<string, number>()
  let readCalls = 0
  const privateRoot = connectionPrivateRoot('sample')
  const files = new Map<string, { size: number; bytes?: Uint8Array; mtime: number }>([
    ['Shared/upload.bin', { size, mtime: 1000 }],
  ])
  const folders = new Set(['Shared'])
  const calls: string[] = []
  const app = buildFakeVault([])
  const record = (path: string) => {
    calls.push(path)
  }
  const raw = {
    getFullPath: (path: string) => 'file:///sample/' + path,
    exists: async (path: string) => {
      record(path)
      return files.has(path) || folders.has(path)
    },
    stat: async (path: string) => {
      record(path)
      const file = files.get(path)
      return file
        ? { type: 'file', size: file.size, mtime: file.mtime, ctime: 1000 }
        : folders.has(path)
          ? { type: 'folder', size: 0, mtime: 1000, ctime: 1000 }
          : null
    },
    mkdir: async (path: string) => {
      record(path)
      folders.add(path)
    },
    list: async (path: string) => {
      record(path)
      return {
        files: [...files.keys()].filter((name) => name.slice(0, name.lastIndexOf('/')) === path),
        folders: [],
      }
    },
    writeBinary: async (path: string, bytes: ArrayBuffer, options?: { mtime?: number }) => {
      record(path)
      expect(bytes.byteLength).toBeLessThanOrEqual(MiB)
      files.set(path, {
        size: bytes.byteLength,
        bytes: new Uint8Array(bytes),
        mtime: options?.mtime ?? 1000,
      })
    },
    appendBinary: async (path: string, bytes: ArrayBuffer, options?: { mtime?: number }) => {
      record(path)
      expect(bytes.byteLength).toBeLessThanOrEqual(MiB)
      const file = files.get(path)!
      file.size += bytes.byteLength
      file.bytes = undefined
      file.mtime = options?.mtime ?? file.mtime
    },
    rename: async (from: string, to: string) => {
      record(from)
      record(to)
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    remove: async (path: string) => {
      record(path)
      files.delete(path)
    },
    readBinary: async (path: string) => {
      record(path)
      const file = files.get(path)!
      if (file.size > MiB) throw new Error('whole-file read forbidden')
      return (file.bytes ?? new Uint8Array(file.size).fill(7)).buffer
    },
  } as unknown as DataAdapter
  Object.assign(app.vault.adapter, raw)
  // Count calls without retaining each large base64 response in mock history.
  const readFile = async ({
    path,
    offset,
    length,
  }: {
    path: string
    offset: number
    length: number
  }) => {
    expect(length).toBeLessThanOrEqual(MiB)
    const local = path.slice('file:///sample/'.length)
    record(local)
    const file = files.get(local)!
    const bytes = file.bytes
      ? file.bytes.subarray(offset, offset + length)
      : chunk.subarray(0, Math.min(length, file.size - offset))
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MiB)
    readCalls++
    readBytes.set(local, (readBytes.get(local) ?? 0) + bytes.length)
    return {
      data:
        !file.bytes && bytes.length === MiB
          ? encodedChunk
          : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    }
  }
  vi.stubGlobal('Capacitor', {
    Plugins: {
      Filesystem: {
        stat: async ({ path }: { path: string }) => ({
          size: files.get(path.slice('file:///sample/'.length))!.size,
        }),
        readFile,
      },
    },
  })
  const fs = new ObsidianFileSystem(app as unknown as App, {
    adapter: connectionAdapter(app.vault.adapter, 'Shared', privateRoot),
    connectionId: 'sample',
    fileScope: 'Shared',
    preserveEmptyDirectories: true,
  })
  const hash = sha256.create()
  for (let offset = 0; offset < size; offset += MiB)
    hash.update(chunk.subarray(0, Math.min(MiB, size - offset)))
  const expectedSha = Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join('')
  const state = new MemoryStateStore()
  const includes = (path: string) => path === 'Shared' || path.startsWith('Shared/')
  const scoped = scopedFileSystem(
    fs,
    (path) => {
      if (!includes(path)) throw new Error('outside scope')
    },
    includes,
    privateRoot
  )
  const upload = vi.fn(async (_expected, source) => {
    const hash = sha256.create()
    for (let offset = 0; offset < source.size; offset += MiB) {
      const bytes = await source.read(offset, Math.min(MiB, source.size - offset))
      expect(bytes.length).toBe(Math.min(MiB, source.size - offset))
      expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MiB)
      hash.update(bytes)
    }
    await source.assertUnchanged()
    expect(Array.from(hash.digest(), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(
      expectedSha
    )
  })
  const report = await push(
    {
      hasBlob: async () => false,
      putBlobSource: upload,
      commitRaw: async () => ({
        replayed: false,
        body: {
          head_seq: 1,
          results: [
            {
              status: 'applied',
              file_id: 'local-file',
              version_id: 'local-version',
              path: 'Shared/upload.bin',
              sha: expectedSha,
              size,
              mtime: 1000,
            },
          ],
        },
      }),
    } as unknown as EngineClient,
    scoped,
    state,
    {
      ops: [
        {
          op: 'create',
          path: 'Shared/upload.bin',
          kind: 'attachment',
          sha: expectedSha,
          size,
          mtime: 1000,
        },
      ],
      hashes: new Map([['Shared/upload.bin', expectedSha]]),
      diskPaths: new Map([['Shared/upload.bin', 'Shared/upload.bin']]),
      infos: new Map([['Shared/upload.bin', { path: 'Shared/upload.bin', size, mtime: 1000 }]]),
      dirty: new Set(['Shared/upload.bin']),
      skipped: [],
      collisions: [],
    },
    { expected: new ExpectedWrites() }
  )
  expect(report.applied).toBe(1)
  expect(upload).toHaveBeenCalledOnce()
  const placer = new PullPlacer(
    {
      getBlob: async () => {
        throw new Error('whole-file download forbidden')
      },
      openVersion: async () => fs.openRead('Shared/upload.bin'),
    },
    scoped,
    state,
    {
      dirty: new Set(),
      expected: new ExpectedWrites(),
      filter: { excluded: () => false },
    },
    digest
  )
  await placer.place(
    {
      seq: 1,
      file_id: 'remote-file',
      version_id: 'remote-version',
      path: 'Shared/download.bin',
      prev_path: null,
      op: 'create',
      kind: 'attachment',
      sha: expectedSha,
      size,
      mtime: 1000,
      at: '2025-01-01T00:00:00Z',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    },
    expectedSha,
    null,
    new Map(),
    new Map()
  )
  expect(await state.get('Shared/download.bin')).toMatchObject({ size, sha: expectedSha })
  expect(await fs.stat('Shared/download.bin')).toMatchObject({ size })
  expect(readCalls).toBeGreaterThan(0)
  expect(readBytes.get('Shared/upload.bin')).toBeGreaterThanOrEqual(size)
  expect(
    [...readBytes]
      .filter(([path]) => path.startsWith(privateRoot + '/'))
      .reduce((sum, [, bytes]) => sum + bytes, 0)
  ).toBeGreaterThanOrEqual(size)
  expect(
    calls.filter(
      (path) =>
        path !== 'Shared' &&
        !path.startsWith('Shared/') &&
        !path.startsWith(privateRoot + '/') &&
        !['.abele-sync', '.abele-sync/connections', privateRoot].includes(path)
    )
  ).toEqual([])
  // Real base64 decoding and SHA-256 traverse multiple full transfers. The timeout
  // accommodates shared runners; bounded buffer sizes and byte counts prove the contract.
}, 120000)
