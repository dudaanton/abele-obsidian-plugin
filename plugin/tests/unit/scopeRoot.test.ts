import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { watchScopeRoot } from '@/sync/scopeRoot'
import { buildFakeVault } from '../helpers/fakeVault'

it('stops before a root deletion emits child events without scanning the inventory', async () => {
  const app = buildFakeVault(
    Array.from({ length: 1000 }, (_, i) => ({
      path: `Shared/dir-${i % 60}/note-${i}.md`,
      content: 'sample',
    }))
  )
  const stopped = vi.fn()
  const inventory = vi.spyOn(app.vault, 'getFiles')
  const remove = vi.spyOn(app.vault, 'delete').mockImplementation(async () => {
    expect(stopped).toHaveBeenCalledTimes(1)
    for (const file of app.vault.getFiles()) app.emit('vault', 'delete', file)
  })
  const stop = watchScopeRoot(app as unknown as App, 'Shared', stopped)
  const started = performance.now()
  try {
    await app.vault.delete(app.vault.getAbstractFileByPath('Shared')!)
    expect(stopped).toHaveBeenCalledExactlyOnceWith({ kind: 'deleted' })
    expect(inventory).toHaveBeenCalledTimes(1)
    expect(performance.now() - started).toBeLessThan(250)
  } finally {
    stop()
    remove.mockRestore()
  }
})

it('reports a moved ancestor once with the new root path', async () => {
  const app = buildFakeVault([{ path: 'Parent/Shared/sample.md', content: 'sample' }])
  const stopped = vi.fn()
  const stop = watchScopeRoot(app as unknown as App, 'Parent/Shared', stopped)
  try {
    const parent = app.vault.getAbstractFileByPath('Parent')!
    await app.vault.rename(parent, 'Moved')
    app.emit('vault', 'rename', parent, 'Parent')
    expect(stopped).toHaveBeenCalledExactlyOnceWith({ kind: 'moved', path: 'Moved/Shared' })
  } finally {
    stop()
  }
})

it('leaves whole-vault connections and ordinary child deletes alone', async () => {
  const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'sample' }])
  const root = vi.fn(),
    folder = vi.fn()
  const stops = [
    watchScopeRoot(app as unknown as App, '/', root),
    watchScopeRoot(app as unknown as App, 'Shared', folder),
  ]
  try {
    await app.vault.delete(app.vault.getAbstractFileByPath('Shared/sample.md')!)
    expect(root).not.toHaveBeenCalled()
    expect(folder).not.toHaveBeenCalled()
  } finally {
    stops.forEach((stop) => stop())
  }
})

it('tracks successive moves and deletion of the stopped root without following a reused path', async () => {
  const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'sample' }]),
    stopped = vi.fn()
  const stop = watchScopeRoot(app as unknown as App, 'Shared', stopped)
  try {
    await app.vault.rename(app.vault.getAbstractFileByPath('Shared')!, 'Moved')
    await app.vault.rename(app.vault.getAbstractFileByPath('Moved')!, 'Final')
    expect(stopped.mock.calls.map(([issue]) => issue)).toEqual([
      { kind: 'moved', path: 'Moved' },
      { kind: 'moved', path: 'Final' },
    ])
    await app.vault.createFolder('Moved')
    await app.vault.create('Moved/private.md', 'private')
    await app.vault.delete(app.vault.getAbstractFileByPath('Final')!)
    expect(stopped).toHaveBeenLastCalledWith({ kind: 'deleted' })
  } finally {
    stop()
  }
})
