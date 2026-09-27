/**
 * The sync connection as a transfer carries it.
 *
 * The sending device never hands over its own token: it asks the server for a device of the
 * receiver's own and sends that one's. What is asserted here is the entry around it — what it
 * says before and after that device exists, what a receiver takes out of it, and that the size
 * cap, which is each device's own, never travels.
 */
import { afterEach, describe, it, expect } from 'vitest'
import {
  CONNECTION_SECTION,
  CONNECTION_TOKEN,
  connectionEntry,
  matchConnection,
  readTransferred,
  withSibling,
  withoutConnection,
} from '@/transfer/connection'
import { emptyConnection, type DeviceConnection } from '@/sync/connection'
import { storeReceivedKeys } from '@/transfer/receivedKeys'
import { sectionLabel } from '@/transfer/entries'
import { SecretStore, setSecrets, type Keychain } from '@/secrets/SecretStore'

const connected = (): DeviceConnection => {
  const connection: DeviceConnection = {
    ...emptyConnection(),
    serverUrl: 'https://sync.example.com',
    enrolledUrl: 'https://sync.example.com',
    vaultId: 'v1',
    vaultName: 'Home',
    deviceId: 'd1',
    deviceTokenId: 'abele-sync-device-abc',
    deviceName: 'Laptop',
    migrated: true,
  }
  connection.selective.video = false
  connection.selective.excludedFolders = ['Archive']
  connection.selective.maxFileBytes = 1024
  return connection
}

const SIBLING = {
  serverUrl: 'https://sync.example.com',
  vaultId: 'v1',
  vaultName: 'Home',
  deviceId: 'd2',
  deviceName: 'Phone',
  token: 'absd_sibling',
}

describe('the connection entry on the sending side', () => {
  it('is offered only by a device that is connected', () => {
    expect(connectionEntry(emptyConnection())).toBeNull()
    expect(connectionEntry({ ...connected(), vaultId: '' })).toBeNull()
  })

  it('names where the device syncs and what it takes, never its token or its cap', () => {
    const entry = connectionEntry(connected())!

    expect(entry.section).toBe(CONNECTION_SECTION)
    expect(entry.secretIds).toEqual([CONNECTION_TOKEN])
    expect(entry.data).toMatchObject({
      serverUrl: 'https://sync.example.com',
      vaultId: 'v1',
      vaultName: 'Home',
    })
    const text = JSON.stringify(entry)
    expect(text).not.toContain('abele-sync-device-abc')
    expect(text).not.toContain('d1')
    expect(text).not.toContain('maxFileBytes')
    expect((entry.data as { selective: object }).selective).toMatchObject({
      video: false,
      excludedFolders: ['Archive'],
    })
    expect(sectionLabel(CONNECTION_SECTION)).toBe('Sync connection')
  })

  it('carries the device made for the other side, and its token as a secret', () => {
    const { entry, secrets } = withSibling(connectionEntry(connected())!, SIBLING)

    expect(entry.data).toMatchObject({ deviceId: 'd2', deviceName: 'Phone', vaultId: 'v1' })
    expect(JSON.stringify(entry)).not.toContain('absd_sibling')
    expect(secrets).toEqual({ [CONNECTION_TOKEN]: 'absd_sibling' })
  })

  it('carries only what the device syncs when no device was made for the other side', () => {
    const entry = withoutConnection(connectionEntry(connected())!)

    expect(Object.keys(entry.data as object)).toEqual(['selective'])
    expect(entry.secretIds).toEqual([])
  })
})

describe('the connection entry on the receiving side', () => {
  const sent = () => withSibling(connectionEntry(connected())!, SIBLING)

  it('hands over the connection and its token when both arrived', () => {
    const { entry, secrets } = sent()

    const got = readTransferred(entry, secrets)

    expect(got.connection).toEqual({
      serverUrl: 'https://sync.example.com',
      vaultId: 'v1',
      vaultName: 'Home',
      deviceId: 'd2',
      deviceName: 'Phone',
    })
    expect(got.token).toBe('absd_sibling')
    expect(got.selective).toMatchObject({ video: false, excludedFolders: ['Archive'] })
    expect(got.selective).not.toHaveProperty('maxFileBytes')
  })

  it('hands over no connection without its token, nor a token without its connection', () => {
    const { entry } = sent()

    expect(readTransferred(entry, {}).connection).toBeNull()
    expect(
      readTransferred(withoutConnection(entry), { [CONNECTION_TOKEN]: 'absd_x' })
    ).toMatchObject({ connection: null, token: '' })
  })

  it('takes no size cap, whatever a sender put in', () => {
    const { entry, secrets } = sent()
    const data = entry.data as { selective: Record<string, unknown> }
    data.selective.maxFileBytes = 5

    expect(readTransferred(entry, secrets).selective).not.toHaveProperty('maxFileBytes')
  })

  it('tells a device that syncs nothing, the same vault and another one apart', () => {
    const arrived = readTransferred(sent().entry, sent().secrets).connection!

    expect(matchConnection(emptyConnection(), arrived)).toBe('none')
    expect(matchConnection(connected(), arrived)).toBe('same')
    expect(
      matchConnection({ ...connected(), serverUrl: 'HTTPS://sync.example.com:443/' }, arrived)
    ).toBe('same')
    expect(matchConnection({ ...connected(), vaultId: 'v2' }, arrived)).toBe('other')
    expect(
      matchConnection({ ...connected(), serverUrl: 'https://other.example.com' }, arrived)
    ).toBe('other')
  })
})

describe('the token a transfer brought', () => {
  afterEach(() => setSecrets(null))

  it('is never put into the keychain or the store as a received key', async () => {
    const keychain = new Map<string, string>()
    const chain: Keychain = {
      getSecret: (id) => keychain.get(id) ?? null,
      setSecret: (id, value) => void keychain.set(id, value),
      deleteSecret: (id) => keychain.delete(id),
    }
    let file: unknown = null
    const store = new SecretStore({
      keychain: () => chain,
      read: () => file,
      write: async (next) => {
        file = next
      },
      ids: () => [],
      conflictCopies: async () => [],
      now: () => Date.now(),
    })
    await store.enable('passphrase', { iterations: 1000 })
    setSecrets(store)
    const { entry, secrets } = withSibling(connectionEntry(connected())!, SIBLING)

    expect(storeReceivedKeys([entry], secrets)).toBe(0)
    await store.flush()

    expect([...keychain.values()]).not.toContain('absd_sibling')
    expect(store.contents()!.map((c) => c.id)).toEqual([])
  })
})
