import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['before-write', 'before-publish'] as const)(
  'preserves a file created after an absence check (%s)',
  async (when) => {
    const app = buildFakeVault([{ path: 'notes/sample.md', content: 'sample' }])
    const fs = new ObsidianFileSystem(app as never),
      path = 'notes/incoming.md'
    expect(await fs.stat(path)).toBeNull()
    if (when === 'before-write') await app.vault.adapter.write(path, 'independent bytes')
    else {
      const rename = app.vault.adapter.rename.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
        if (to === path) await app.vault.adapter.write(path, 'independent bytes')
        return rename(from, to)
      })
    }
    await expect(
      fs.writeAtomic(path, new TextEncoder().encode('remote bytes'), 1000)
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await app.vault.adapter.read(path)).toBe('independent bytes')
  }
)
