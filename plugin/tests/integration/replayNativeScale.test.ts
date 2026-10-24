// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  EngineError,
  MemoryStateStore,
  SyncEngine,
  sha256,
  type ChunkSource,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { selectiveFrom } from '@/sync/connection'
import { buildFakeVault } from '../helpers/fakeVault'

it('reaches the resumed upload within five seconds in a 33k native vault with an unready index', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-replay-')))
  const count = 33000
  const paths = Array.from({ length: count }, (_, i) =>
    i < count - 148
      ? `Shared/Notes/Section ${Math.floor(i / 32) % 31}/层 ${Math.floor(i / 32) % 7}/Nested ${Math.floor(i / 32) % 13}/Sample ${i}.md`
      : `Shared/Attachments/Sample ${i}.bin`
  )
  const target = paths.at(-1)!,
    bytes = new Uint8Array(3 * 1024 * 1024).fill(17)
  let engine: SyncEngine | undefined
  try {
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    for (let at = 0; at < paths.length; at += 64)
      await Promise.all(
        paths
          .slice(at, at + 64)
          .map((path) => disk.writeFile(join(root, path), path === target ? bytes : 'x'))
      )
    const app = buildFakeVault(
      paths.map((path) => ({ path, content: 'x', mtime: 1000 })),
      { sensitiveNames: true }
    )
    Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
    let lstats = 0,
      listings = 0
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: {
        ...disk,
        readdir: async (...args: Parameters<typeof disk.readdir>) => {
          listings++
          return disk.readdir(...args)
        },
        lstat: async (...args: Parameters<typeof disk.lstat>) => {
          lstats++
          return disk.lstat(...args)
        },
      },
      stat: async (path: string) => {
        try {
          const value = await disk.stat(join(root, path))
          return {
            type: value.isFile() ? 'file' : 'folder',
            size: value.size,
            mtime: value.mtimeMs,
            ctime: value.birthtimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      list: async (path: string) => {
        listings++
        const entries = await disk.readdir(join(root, path), { withFileTypes: true })
        return {
          files: entries
            .filter((one) => one.isFile())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
          folders: entries
            .filter((one) => one.isDirectory())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
        }
      },
    })
    const state = new MemoryStateStore(),
      baseSha = await sha256(new TextEncoder().encode('x'))
    const fs = new ObsidianFileSystem(app as never, { ledger: state, fileScope: 'Shared' })
    for (const path of paths.slice(-148, -1)) {
      const info = await fs.stat(path)
      const entry = {
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha: baseSha,
        size: 1,
        mtime: info!.mtime,
      }
      await state.put(entry)
      await state.setMeta(
        'paired-file:' + path,
        JSON.stringify({ ...entry, identity: await fs.fileIdentity!(path) })
      )
    }
    await state.setCursor(147)
    await state.setJournal({
      batchId: 'sample-batch',
      idempotencyKey: 'sample-request',
      startedAt: new Date().toISOString(),
      ops: [
        { op: 'create', path: target, sha: await sha256(bytes), size: bytes.length, mtime: 1000 },
      ],
    })
    let uploadMs = Infinity
    const upload = vi.fn(async (_identity: unknown, source: ChunkSource) => {
      uploadMs = performance.now() - started
      await source.close()
      throw new EngineError('offline', 'sample interruption at upload request')
    })
    const client = {
      state: async () => ({ head_seq: 147, settings: { max_file_bytes: 1e9, quota_bytes: null } }),
      hasBlob: async () => false,
      putBlobSource: upload,
    } as unknown as EngineClient
    engine = new SyncEngine({ fs, state, client, selective: selectiveFrom(undefined) })
    lstats = 0
    listings = 0
    const started = performance.now()
    await engine.sync().catch(() => {})
    console.log('native replay 33k', { uploadMs, lstats, listings })
    expect(upload).toHaveBeenCalledOnce()
    expect(uploadMs).toBeLessThan(5000)
    expect(listings).toBeLessThan(20)
    expect(await state.getJournal()).not.toBeNull()
  } finally {
    await engine?.stop()
    await disk.rm(root, { recursive: true, force: true })
  }
}, 120000)
