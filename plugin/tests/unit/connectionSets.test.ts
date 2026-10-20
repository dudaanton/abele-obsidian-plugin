import { describe, expect, it, vi } from 'vitest'
import { ConnectionSets, SETS_KEY, type SetItem } from '@/sync/connectionSets'
import { ItemSetEngines } from '@/sync/itemSetEngines'
import { removeDetachedCopies } from '@/sync/removeDetachedCopies'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { sha256 } from '@/sync/external/hash'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'

const folder = (id: string, path: string): SetItem => ({ id, kind: 'folder', scopeId: id, path })
function setup() {
  const data = new Map<string, unknown>([['abele-sync-connections-v2', 'legacy registry']])
  const storage = {
    loadLocalStorage: (key: string) => data.get(key),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, value)
    },
  }
  return { data, storage, sets: new ConnectionSets(storage) }
}

describe('connection item sets', () => {
  it('keeps other items syncing when one item fails', async () => {
    const { sets } = setup()
    const items = [folder('a', 'Garden'), folder('b', 'Library')]
    sets.create('c', '', items)
    const synced = vi.fn(async () => {})
    const host = new ItemSetEngines(sets, {
      read: async () => items,
      open: async (_connection, item) => ({
        sync:
          item.id === 'a'
            ? async () => {
                throw new Error('item unavailable')
              }
            : synced,
        close: async () => {},
      }),
    })
    try {
      await expect(host.sync('c')).rejects.toThrow()
      expect(synced).toHaveBeenCalledOnce()
    } finally {
      await host.close()
    }
  })
  it('coalesces membership requests without allowing a stale result to overwrite newer membership', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    const read = vi.fn(async () => [folder('b', 'Library')])
    await Promise.all([sets.refresh('c', read), sets.refresh('c', read)])
    expect(read).toHaveBeenCalledOnce()
    expect(sets.get('c')?.items.find((one) => one.id === 'a')?.detached).toBe(true)
  })
  it('drains an engine opened during shutdown and does not start its sync', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const sync = vi.fn(async () => {}),
      close = vi.fn(async () => {})
    const host = new ItemSetEngines(sets, {
      read: async () => [folder('a', 'Garden')],
      open: async () => {
        opened()
        await wait
        return { sync, close }
      },
    })
    const work = host.sync('c')
    await opening
    const closed = host.close()
    release()
    await Promise.all([work, closed])
    expect(sync).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
  it('starts added item engines and drains detached engines without touching local bytes', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    const events: string[] = []
    let current = [folder('a', 'Garden')]
    const host = new ItemSetEngines(sets, {
      read: async () => current,
      open: async (_connection, item) => ({
        sync: async () => {
          events.push('sync:' + item.id)
        },
        close: async () => {
          events.push('close:' + item.id)
        },
      }),
    })
    await host.sync('c')
    current = [folder('b', 'Library')]
    await host.foreground('c')
    expect(events).toEqual(['sync:a', 'close:a', 'sync:b'])
    expect(sets.get('c')?.items[0].detached).toBe(true)
    await host.close()
    expect(events.at(-1)).toBe('close:b')
  })
  it('removes only unchanged detached bytes, retaining edited and otherwise covered files', async () => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const original = new TextEncoder().encode('original')
    for (const path of ['Garden/unchanged.md', 'Garden/edited.md', 'Garden/covered.md']) {
      await fs.writeAtomic(path, original, 1)
      await state.put({
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha: await sha256(original),
        size: original.length,
        mtime: 1,
      })
    }
    await fs.writeAtomic('Garden/edited.md', new TextEncoder().encode('edited'), 2)
    const result = await removeDetachedCopies({
      fs,
      state,
      detached: () => true,
      covered: (path) => path.endsWith('covered.md'),
      lease: async (_path, work) => work(),
    })
    expect(result).toEqual({ removed: 1, kept: 2 })
    expect(await fs.stat('Garden/unchanged.md')).toBe(null)
    expect(await fs.stat('Garden/edited.md')).not.toBe(null)
    expect(await fs.stat('Garden/covered.md')).not.toBe(null)
    expect(await state.get('Garden/edited.md')).not.toBe(null)
  })
  it('refuses local copy deletion for a live item', async () => {
    await expect(
      removeDetachedCopies({
        fs: new MemoryFileSystem(),
        state: new MemoryStateStore(),
        detached: () => false,
        covered: () => false,
        lease: async (_path, work) => work(),
      })
    ).rejects.toThrow(/no longer shared/i)
  })
  it('keeps grouping separate from the downgrade registry and survives reopening', () => {
    const { data, storage, sets } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const legacy = TokenConnectionRegistry.open(storage)
    const localId = legacy.add()
    const before = structuredClone(data.get(TOKEN_REGISTRY_KEY))
    sets.create('connection', 'Example', [folder('a', 'Garden')])
    expect(data.get(TOKEN_REGISTRY_KEY)).toEqual(before)
    expect(TokenConnectionRegistry.open(storage).records()[0].id).toBe(localId)
    expect(new ConnectionSets(storage).get('connection')?.items[0].id).toBe('a')
    expect(data.has(SETS_KEY)).toBe(true)
  })
  it('bounds new shares to twenty items without restricting an empty current server set', () => {
    const { sets } = setup()
    expect(() =>
      sets.create(
        'c',
        '',
        Array.from({ length: 21 }, (_, n) => folder(String(n), `Folder-${n}`))
      )
    ).toThrow(/20/)
    expect(() => sets.create('c', '', [])).toThrow()
    sets.create('c', '', [folder('a', 'Garden')])
    sets.reconcile('c', [])
    expect(sets.get('c')?.items[0].detached).toBe(true)
  })
  it('picks up added items, retains detached items, and resumes a readded item', () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    expect(sets.reconcile('c', [folder('b', 'Library')])).toEqual({ added: ['b'], detached: ['a'] })
    expect(sets.get('c')?.items.find((i) => i.id === 'a')?.detached).toBe(true)
    expect(sets.reconcile('c', [folder('a', 'Garden'), folder('b', 'Library')])).toEqual({
      added: ['a'],
      detached: [],
    })
    expect(sets.get('c')?.items).toHaveLength(2)
  })
  it('fails closed on corrupt grouping without overwriting evidence', () => {
    const { storage, data } = setup()
    data.set(SETS_KEY, { version: 7, connections: [] })
    expect(() => new ConnectionSets(storage).get('c')).toThrow(/recovery/i)
    expect(data.get(SETS_KEY)).toEqual({ version: 7, connections: [] })
  })
  it('refuses duplicate and overlapping folders in either order, respecting boundaries', () => {
    const { sets } = setup()
    expect(() =>
      sets.create('c', '', [folder('a', 'Garden'), folder('b', 'Garden/Trees')])
    ).toThrow(/Garden/)
    expect(() =>
      sets.create('c', '', [folder('b', 'Garden/Trees'), folder('a', 'Garden')])
    ).toThrow(/Garden/)
    expect(() => sets.create('c', '', [folder('a', 'Garden'), folder('a', 'Garden')])).toThrow()
    sets.create('c', '', [folder('a', 'Garden'), folder('b', 'Gardens')])
  })
  it('elects one uploader using live coverage and stable order, excluding paused and detached items', () => {
    const { sets } = setup()
    sets.create('c', '', [
      folder('a', 'Garden'),
      { id: 'b', kind: 'group', scopeId: 'b', path: 'Topics.md' },
    ])
    const covers = (_id: string, path: string) => path === 'Garden/note.md'
    expect(sets.uploader('c', 'Garden/note.md', covers)).toBe('a')
    sets.pause('c', 'a', true)
    expect(sets.uploader('c', 'Garden/note.md', covers)).toBe('b')
    sets.reconcile('c', [folder('a', 'Garden')])
    expect(sets.uploader('c', 'Garden/note.md', covers)).toBe(null)
  })
  it('does not detach on an unavailable server or an unsupported capability', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    await expect(
      sets.refresh('c', async () => {
        throw new Error('offline')
      })
    ).rejects.toThrow('offline')
    expect(await sets.refresh('c', async () => null)).toBe(false)
    expect(sets.get('c')?.items[0].detached).toBe(false)
  })
})
