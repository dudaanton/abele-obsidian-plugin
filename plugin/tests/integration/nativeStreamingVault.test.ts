// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

// Per-barrier fsync table: [cold hierarchy, steady replacement]. These include
// retained-victim and retirement durability, not only the three stage data flushes.
const conditional = '.obsidian/plugins/abele/sync-conditional/'
// Each case awaits 82 real durability barriers plus native reads and cleanup.
// Allow disk contention; the exact barrier table and byte assertions bound the work.
const nativeIoTimeout = 30_000
const barriers: Record<string, readonly [number, number]> = {
  '.obsidian/plugins/abele/sync-staging/<stage>': [3, 3],
  '.obsidian/plugins/abele/sync-staging': [2, 2],
  '.obsidian/plugins/abele': [2, 0],
  '.obsidian/plugins': [1, 0],
  '.obsidian': [1, 0],
  '': [3, 2],
  'sample.bin': [1, 1],
  [conditional.slice(0, -1)]: [5, 0],
  [conditional + 'objects']: [2, 2],
  // Immutable pointer aliases share flushed intent contents; the allocation
  // sentinel needs no extra content flush, and parallel namespace barriers coalesce.
  [conditional + 'objects/<op>']: [4, 4],
  [conditional + 'objects/<op>/allocation']: [1, 1],
  [conditional + 'objects/<op>/intent.json']: [1, 1],
  [conditional + 'objects/<op>/victim']: [1, 1],
  [conditional + 'objects/<op>/complete']: [1, 1],
  [conditional + 'active/<op>.json']: [0, 0],
  [conditional + 'active']: [2, 2],
  [conditional + 'retained/<op>.json']: [1, 1],
  [conditional + 'retained']: [1, 1],
  [conditional + 'trash/<op>/victim']: [1, 1],
  [conditional + 'trash/<op>']: [2, 2],
  [conditional + 'trash']: [1, 1],
  [conditional + 'trash/<op>/ready']: [1, 1],
  [conditional + 'completed/<op>.json']: [0, 0],
  [conditional + 'completed']: [1, 1],
  [conditional + 'retiring/<op>.json']: [1, 1],
  [conditional + 'retiring']: [2, 2],
}

async function measure(recordsOnly = false) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'sample-streaming-')))
  const app = buildFakeVault([])
  const chunk = new Uint8Array(1024 * 1024).fill(27)
  const synced = new Map<string, number>()
  const acknowledged = new Set<string>()
  let syncs = 0,
    queued = false,
    published = false
  try {
    await fs.writeFile(join(root, 'sample.bin'), chunk)
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      mkdir: async (path: string) => {
        await fs.mkdir(join(root, path), { recursive: true })
      },
      fsPromises: {
        ...fs,
        link: async (from: string, to: string) => {
          await fs.link(from, to)
          // An immutable intent's hard-link alias shares its acknowledged inode
          // contents. The separate active-directory barrier is still counted.
          if (acknowledged.has(from)) acknowledged.add(to)
        },
        open: async (path: string, flags: string) => {
          const handle = await fs.open(path, flags)
          return {
            stat: () => handle.stat(),
            truncate: (length: number) => handle.truncate(length),
            utimes: (atime: number, mtime: number) => handle.utimes(atime, mtime),
            read: (bytes: Uint8Array, offset: number, length: number, position: number) => {
              expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
              return handle.read(bytes, offset, length, position)
            },
            write: (bytes: Uint8Array, offset: number, length: number, position: number) => {
              expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
              return handle.write(bytes, offset, length, position)
            },
            sync: async () => {
              synced.set(path, (synced.get(path) ?? 0) + 1)
              syncs++
              await handle.sync()
              acknowledged.add(path)
            },
            close: () => handle.close(),
          }
        },
        rename: async (from: string, to: string) => {
          expect(queued).toBe(true)
          if (from === join(root, 'sample.bin')) {
            expect([...acknowledged].some((path) => path.endsWith('/intent.json'))).toBe(true)
            expect(
              [...acknowledged].some((path) => path.includes('/sync-conditional/active/'))
            ).toBe(true)
          }
          published = true
          await fs.rename(from, to)
        },
      },
      stat: async (path: string) => {
        try {
          const stat = await fs.stat(join(root, path))
          return {
            type: stat.isFile() ? 'file' : 'folder',
            size: stat.size,
            mtime: stat.mtimeMs,
            ctime: stat.ctimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      exists: async (path: string) => {
        try {
          await fs.stat(join(root, path))
          return true
        } catch {
          return false
        }
      },
      list: async () => ({ files: ['sample.bin'], folders: [] }),
      readBinary: async () => {
        throw new Error('whole-file read')
      },
      queue: async <T>(work: () => Promise<T>) => {
        queued = true
        try {
          return await work()
        } finally {
          queued = false
        }
      },
    })
    desktopFsPort(Reflect.get(app.vault.adapter, 'fsPromises'))
    const writer = new ObsidianFileSystem(app as unknown as App)
    for (const iteration of [0, 1]) {
      synced.clear()
      syncs = 0
      published = false
      const base = await writer.fingerprint('sample.bin')
      const stage = await writer.beginAtomicWrite('sample.bin', 2000, base)
      await stage.append(0, chunk)
      await stage.append(chunk.length, chunk)
      const expected = await writer.fingerprint(stage.id)
      await stage.seal(expected)
      await stage.commit()
      await stage.discard()
      expect(published).toBe(true)
      console.log('[native durable paths]', { iteration, syncs, paths: Object.fromEntries(synced) })
      if (recordsOnly) {
        const records = [...synced].filter(([path]) => path.endsWith('.json'))
        expect(records.length).toBeGreaterThan(0)
        for (const [, count] of records) expect(count).toBe(1)
      } else {
        const actual = Object.fromEntries(
          [...synced].map(([path, count]) => [
            path
              .slice(root.length + 1)
              .replace(/\.abele-sync-[^/]+\.tmp/, '<stage>')
              .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, '<op>'),
            count,
          ])
        )
        const expected = Object.fromEntries(
          Object.entries(barriers)
            .map(([path, counts]) => [path, counts[iteration]])
            .filter(([, count]) => count !== 0)
        )
        if (iteration === 0) {
          // Independent namespace barriers may share their common ancestor's
          // in-flight cohort. All content barriers below remain exact; allow
          // only that one scheduling-dependent overlap, under a tighter total.
          const parent = conditional.slice(0, -1)
          expect(actual[parent]).toBeGreaterThanOrEqual(5)
          expect(actual[parent]).toBeLessThanOrEqual(6)
          expected[parent] = actual[parent]
        }
        expect(actual).toEqual(expected)
        if (iteration === 0) expect(syncs).toBeLessThanOrEqual(42)
        else expect(syncs).toBe(31)
      }
      expect(await writer.fingerprint('sample.bin')).toMatchObject({
        sha: expected.sha,
        size: 2 * chunk.length,
        mtime: 2000,
      })
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

it(
  'appends, fsyncs, dates and replaces a native stage with bounded buffers inside the save queue',
  () => measure(),
  nativeIoTimeout
)
it(
  'flushes each immutable conditional record once before publication',
  () => measure(true),
  nativeIoTimeout
)
