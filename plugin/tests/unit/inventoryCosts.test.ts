import { expect, it, vi } from 'vitest'
import type { TFolder } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

const pass = Symbol.for('abele.sync.inventory-pass-v1')
const absent = Symbol.for('abele.sync.index-absent-v1')

it('finishes slow directory identity reads while a sibling is autosaving', async () => {
  const app = buildFakeVault([
    { path: 'notes/sub/kept.md', content: 'kept' },
    { path: 'notes/sibling.md', content: 'sample' },
  ])
  const fs = new ObsidianFileSystem(app as never)
  const directories = Reflect.get(fs, 'directories') as {
    identity(path: string): Promise<string>
  }
  const identity = directories.identity.bind(directories)
  let attempts = 0
  vi.spyOn(directories, 'identity').mockImplementation(async (path) => {
    attempts++
    if (attempts <= 8) {
      for (let tick = 0; tick < 3; tick++) {
        await new Promise((resolve) => setTimeout(resolve, 3))
        app.emit('vault', 'modify', { path: 'notes/sibling.md' })
      }
    }
    return identity(path)
  })
  await fs[pass](async () => {
    const revision = Symbol.for('abele.sync.local-change-revision-v1')
    const before = fs[revision]('notes/sibling.md')
    expect(await fs.listChildren('notes')).toContainEqual(
      expect.objectContaining({ path: 'notes/sub', kind: 'directory' })
    )
    expect(fs[revision]('notes/sibling.md')).toBeGreaterThan(before!)
    expect(attempts).toBe(1)
  })
})

it('builds the sibling name set once across interleaved pull writes', async () => {
  const app = buildFakeVault(
    Array.from({ length: 2000 }, (_, i) => ({ path: `notes/file-${i}.md`, content: 'sample' }))
  )
  const parent = app.vault.getAbstractFileByPath('notes') as TFolder
  const map = vi.spyOn(parent.children, 'map')
  let bridge = 0
  const fs = new ObsidianFileSystem(app as never, {
    diagnostic: (operation) => {
      if (operation.startsWith('adapter ')) bridge++
    },
  })
  await fs[pass](async () => {
    for (let i = 0; i < 20; i++) {
      const path = `notes/new-${i}.md`
      expect(await fs[absent](path)).toBe(true)
      await fs.writeAtomic(path, new Uint8Array([1]), 1000)
      expect(await fs[absent](path)).toBe(false)
    }
  })
  console.log('[inventory costs]', {
    siblings: 2000,
    writes: 20,
    rebuilds: map.mock.calls.length,
    bridge,
  })
  expect(map).toHaveBeenCalledTimes(1)
  expect(bridge).toBeLessThanOrEqual(108)
})

it.each(['modify', 'create'] as const)(
  'bounds slow inventory attempts during repeated %s events',
  async (event) => {
    const app = buildFakeVault([{ path: 'notes/sibling.md', content: 'sample' }])
    const fs = new ObsidianFileSystem(app as never)
    const read = app.vault.adapter.list.bind(app.vault.adapter)
    let attempts = 0
    vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (path) => {
      const result = await read(path)
      if (path === 'notes') {
        attempts++
        // Keep the regression finite while exceeding the retry budget.
        if (attempts <= 8) {
          await new Promise((resolve) => setTimeout(resolve, 3))
          app.emit('vault', event, { path: 'notes/sibling.md' })
          await new Promise((resolve) => setTimeout(resolve, 3))
        }
      }
      return result
    })
    await fs[pass](async () => {
      if (event === 'modify') {
        expect(await fs.listChildren('notes')).toContainEqual({
          path: 'notes/sibling.md',
          kind: 'file',
        })
        expect(attempts).toBe(1)
      } else {
        await expect(fs.listChildren('notes')).rejects.toMatchObject({ code: 'io' })
        expect(attempts).toBeLessThanOrEqual(3)
      }
    })
    console.log('[inventory stability]', { event, attempts })
  }
)
