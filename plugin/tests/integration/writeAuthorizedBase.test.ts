import { it, expect } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'
const bytes = (s: string) => new TextEncoder().encode(s)
const current = async (app: ReturnType<typeof buildFakeVault>) =>
  new TextDecoder().decode(await app.vault.adapter.readBinary('Sample.md'))
for (const desktop of [false, true]) {
  it(`preserves a local save during the awaited restrictive hold (${desktop ? 'desktop' : 'mobile'})`, async () => {
    const app = buildFakeVault([{ path: 'Sample.md', content: 'authorized old' }])
    if (desktop) withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App, {
      beforeEngineMutation: async () => {
        await app.vault.adapter.writeBinary(
          'Sample.md',
          bytes('new local edit').buffer as ArrayBuffer
        )
      },
    })
    await fs.read('Sample.md')
    await expect(fs.writeAtomic('Sample.md', bytes('remote'), 12)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(await current(app)).toBe('new local edit')
  })
  it(`does not adopt a local save before adapter entry as the engine-authorized base (${desktop ? 'desktop' : 'mobile'})`, async () => {
    const app = buildFakeVault([{ path: 'Sample.md', content: 'authorized old' }])
    if (desktop) withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.read('Sample.md')
    await app.vault.adapter.writeBinary('Sample.md', bytes('new local edit').buffer as ArrayBuffer)
    await expect(fs.writeAtomic('Sample.md', bytes('remote'), 12)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(await current(app)).toBe('new local edit')
  })
}
it('does not adopt an absent-to-existing race as replacement authority', async () => {
  const app = buildFakeVault([]),
    fs = new ObsidianFileSystem(app as unknown as App)
  expect(await fs.stat('Sample.md')).toBeNull()
  await app.vault.adapter.writeBinary('Sample.md', bytes('new local create').buffer as ArrayBuffer)
  await expect(fs.writeAtomic('Sample.md', bytes('remote'), 12)).rejects.toMatchObject({
    code: 'conflict',
  })
  expect(await current(app)).toBe('new local create')
})
