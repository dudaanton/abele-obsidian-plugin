import { expect, it } from 'vitest'
import { connectToken } from '@/sync/v2/connect'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'

it('validates authority before storing a key and preserves stable selector identity across restart', async () => {
  const data = new Map<string, unknown>(),
    keys = new Map<string, string>()
  const local = {
    loadLocalStorage: (key: string) => data.get(key),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
  const registry = TokenConnectionRegistry.open(local),
    id = registry.add()
  const secrets = {
    get: (ref: string) => keys.get(ref) ?? null,
    set: (ref: string, key: string) => {
      keys.set(ref, key)
    },
  }
  const scope = { kind: 'group', id: 'group-a', path: 'Groups/Sample.md' }
  const text = btoa(
    JSON.stringify({ v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope })
  )
  const reply = (selector = scope) =>
    Response.json({
      protocol: 2,
      token_id: 'token-a',
      space_id: 'space-a',
      scope: selector,
      status: 'active',
      limits: { max_file_bytes: 1000, quota_bytes: null },
    })
  await expect(
    connectToken(registry, id, text, secrets, async () => reply({ ...scope, id: 'group-other' }))
  ).rejects.toThrow()
  expect(keys.size).toBe(0)
  expect(registry.records()[0].status).toBe('needs-token')
  await connectToken(registry, id, text, secrets, async () =>
    reply({ ...scope, path: 'Groups/Renamed.md' })
  )
  const record = registry.records()[0]
  const reopened = TokenConnectionRegistry.open(local)
  expect(reopened.records()[0]).toEqual(record)
  expect(record.scope?.path).toBe('Groups/Renamed.md')
  expect(JSON.stringify([...data.values()])).not.toContain('a'.repeat(43))
})
