import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['.obsidian', 'Café'.normalize('NFD')])(
  'refreshes an old parent listing when mkdir confirms an existing directory: %s',
  async (path) => {
    const app = buildFakeVault([], { sensitiveNames: true })
    const fs = new ObsidianFileSystem(app as never)
    await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
      expect(await fs.listChildren('')).toEqual([])
      await app.vault.adapter.mkdir(path)
      await fs.mkdir(path)
      expect(await fs.listChildren('')).toEqual([
        expect.objectContaining({ path, kind: 'directory', identity: expect.any(String) }),
      ])
    })
  }
)
