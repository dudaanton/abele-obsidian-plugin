import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'

it('rechecks an equal untracked move target after an earlier page observed an absent path', async () => {
  const fs = new MemoryFileSystem()
  const state = new MemoryStateStore()
  const bytes = new TextEncoder().encode('sample content')
  const sha = await sha256(bytes)
  await fs.writeAtomic('b.md', bytes, 1000)
  await state.setCursor(1)
  const stage = vi.fn(async () => {
    throw new Error('Existing move destination must not be staged')
  })
  Object.assign(fs, {
    beginAtomicWrite: stage,
    reopenStage: stage,
    conditionalFile: async (op: { path: string; expected: { sha: string } }) => {
      if ((await sha256(await fs.read(op.path))) !== op.expected.sha) return false
      await fs.remove(op.path)
      return true
    },
    openRead: async (path: string) => ({
      size: (await fs.stat(path))!.size,
      read: async (offset: number, length: number) =>
        (await fs.read(path)).slice(offset, offset + length),
      assertUnchanged: async () => {},
      close: async () => {},
    }),
  })
  let offline = false
  const openVersion = vi.fn(async () => {
    if (offline) throw new Error('Content offline')
    return {
      size: bytes.length,
      read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
      assertUnchanged: async () => {},
      close: async () => {},
    }
  })
  const getBlob = vi.fn(async () => {
    throw new Error('Content offline')
  })
  const change = {
    file_id: 'sample-file',
    sha,
    size: bytes.length,
    mtime: 1000,
    kind: 'note',
    at: '',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }
  const changes = vi.fn(async (since: number) => {
    if (since === 1)
      return {
        items: [
          { ...change, seq: 2, version_id: 'created', op: 'create', path: 'a.md', prev_path: null },
        ],
        head_seq: 3,
        next_since: 2,
      }
    expect(since).toBe(2)
    expect(await fs.read('a.md')).toEqual(bytes)
    expect(openVersion).toHaveBeenCalledOnce()
    openVersion.mockClear()
    offline = true
    return {
      items: [
        { ...change, seq: 3, version_id: 'moved', op: 'move', path: 'b.md', prev_path: 'a.md' },
      ],
      head_seq: 3,
      next_since: 3,
    }
  })
  await pull({ changes, openVersion, getBlob } as unknown as EngineClient, fs, state, {
    dirty: new Set(),
    expected: new ExpectedWrites(),
    filter: { excluded: () => false },
  })
  expect(changes.mock.calls.map(([since]) => since)).toEqual([1, 2])
  expect(openVersion).not.toHaveBeenCalled()
  expect(getBlob).not.toHaveBeenCalled()
  expect(stage).not.toHaveBeenCalled()
  expect(await fs.read('b.md')).toEqual(bytes)
  expect(await fs.stat('a.md')).toBeNull()
  expect(await state.byFileId('sample-file')).toMatchObject({
    path: 'b.md',
    wirePath: 'b.md',
    versionId: 'moved',
    sha,
  })
  expect(await state.getCursor()).toBe(3)
})
