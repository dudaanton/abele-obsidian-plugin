// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import {
  ExpectedWrites,
  MemoryStateStore,
  push,
  scan,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { countedDisk, nativeVault } from '../helpers/nativeRestartVault'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'

it('adopts equal native bytes with one verified read including ctime certification', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-adoption-readback-')))
  const path = 'sample.md'
  const body = new TextEncoder().encode('sample local content')
  let contentReads = 0
  const counted = countedDisk((physical, bytes) => {
    if (physical === join(root, path) && bytes > 0) contentReads++
  })
  desktopFsPort(counted.port)
  const state = new MemoryStateStore()
  try {
    await disk.writeFile(join(root, path), body)
    const app = nativeVault(root, counted.port, [path])
    const stat = await disk.stat(join(root, path))
    app.vault.getFileByPath(path)!.stat = {
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.birthtimeMs,
    }
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    const files = new ObsidianFileSystem(app as unknown as App, {
      ledger: state,
      prepareStartupInventory: async () => {},
    })
    const sha = await sha256(body)
    const placer = new PullPlacer(
      {} as never,
      files,
      state,
      {
        dirty: new Set(),
        expected: new ExpectedWrites(),
        filter: { excluded: () => false },
      },
      sha256
    )
    const change: ChangeItem = {
      seq: 1,
      file_id: 'sample-file',
      version_id: 'sample-version',
      path,
      prev_path: null,
      op: 'create',
      kind: 'note',
      sha,
      size: body.length,
      mtime: stat.mtimeMs,
      at: '',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    }
    expect(await placer.adoptExisting(change, null, true)).toBe(true)
    expect(contentReads, 'ctime acknowledgement reuses the adoption read').toBe(1)
    expect(await state.get(path)).toMatchObject({ sha, ctime: stat.birthtimeMs })
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
})

it('certifies native upload ctime without another read after the publication check', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-upload-readback-')))
  const paths = Array.from({ length: 16 }, (_, i) => `sample-${i}.md`)
  const bodies = new Map(paths.map((path) => [path, new TextEncoder().encode('content ' + path)]))
  let accepted = false
  let readBackBytes = 0
  const physicalPaths = new Set(paths.map((path) => join(root, path)))
  const counted = countedDisk((path, bytes) => {
    if (accepted && physicalPaths.has(path)) readBackBytes += bytes
  })
  desktopFsPort(counted.port)
  const state = new MemoryStateStore()
  let host: HostSyncStorage | undefined
  try {
    for (const [path, bytes] of bodies) await disk.writeFile(join(root, path), bytes)
    const app = nativeVault(root, counted.port, paths)
    host = await HostSyncStorage.open(new IDBFactory(), 'sample-upload-readback', app)
    for (const path of paths) {
      const stat = await disk.stat(join(root, path))
      app.vault.getFileByPath(path)!.stat = {
        size: stat.size,
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs,
      }
    }
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    const files = new ObsidianFileSystem(app as unknown as App, {
      storage: host,
      ledger: state,
      prepareStartupInventory: async () => {},
    })
    let readBackFingerprints = 0
    const fingerprint = files.fingerprint.bind(files)
    files.fingerprint = async (...args) => {
      if (accepted && bodies.has(args[0])) readBackFingerprints++
      return fingerprint(...args)
    }
    const client = {
      hasBlob: async () => false,
      putBlobSource: async (
        _sha: string,
        source: {
          size: number
          read(offset: number, length: number): Promise<Uint8Array>
          assertUnchanged(): Promise<void>
        }
      ) => {
        const bytes = await source.read(0, source.size)
        expect(bytes.length).toBe(source.size)
        await source.assertUnchanged()
      },
      commitRaw: async (ops: { path: string; sha: string; size: number; mtime: number }[]) => {
        accepted = true
        return {
          replayed: false,
          body: {
            head_seq: ops.length,
            results: ops.map((op, i) => ({
              status: 'applied',
              file_id: `sample-file-${i}`,
              version_id: `sample-version-${i}`,
              path: op.path,
              kind: 'note',
              sha: op.sha,
              size: op.size,
              mtime: op.mtime,
            })),
          },
        }
      },
    } as unknown as EngineClient
    const report = await push(
      client,
      files,
      state,
      await scan(files, state, { excluded: () => false }),
      {
        expected: new ExpectedWrites(),
      }
    )
    expect(report.applied).toBe(paths.length)
    // The post-acceptance fingerprint checks for a racing local edit. Ctime
    // certification must reuse that observation rather than fingerprint again.
    expect(readBackFingerprints).toBe(paths.length)
    expect(readBackBytes).toBe(0)
    for (const path of paths) {
      expect((await state.get(path))?.sha).toBe(await sha256(bodies.get(path)!))
      expect((await state.get(path))?.ctime).toBeTypeOf('number')
    }
  } finally {
    host?.close()
    await disk.rm(root, { recursive: true, force: true })
  }
})
