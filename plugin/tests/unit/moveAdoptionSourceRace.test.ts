import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'

it.each([1000, 1001])(
  'D-178 retains a recreated source with recreation mtime %s',
  async (mtime) => {
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
    let injected = false
    const stat = fs.stat.bind(fs)
    fs.stat = async (path) => {
      const observed = await stat(path)
      if (path === 'old.md' && !observed && !injected) {
        await fs.writeAtomic('old.md', b, mtime)
        injected = true
      }
      return observed
    }
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
  }
)
