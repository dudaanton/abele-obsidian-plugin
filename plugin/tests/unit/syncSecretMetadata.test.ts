import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import { syncSecretKeychain } from '@/sync/secretMetadata'

it('bounds metadata through years of missing probes and retired credentials, retaining live and unrelated secrets', () => {
  const values = new Map([
    ['provider-key', 'provider'],
    ['abele-sync-device-token-live', 'live'],
  ])
  const secretsMeta: Record<string, unknown> = { 'provider-key': { lastAccess: 1 } }
  for (let i = 0; i < 5000; i++) secretsMeta[`abele-sync-device-token-old-${i}`] = { lastAccess: i }
  const host = {
    secretsMeta,
    listSecrets: () => [...values.keys()],
    getSecret: (id: string) => {
      secretsMeta[id] = { lastAccess: 2 }
      return values.get(id) ?? null
    },
    setSecret: (id: string, value: string) => {
      values.set(id, value)
    },
    deleteSecret: (id: string) => values.delete(id),
  }
  let stored: unknown = structuredClone(secretsMeta)
  const app = {
    secretStorage: host,
    loadLocalStorage: () => stored,
    saveLocalStorage: (_key: string, value: unknown) => {
      stored = structuredClone(value)
    },
  } as unknown as App
  const before = JSON.stringify(stored).length
  const keychain = syncSecretKeychain(app)
  for (let i = 0; i < 5000; i++) {
    const id = `abele-sync-device-token-new-${i}`
    expect(keychain.getSecret(id)).toBeNull()
    keychain.setSecret(id, 'sample-token')
    expect(keychain.getSecret(id)).toBe('sample-token')
    keychain.deleteSecret!(id)
    expect(keychain.getSecret(id)).toBeNull()
  }
  expect(values.size).toBe(2)
  expect(Object.keys(host.secretsMeta)).toEqual(['provider-key'])
  expect(stored).toEqual(host.secretsMeta)
  expect(keychain.getSecret('abele-sync-device-token-live')).toBe('live')
  console.info('secret metadata chars', { before, after: JSON.stringify(stored).length })
})
