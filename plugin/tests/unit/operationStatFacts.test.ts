import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('shares placement stat facts without installing per-file index listeners', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  const on = vi.spyOn(app.vault, 'on')
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const pass = Reflect.get(fs, Symbol.for('abele.sync.operation-pass-v1')).bind(fs)
  await pass(async () => {
    await fs.stat('sample.md')
    await fs.stat('sample.md')
    expect(stat.mock.calls.filter(([path]) => path === 'sample.md')).toHaveLength(1)
    await app.vault.adapter.write('sample.md', 'saved bytes', { mtime: 2000 })
    expect(await fs.stat('sample.md')).toMatchObject({ size: 11 })
  })
  expect(on).not.toHaveBeenCalled()
})

it('reuses engine stat facts within a batch and invalidates them after publication, saves and fresh polling', async () => {
  const app = buildFakeVault([])
  const externalWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const fs = new ObsidianFileSystem(app as never)
  const reads = () => stat.mock.calls.filter(([path]) => path === 'sample.md').length
  await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
    expect(await fs.stat('sample.md')).toBeNull()
    expect(await fs.stat('sample.md')).toBeNull()
    expect(reads()).toBe(1)
    await fs.writeAtomic('sample.md', new TextEncoder().encode('first'), 1000)
    const before = reads()
    expect(await fs.stat('sample.md')).toMatchObject({ size: 5, mtime: 1000 })
    expect(await fs.stat('sample.md')).toMatchObject({ size: 5, mtime: 1000 })
    expect(reads() - before).toBe(1)
    await app.vault.adapter.writeBinary(
      'sample.md',
      new TextEncoder().encode('saved locally').buffer,
      { mtime: 2000 }
    )
    app.emit('vault', 'modify', app.vault.getFileByPath('sample.md')!)
    expect(await fs.stat('sample.md')).toMatchObject({ size: 13, mtime: 2000 })
    await externalWrite('sample.md', new TextEncoder().encode('external bytes').buffer, {
      mtime: 3000,
    })
    const poll = Reflect.get(fs, 'configSnapshot').bind(fs)
    await poll()
    await poll()
    expect(await fs.stat('sample.md')).toMatchObject({ size: 14, mtime: 3000 })
  })
})
