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

it('certifies native upload ctime without another read after the publication check', async () => {
  const root = await disk.mkdtemp(join(tmpdir(), 'sample-upload-readback-'))
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
  try {
    for (const [path, bytes] of bodies) await disk.writeFile(join(root, path), bytes)
    const app = nativeVault(root, counted.port, paths)
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
    await disk.rm(root, { recursive: true, force: true })
  }
})
