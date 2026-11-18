import { expect, it } from 'vitest'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'

it('inherits the existing local placement only for the same authenticated scope', () => {
  const values = new Map<string, unknown>(),
    keys = new Map<string, string>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key, value) => {
      values.set(key, structuredClone(value))
    },
  })
  const secrets = {
    get: (key: string) => keys.get(key) ?? null,
    set: (key: string, value: string) => {
      keys.set(key, value)
    },
  }
  const scope = { kind: 'folder' as const, id: 'folder-a', path: 'Shared' }
  const attach = (id: string, tokenId: string, selector = scope) =>
    registry.attach(
      id,
      { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope: selector },
      {
        protocol: 2,
        token_id: tokenId,
        space_id: 'sample-space',
        scope: selector,
        status: 'active',
      },
      secrets
    )
  const source = registry.add()
  attach(source, 'source')
  registry.setLocalRoot(source, 'Imported')
  registry.setServerRoot(source, 'Shared moved')
  const child = registry.add(true)
  attach(child, 'owned')
  registry.storage(child).saveLocalStorage('abele-sync-token-state:scope-owned-by', source)
  registry.inheritScopePlacement(child, source)
  expect(registry.records().find((record) => record.id === child)).toMatchObject({
    localRoot: 'Imported',
    serverRoot: 'Shared moved',
  })
  const unrelated = registry.add(true)
  attach(unrelated, 'other', { ...scope, id: 'other-folder', path: 'Other' })
  registry.storage(unrelated).saveLocalStorage('abele-sync-token-state:scope-owned-by', source)
  expect(() => registry.inheritScopePlacement(unrelated, source)).toThrow()
})
