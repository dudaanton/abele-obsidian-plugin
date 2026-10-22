import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { requireExternalLifecycleSafety } from '@/sync/external/pluginSafety'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['active', 'completed', 'review', 'objects'])(
  'refuses departure with conditional %s evidence',
  async (area) => {
    const app = buildFakeVault([])
    const values = new Map<string, unknown>()
    Object.assign(app, {
      loadLocalStorage: (key: string) => values.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => {
        values.set(key, value)
      },
    })
    const path = '.obsidian/plugins/abele/sync-conditional/' + area + '/sample.json'
    await app.vault.adapter.mkdir(path.slice(0, path.lastIndexOf('/')))
    await app.vault.adapter.write(path, 'retained bytes')
    await expect(requireExternalLifecycleSafety(app as never, new IDBFactory())).rejects.toThrow(
      /conditional.*recovery/i
    )
    expect(await app.vault.adapter.read(path)).toBe('retained bytes')
  }
)

it('allows empty conditional namespaces at departure', async () => {
  const app = buildFakeVault([])
  const values = new Map<string, unknown>()
  Object.assign(app, {
    loadLocalStorage: (key: string) => values.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, value)
    },
  })
  await app.vault.adapter.mkdir('.obsidian/plugins/abele/sync-conditional/active')
  await expect(
    requireExternalLifecycleSafety(app as never, new IDBFactory())
  ).resolves.toBeUndefined()
})
