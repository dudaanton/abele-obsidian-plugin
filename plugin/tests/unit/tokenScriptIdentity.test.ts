import { expect, it } from 'vitest'
import { ConnectionRegistry } from '@/sync/connectionRegistry'
import {
  scriptConnectionKey,
  hasScriptConnection,
  assertCurrentScriptConnection,
} from '@/scripting/trust/scriptConnection'
it('uses the current token record rather than retired singleton identity for script invalidation', () => {
  const data = new Map<string, unknown>(),
    local = {
      loadLocalStorage: (key: string) => structuredClone(data.get(key) ?? null),
      saveLocalStorage: (key: string, value: unknown) => {
        data.set(key, structuredClone(value))
      },
    }
  const registry = ConnectionRegistry.open(local),
    first = registry.add(),
    second = registry.add()
  const keys = new Map<string, string>(),
    secretPort = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, key: string) => {
        keys.set(id, key)
      },
    }
  const token = {
    v: 1 as const,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder' as const, id: 'root', path: '/' },
  }
  const authority = {
    protocol: 2 as const,
    token_id: 'sample',
    space_id: 'sample',
    scope: token.scope,
    status: 'active' as const,
  }
  registry.attach(first, token, authority, secretPort)
  registry.attach(second, { ...token, address: 'https://other.example' }, authority, secretPort)
  const initial = scriptConnectionKey(local)
  expect(initial).toBe(scriptConnectionKey(registry.storage(first)))
  expect(hasScriptConnection(local)).toBe(true)
  registry.setPaused(first, true)
  expect(scriptConnectionKey(local)).toBe(initial)
  registry.select(second)
  expect(scriptConnectionKey(local)).not.toBe(initial)
  expect(scriptConnectionKey(registry.storage(first))).toBe(initial)
  expect(() =>
    assertCurrentScriptConnection(local, {
      localVault: 'sample',
      endpoint: token.address,
      vaultId: authority.space_id,
      principal: authority.token_id,
      facet: 'personal',
      grantId: null,
    })
  ).toThrow()
})
