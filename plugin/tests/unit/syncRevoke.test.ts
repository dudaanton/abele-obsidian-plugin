/**
 * Telling a server a device has left: what counts as told, what is tried again later, and what
 * is never sent at all. The round trip against a real server is in the integration tier; this
 * is the reading of each answer, against a `fetch` that counts what it was asked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type AbelePlugin from '@/main'
import { Revoker, tellServer } from '@/sync/revoke'
import { emptyConnection, type DeviceConnection, type PendingRevoke } from '@/sync/connection'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'

const TOKEN = 'absd_0123456789'

/** A `fetch` that answers every request with `answer`, and remembers what it was asked. */
function counting(answer: () => Promise<Response>): typeof fetch & { calls: string[] } {
  const calls: string[] = []
  const fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input))
    return answer()
  }) as typeof globalThis.fetch & { calls: string[] }
  fetch.calls = calls
  return fetch
}

const envelope = (code: string, status: number): Response =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('telling the server this device left', () => {
  it('says revoked when the server took the token back', async () => {
    const fetch = counting(() => Promise.resolve(new Response(null, { status: 204 })))

    expect(await tellServer('https://sync.example.com', TOKEN, fetch)).toEqual({ told: 'revoked' })
    expect(fetch.calls).toEqual(['https://sync.example.com/v1/devices/self'])
  })

  it('says already when the server no longer takes the token', async () => {
    const fetch = counting(() => Promise.resolve(envelope('unauthorized', 401)))

    expect((await tellServer('https://sync.example.com', TOKEN, fetch)).told).toBe('already')
  })

  it('tries again later when the server is unreachable or failing', async () => {
    const gone = counting(() => Promise.reject(new Error('the network is gone')))
    const failing = counting(() => Promise.resolve(envelope('internal', 503)))

    expect((await tellServer('https://sync.example.com', TOKEN, gone)).told).toBe('failed')
    expect((await tellServer('https://sync.example.com', TOKEN, failing)).told).toBe('failed')
  })

  it('gives up waiting on a server that never answers', async () => {
    const silent = counting(() => new Promise<Response>(() => undefined))

    const told = await tellServer('https://sync.example.com', TOKEN, silent, 20)

    expect(told.told).toBe('failed')
    expect(told.reason).toContain('did not answer')
  })

  it('sends nothing that is not a device token, nor to an address the https rule refuses', async () => {
    const fetch = counting(() => Promise.resolve(new Response(null, { status: 204 })))

    expect((await tellServer('https://sync.example.com', 'sk-provider', fetch)).told).toBe(
      'unusable'
    )
    expect((await tellServer('https://sync.example.com', '', fetch)).told).toBe('unusable')
    expect((await tellServer('http://192.168.1.5:8787', TOKEN, fetch)).told).toBe('unusable')
    expect(fetch.calls).toEqual([])
  })
})

/**
 * The revoker's own bookkeeping, against a keychain of a fake vault and a connection held in
 * memory: what it keeps when the server cannot be told, what it leaves alone, and how long a
 * sign-in waits on it.
 */
describe('the revoker', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const plugin = { manifest: { id: 'abele' } } as unknown as AbelePlugin
  let app: FakeApp
  let connection: DeviceConnection
  let notes: string[]
  let telling: (string | null)[]

  const host = (transport: typeof fetch) => ({
    transport: () => transport,
    note: (text: string) => void notes.push(text),
    connection: () => connection,
    saveConnection: (patch: { pendingRevoke: PendingRevoke[] }) => {
      connection = { ...connection, ...patch }
    },
    telling: (line: string | null) => void telling.push(line),
  })

  const LAN = { serverUrl: 'http://192.168.1.5:8787', deviceId: 'd1', deviceName: 'Laptop' }
  const WEB = { serverUrl: 'https://sync.example.com', deviceId: 'd2', deviceName: 'Phone' }

  beforeEach(() => {
    AbeleConfig.getInstance().init({ ...plugin, loadData: () => Promise.resolve({}) } as never)
    app = buildFakeVault([])
    setSecrets(createPluginSecrets({ ...plugin, app } as unknown as AbelePlugin))
    connection = emptyConnection()
    notes = []
    telling = []
  })

  afterEach(() => setSecrets(null))

  it('keeps a device on plain http to another machine as one that cannot be told, sending nothing', async () => {
    const fetch = counting(() => Promise.resolve(new Response(null, { status: 204 })))
    const revoker = new Revoker(host(fetch))

    const told = await revoker.leave(LAN, TOKEN)

    expect(told.told).toBe('unusable')
    expect(fetch.calls).toEqual([])
    expect(connection.pendingRevoke).toHaveLength(1)
    const [entry] = connection.pendingRevoke
    expect(entry).toMatchObject({ ...LAN, plainHttp: true })
    expect(secrets().device.get(entry!.tokenId)).toBe(TOKEN)
  })

  it('never sends such a one on a retry, and never gives it up on its own', async () => {
    const fetch = counting(() => Promise.resolve(new Response(null, { status: 204 })))
    const revoker = new Revoker(host(fetch))
    await revoker.leave(LAN, TOKEN)
    const [entry] = connection.pendingRevoke
    connection = {
      ...connection,
      pendingRevoke: [{ ...entry!, since: new Date(Date.now() - 40 * DAY_MS).toISOString() }],
    }

    await revoker.retry()

    expect(fetch.calls).toEqual([])
    expect(connection.pendingRevoke).toHaveLength(1)
    expect(secrets().device.get(entry!.tokenId)).toBe(TOKEN)

    revoker.forget(entry!.tokenId)
    expect(connection.pendingRevoke).toEqual([])
    expect(secrets().device.get(entry!.tokenId)).toBe('')
  })

  it('says it kept nothing when the keychain will not take the copy to tell the server later', async () => {
    const gone = counting(() => Promise.reject(new Error('the network is gone')))
    const setSecret = app.secretStorage.setSecret.bind(app.secretStorage)
    app.secretStorage.setSecret = (id: string, value: string) => {
      if (id.startsWith('abele-sync-device-revoke-')) throw new Error('the keychain refused')
      setSecret(id, value)
    }
    const revoker = new Revoker(host(gone))

    const told = await revoker.leave(WEB, TOKEN)

    expect(told).toMatchObject({ told: 'failed', kept: false })
    expect(connection.pendingRevoke).toEqual([])
    expect(notes.join('\n')).toContain('the keychain refused')
  })

  it('lets a sign-in wait on a hanging server no longer than it is given, saying who is being told', async () => {
    const silent = counting(() => new Promise<Response>(() => undefined))
    const revoker = new Revoker(host(silent))
    const tokenId = 'abele-sync-device-revoke-abc'
    secrets().device.set(tokenId, TOKEN)
    connection = {
      ...connection,
      pendingRevoke: [{ ...WEB, tokenId, since: new Date().toISOString(), plainHttp: false }],
    }

    const started = Date.now()
    await revoker.retryWithin(40)

    expect(Date.now() - started).toBeLessThan(2000)
    expect(telling).toEqual(['Telling https://sync.example.com that Phone left…', null])
    expect(connection.pendingRevoke).toHaveLength(1)
  })
})
