import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  scan,
  sha256,
  applyStaged,
  ExpectedWrites,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { reconciliationScan } from '../../node_modules/@abele/sync-sdk/dist/internal/core/reconciliation.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

it.each([false, 'stat', 'object'] as const)(
  'restarts a synced vault without content reads, changed=%s',
  async (changed) => {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'baseline bytes', mtime: 1000 }])
    withDesktopFs(app)
    const state = new MemoryStateStore()
    const filter = { excluded: () => false }
    const original = new ObsidianFileSystem(app as never)
    await scan(original, state, filter)
    await state.put({
      path: 'sample.bin',
      wirePath: 'sample.bin',
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: await sha256(new TextEncoder().encode('baseline bytes')),
      size: 14,
      mtime: 1000,
    })
    if (changed === 'object') await app.vault.adapter.remove('sample.bin')
    if (changed)
      await app.vault.adapter.write('sample.bin', 'modified bytes', {
        mtime: changed === 'object' ? 1000 : 2000,
      })
    const restarted = new ObsidianFileSystem(app as never)
    const fingerprint = vi.spyOn(restarted, 'fingerprint')
    const result = await reconciliationScan(restarted, state, filter, 0)
    expect(fingerprint).toHaveBeenCalledTimes(changed ? 1 : 0)
    expect(result.found.dirty.has('sample.bin')).toBe(!!changed)
    if (changed) expect(result.found.ops).toContainEqual(expect.objectContaining({ op: 'modify' }))
  }
)

it('records the final identity and timestamp of a streamed pull before restart', async () => {
  const app = buildFakeVault([])
  withDesktopFs(app)
  const state = new MemoryStateStore()
  const bytes = new Uint8Array(1024 * 1024 + 17).fill(23)
  const sha = await sha256(bytes)
  const filter = { excluded: () => false }
  const client = {
    openVersion: async () => ({
      size: bytes.length,
      read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
      assertUnchanged: async () => {},
      close: async () => {},
    }),
  } as unknown as EngineClient
  await applyStaged(
    client,
    new ObsidianFileSystem(app as never),
    state,
    [
      {
        seq: 1,
        file_id: 'sample-file',
        version_id: 'sample-version',
        path: 'sample.bin',
        prev_path: null,
        op: 'create',
        kind: 'attachment',
        sha,
        size: bytes.length,
        mtime: 1234,
        at: '',
        actor: { kind: 'system', id: 'sample', name: 'Sample' },
      },
    ],
    {
      filter,
      dirty: new Set(),
      expected: new ExpectedWrites(),
      prefetchBytes: 0,
    }
  )
  const restarted = new ObsidianFileSystem(app as never)
  const fingerprint = vi.spyOn(restarted, 'fingerprint')
  const result = await reconciliationScan(restarted, state, filter, 0)
  expect(fingerprint).not.toHaveBeenCalled()
  expect(result.found.dirty.size).toBe(0)
  expect((await state.get('sample.bin'))?.mtime).toBe((await restarted.stat('sample.bin'))?.mtime)
})
