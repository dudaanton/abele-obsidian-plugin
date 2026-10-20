import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  push,
  scan,
  sha256,
} from '@abele/sync-sdk/core'
import type { EngineClient } from '@abele/sync-sdk/core'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'

it('preserves a merged upload before writing it while skipping unchanged acknowledgements in the same batch', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const local = new TextEncoder().encode('local edit'),
    merged = new TextEncoder().encode('merged edit')
  await disk.writeAtomic('merged.md', local, 1000)
  await disk.writeAtomic('sent.md', local, 1000)
  const preserve = vi.fn(async (paths: readonly string[]) => {
    expect(paths).toEqual(['merged.md', 'merged.md'])
    expect(await disk.read('merged.md')).toEqual(local)
  })
  const fs = coordinatedFileSystem(disk, new PathCoordinator(), () => {}, preserve)
  const sha = await sha256(merged)
  const client = {
    hasBlob: async () => false,
    putBlob: async () => {},
    getBlob: async () => merged,
    commitRaw: async (ops) => ({
      replayed: false,
      body: {
        head_seq: 2,
        results: ops.map((op, i) => ({
          status: op.path === 'merged.md' ? 'merged' : 'applied',
          file_id: 'sample-' + i,
          version_id: 'version-' + i,
          path: op.path,
          kind: 'note',
          sha: op.path === 'merged.md' ? sha : op.sha,
          size: op.path === 'merged.md' ? merged.length : local.length,
          mtime: 1000,
        })),
      },
    }),
  } as EngineClient
  const report = await push(client, fs, state, await scan(fs, state, { excluded: () => false }), {
    expected: new ExpectedWrites(),
  })
  expect(report.merged).toBe(1)
  expect(report.applied).toBe(1)
  expect(preserve).toHaveBeenCalledTimes(1)
  expect(await disk.read('merged.md')).toEqual(merged)
  expect(await disk.read('sent.md')).toEqual(local)
})
