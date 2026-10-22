import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { PLACEMENT } from '@/sync/pathCoordinator'

it('retains a source recreated while an unchanged move destination is fingerprinted', async () => {
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const a = new TextEncoder().encode('sample A'),
    b = new TextEncoder().encode('sample B')
  const sha = await sha256(a)
  await fs.writeAtomic('old.md', a, 1000)
  const base = {
    path: 'old.md',
    wirePath: 'old.md',
    fileId: 'sample',
    versionId: 'a',
    sha,
    size: a.length,
    mtime: 1000,
  }
  await state.put(base)
  await state.setCursor(1)
  await fs.move('old.md', 'new.md')
  let leased = false,
    fingerprints = 0,
    injected = false
  Object.assign(fs, {
    [PLACEMENT]: async (_paths: string[], work: () => Promise<unknown>) => {
      leased = true
      try {
        return await work()
      } finally {
        leased = false
      }
    },
    [Symbol.for('abele.sync.fingerprint-pull-v1')]: async (path: string) => {
      const bytes = await fs.read(path)
      if (path === 'new.md' && leased && ++fingerprints === 2) {
        await fs.writeAtomic('old.md', b, 1000)
        injected = true
      }
      return { sha: await sha256(bytes), size: bytes.length }
    },
  })
  const getBlob = vi.fn(async () => a)
  const client = {
    changes: async () => ({
      items: [
        {
          seq: 2,
          file_id: 'sample',
          version_id: 'moved',
          path: 'new.md',
          prev_path: 'old.md',
          op: 'move',
          sha,
          size: a.length,
          mtime: 1000,
          kind: 'note',
          at: '',
          actor: { kind: 'system', id: 'sample', name: 'Sample' },
        },
      ],
      head_seq: 2,
      next_since: 2,
    }),
    getBlob,
  } as unknown as EngineClient
  await pull(client, fs, state, {
    dirty: new Set(),
    expected: new ExpectedWrites(),
    filter: { excluded: () => false },
  })
  expect(injected).toBe(true)
  expect(await fs.read('old.md')).toEqual(b)
  expect(await fs.read('new.md')).toEqual(a)
  expect(await state.byFileId('sample')).toEqual(base)
  expect(getBlob).not.toHaveBeenCalled()
})
