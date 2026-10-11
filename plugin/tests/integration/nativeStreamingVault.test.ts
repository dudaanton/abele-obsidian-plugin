// @vitest-environment node
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('appends, fsyncs, dates and replaces a native stage with bounded buffers inside the save queue', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-streaming-'))
  const app = buildFakeVault([])
  const chunk = new Uint8Array(1024 * 1024).fill(27)
  let syncs = 0,
    queued = false,
    published = false
  try {
    await fs.writeFile(join(root, 'sample.bin'), chunk)
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: {
        ...fs,
        open: async (path: string, flags: string) => {
          const handle = await fs.open(path, flags)
          return {
            read: (bytes: Uint8Array, offset: number, length: number, position: number) => {
              expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
              return handle.read(bytes, offset, length, position)
            },
            write: (bytes: Uint8Array, offset: number, length: number, position: number) => {
              expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
              return handle.write(bytes, offset, length, position)
            },
            sync: async () => {
              syncs++
              await handle.sync()
            },
            close: () => handle.close(),
          }
        },
        rename: async (from: string, to: string) => {
          expect(queued).toBe(true)
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
    const writer = new ObsidianFileSystem(app as unknown as App)
    const base = await writer.fingerprint('sample.bin')
    const stage = await writer.beginAtomicWrite('sample.bin', 2000, base)
    await stage.append(0, chunk)
    await stage.append(chunk.length, chunk)
    const expected = await writer.fingerprint(stage.id)
    await stage.seal(expected)
    await stage.commit()
    await stage.discard()
    expect(published).toBe(true)
    expect(syncs).toBe(3)
    expect(await writer.fingerprint('sample.bin')).toMatchObject({
      sha: expected.sha,
      size: 2 * chunk.length,
      mtime: 2000,
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
