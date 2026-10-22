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

it.each(['fingerprint', 'remove'])(
  'retains a recreated source at the %s boundary',
  async (boundary) => {
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
    const remove = fs.remove.bind(fs)
    const inject = async () => {
      if (boundary === 'remove' && !injected) {
        await fs.writeAtomic('old.md', b, 1000)
        injected = true
      }
    }
    Object.assign(fs, {
      remove: async (path: string) => {
        await inject()
        await remove(path)
      },
      conditionalFile: async (op: { path: string; expected: { sha: string } }) => {
        await inject()
        const stat = await fs.stat(op.path)
        if (!stat) return true
        if ((await sha256(await fs.read(op.path))) !== op.expected.sha) return false
        await remove(op.path)
        return true
      },
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
        if (boundary === 'fingerprint' && path === 'new.md' && leased && ++fingerprints === 2) {
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
  }
)
