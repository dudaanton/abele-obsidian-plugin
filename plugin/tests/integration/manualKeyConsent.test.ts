import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { setRequestGuard } from '@/helpers/http'
import {
  checkKeyDestination,
  checkRequestDestinations,
  initializeDestinations,
  pendingDestinations,
  destinationAccepted,
  acceptDestinations,
} from '@/secrets/destinations'
import { allowKeyRecipient } from '@/secrets/manualConsent'
import { allowedHttpOrigins, forgetHttpOrigin } from '@/secrets/keyTransport'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { GlobalStore } from '@/stores/GlobalStore'
import { collectEntries } from '@/transfer/entries'
import { prepareSecretRequest } from '@/ai/tools/secretUtils'

const network = vi.hoisted(() => vi.fn())
vi.mock('obsidian', async () => ({
  ...(await vi.importActual('../mocks/obsidian')),
  requestUrl: network,
}))
const ORIGIN = 'http://192.168.42.12:8123'
const VALUE = 'fake-sample-key-material'
const context = () =>
  buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
const literal = () =>
  context().fetch(`${ORIGIN}/status`, { headers: { Authorization: `Bearer ${VALUE}` } })
const config = () => AbeleConfig.getInstance()

beforeEach(() => {
  setSecrets(null)
  const app = useVault([])
  app.secretStorage.setSecret('sample-key', VALUE)
  app.secretStorage.setSecret('other-key', 'fake-other-key-material')
  config().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [],
    secrets: [
      { name: 'Sample', keyId: 'sample-key' },
      { name: 'Other', keyId: 'other-key' },
    ],
  }
  vi.spyOn(config(), 'saveSettings').mockResolvedValue()
  initializeDestinations(config())
  setRequestGuard((request) => checkRequestDestinations(request, config()))
  network
    .mockReset()
    .mockResolvedValue({ status: 200, headers: {}, text: VALUE, arrayBuffer: new ArrayBuffer(0) })
})
afterEach(() => {
  setRequestGuard(undefined)
  setSecrets(null)
  vi.restoreAllMocks()
})

describe('manual concrete key and recipient consent', () => {
  it('unblocks the unchanged literal-header script from an empty pending list, without replay', async () => {
    expect(pendingDestinations(config())).toEqual([])
    await expect(literal()).rejects.toThrow(/unencrypted HTTP/)
    expect(network).not.toHaveBeenCalled()
    await allowKeyRecipient({ keyId: 'sample-key', address: `${ORIGIN}/status` })
    expect(network).not.toHaveBeenCalled()
    const result = await literal()
    expect(result.status).toBe(200)
    expect(result.text).toBe('[saved key]')
    expect(network).toHaveBeenCalledTimes(1)
    expect(network.mock.calls[0][0].headers.Authorization).toBe(`Bearer ${VALUE}`)
    expect(config().ai.secrets[0].allowedOrigins).toEqual([ORIGIN])
    expect(
      prepareSecretRequest({ url: ORIGIN, headers: { Authorization: '${abele_key:Sample}' } })
        .headers.Authorization
    ).toBe(VALUE)
  })
  it('grants only the selected pair, not other keys, unknown credentials, hosts or ports', async () => {
    await allowKeyRecipient({ keyId: 'sample-key', address: ORIGIN })
    for (const headers of [
      { 'X-API-Key': 'fake-other-key-material' },
      { 'X-API-Key': 'fake-unknown-key-material' },
    ]) {
      await expect(context().fetch(ORIGIN, { headers })).rejects.toThrow()
    }
    for (const url of ['http://192.168.42.12:8124', 'http://192.168.42.13:8123']) {
      await expect(context().fetch(url, { headers: { 'X-API-Key': VALUE } })).rejects.toThrow()
    }
    expect(config().ai.secrets[1].allowedOrigins).toBeUndefined()
    expect(network).not.toHaveBeenCalled()
  })
  it('can choose a service key by safe catalog metadata without changing its existing service', async () => {
    config().ai.providers = [
      {
        id: 'sample-provider',
        name: 'Sample service',
        baseUrl: 'https://service.sample.example',
        apiKeyId: 'sample-service-key',
        models: [],
      },
    ]
    secrets().set('sample-service-key', 'fake-service-key-material')
    await allowKeyRecipient({ address: ORIGIN, keyId: 'sample-service-key' })
    expect(config().ai.providers[0].baseUrl).toBe('https://service.sample.example')
    expect(config().ai.secrets.find((s) => s.keyId === 'sample-service-key')?.name).toBe(
      'Sample service'
    )
    expect(() => checkKeyDestination('sample-service-key', ORIGIN, config())).not.toThrow()
  })
  it('explicitly creates a protected key without storing its exact material in ordinary data', async () => {
    const exact = '  fake-new-key-material\n'
    await allowKeyRecipient({ address: ORIGIN, newKey: { name: 'New sample', value: exact } })
    const key = config().ai.secrets.find((s) => s.name === 'New sample')!
    expect(secrets().get(key.keyId)).toBe(exact)
    expect(JSON.stringify(config().ai)).not.toContain('fake-new-key-material')
    expect(JSON.stringify(allowedHttpOrigins())).not.toContain('fake-new-key-material')
    expect(() => checkKeyDestination(key.keyId, ORIGIN, config())).not.toThrow()
    const transfer = collectEntries(config()).find(
      (entry) => entry.section === 'ai-secrets' && entry.label === 'New sample'
    )!
    expect(transfer.secretIds).toEqual([key.keyId])
    expect(transfer.data).toEqual(key)
    expect(JSON.stringify(transfer)).not.toContain('fake-new-key-material')
  })
  it('does not overwrite on name collision or send reserved/unknown slots', async () => {
    secrets().set('abele-store-key-sample', 'fake-reserved-key')
    config().ai.secrets.push({
      name: 'Reserved sample',
      keyId: 'abele-store-key-sample',
      allowedOrigins: [ORIGIN],
    })
    const reserved = { keyId: 'abele-store-key-sample', name: 'Reserved sample', origin: ORIGIN }
    acceptDestinations([reserved])
    expect(destinationAccepted(reserved)).toBe(false)
    for (const request of [
      { address: ORIGIN, newKey: { name: 'Sample', value: 'fake-replacement' } },
      { address: ORIGIN, keyId: 'abele-store-key-sample' },
      { address: ORIGIN, keyId: 'unlisted-slot' },
    ])
      await expect(allowKeyRecipient(request)).rejects.toThrow()
    expect(secrets().get('sample-key')).toBe(VALUE)
    expect(allowedHttpOrigins()).toEqual([])
  })
  it.each(['existing', 'new'] as const)(
    'refuses %s-key consent before any mutation when settings are unreadable',
    async (kind) => {
      vi.spyOn(config(), 'settingsUnreadable', 'get').mockReturnValue(true)
      const before = JSON.stringify(config().ai)
      const set = vi.spyOn(secrets(), 'set')
      const localWrites = vi.spyOn(GlobalStore.getInstance().app, 'saveLocalStorage')
      const request =
        kind === 'new'
          ? { address: ORIGIN, newKey: { name: 'Unreadable sample', value: 'fake-unreadable-key' } }
          : { address: ORIGIN, keyId: 'sample-key' }
      await expect(allowKeyRecipient(request)).rejects.toThrow()
      expect(set).not.toHaveBeenCalled()
      expect(config().saveSettings).not.toHaveBeenCalled()
      expect(localWrites).not.toHaveBeenCalled()
      expect(JSON.stringify(config().ai)).toBe(before)
      expect(allowedHttpOrigins()).toEqual([])
    }
  )
  it('rolls back its protected key if settings become unreadable during the store flush', async () => {
    let unreadable = false
    vi.spyOn(config(), 'settingsUnreadable', 'get').mockImplementation(() => unreadable)
    const store = secrets()
    const set = vi.spyOn(store, 'set')
    vi.spyOn(store, 'flush').mockImplementation(async () => {
      unreadable = true
    })
    await expect(
      allowKeyRecipient({
        address: ORIGIN,
        newKey: { name: 'Flush sample', value: 'fake-flush-key' },
      })
    ).rejects.toThrow()
    const keyId = set.mock.calls[0][0]
    expect(store.get(keyId)).toBe('')
    expect(config().ai.secrets.map((s) => s.name)).toEqual(['Sample', 'Other'])
    expect(config().saveSettings).not.toHaveBeenCalled()
    expect(destinationAccepted({ keyId, name: 'Flush sample', origin: ORIGIN })).toBe(false)
    expect(allowedHttpOrigins()).toEqual([])
  })
  it.each(['existing', 'new'] as const)(
    'rolls back %s-key consent when a resolving save leaves settings unreadable',
    async (kind) => {
      let unreadable = false
      vi.spyOn(config(), 'settingsUnreadable', 'get').mockImplementation(() => unreadable)
      const store = secrets()
      const set = vi.spyOn(store, 'set')
      vi.mocked(config().saveSettings).mockImplementationOnce(async () => {
        config().ai = { ...config().ai, maxIterations: 43 }
        unreadable = true
        // A save can resolve without writing while the settings file cannot be read.
      })
      const request =
        kind === 'new'
          ? { address: ORIGIN, newKey: { name: 'Skipped sample', value: 'fake-skipped-key' } }
          : { address: ORIGIN, keyId: 'sample-key' }
      await expect(allowKeyRecipient(request)).rejects.toThrow('Could not save key permission')
      const keyId = kind === 'new' ? set.mock.calls[0][0] : 'sample-key'
      expect(store.get(keyId)).toBe(kind === 'new' ? '' : VALUE)
      expect(config().ai.secrets.map((s) => s.name)).toEqual(['Sample', 'Other'])
      expect(config().ai.secrets[0].allowedOrigins ?? []).toEqual([])
      expect(config().ai.maxIterations).toBe(43)
      expect(destinationAccepted({ keyId, name: 'Skipped sample', origin: ORIGIN })).toBe(false)
      expect(allowedHttpOrigins()).toEqual([])
    }
  )
  it('rolls back metadata, new key and permissions on save failure, preserving unrelated edits', async () => {
    vi.mocked(config().saveSettings).mockImplementationOnce(async () => {
      config().ai = { ...config().ai, maxIterations: 37 }
      throw new Error('Sample save failure')
    })
    await expect(
      allowKeyRecipient({
        address: ORIGIN,
        newKey: { name: 'Failed sample', value: 'fake-failed-key' },
      })
    ).rejects.toThrow()
    expect(config().ai.secrets.map((s) => s.name)).toEqual(['Sample', 'Other'])
    expect(config().ai.maxIterations).toBe(37)
    expect(allowedHttpOrigins()).toEqual([])
  })
  it('rolls back an existing origin on failure without deleting its key', async () => {
    vi.mocked(config().saveSettings).mockRejectedValueOnce(new Error('Sample failure'))
    await expect(allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' })).rejects.toThrow()
    expect(config().ai.secrets[0].allowedOrigins ?? []).toEqual([])
    expect(secrets().get('sample-key')).toBe(VALUE)
    expect(allowedHttpOrigins()).toEqual([])
  })
  it('cancels an in-flight save when closed and never grants the recipient', async () => {
    const controller = new AbortController()
    vi.mocked(config().saveSettings).mockImplementationOnce(async () => {
      controller.abort()
    })
    await expect(
      allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' }, controller.signal)
    ).rejects.toThrow()
    expect(config().ai.secrets[0].allowedOrigins ?? []).toEqual([])
    expect(allowedHttpOrigins()).toEqual([])
  })
  it('requires confirmation on another device even with synced named metadata', async () => {
    await allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' })
    useVault([])
    initializeDestinations({ ...config(), ai: { ...config().ai, secrets: [] } })
    expect(() => checkKeyDestination('sample-key', ORIGIN, config())).toThrow()
  })
  it('does not retain any plaintext secret in local trust storage', async () => {
    const app = GlobalStore.getInstance().app
    const writes = vi.spyOn(app, 'saveLocalStorage')
    await allowKeyRecipient({
      address: ORIGIN,
      newKey: { name: 'Local sample', value: 'fake-local-key-material' },
    })
    expect(JSON.stringify(writes.mock.calls)).not.toContain('fake-local-key-material')
  })
  it('cleans up a keychain write that throws after storing the new key', async () => {
    const store = secrets()
    const set = store.set.bind(store)
    let attempted = ''
    vi.spyOn(store, 'set').mockImplementation((id, value) => {
      attempted = id
      set(id, value)
      throw new Error('fake-private-error')
    })
    await expect(
      allowKeyRecipient({
        address: ORIGIN,
        newKey: { name: 'Broken sample', value: 'fake-broken-value' },
      })
    ).rejects.toThrow('Could not save')
    expect(store.get(attempted)).toBe('')
    expect(config().ai.secrets).toHaveLength(2)
    expect(allowedHttpOrigins()).toEqual([])
  })
  it('revokes its local pair and removes only its new origin after a local persistence failure', async () => {
    const app = GlobalStore.getInstance().app
    const save = app.saveLocalStorage.bind(app)
    vi.spyOn(app, 'saveLocalStorage').mockImplementation((key, value) => {
      save(key, value)
      if (key === 'abele-key-http-origins-v1' && Array.isArray(value) && value.includes(ORIGIN)) {
        throw new Error('Sample local failure')
      }
    })
    await expect(allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' })).rejects.toThrow()
    expect(allowedHttpOrigins()).toEqual([])
    expect(() => checkKeyDestination('sample-key', ORIGIN, config())).toThrow()
    expect(config().ai.secrets[0].allowedOrigins ?? []).toEqual([])
  })
  it('continues cleanup when a rollback storage write itself throws', async () => {
    const app = GlobalStore.getInstance().app
    const save = app.saveLocalStorage.bind(app)
    vi.spyOn(app, 'saveLocalStorage').mockImplementation((key, value) => {
      save(key, value)
      if (key === 'abele-key-http-origins-v1') throw new Error('Sample rollback write failure')
    })
    await expect(allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' })).rejects.toThrow()
    expect(allowedHttpOrigins()).toEqual([])
    expect(config().ai.secrets[0].allowedOrigins ?? []).toEqual([])
    expect(destinationAccepted({ keyId: 'sample-key', name: 'Sample', origin: ORIGIN })).toBe(false)
    expect(secrets().get('sample-key')).toBe(VALUE)
  })
  it('preserves independent catalog edits on rollback and does not delete an adopted new key', async () => {
    vi.mocked(config().saveSettings).mockImplementationOnce(async () => {
      config().ai = {
        ...config().ai,
        secrets: config().ai.secrets.map((s) => ({
          ...s,
          allowedOrigins: [...(s.allowedOrigins ?? []), 'https://independent.sample.example'],
        })),
      }
      throw new Error('Sample save failure')
    })
    await expect(allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' })).rejects.toThrow()
    expect(config().ai.secrets[0].allowedOrigins).toEqual(['https://independent.sample.example'])
    vi.mocked(config().saveSettings).mockImplementationOnce(async () => {
      const added = config().ai.secrets.find((s) => s.name === 'Adopted sample')!
      config().ai = {
        ...config().ai,
        secrets: config().ai.secrets.map((s) =>
          s === added ? { ...s, name: 'Independent sample' } : s
        ),
      }
      throw new Error('Sample save failure')
    })
    await expect(
      allowKeyRecipient({
        address: ORIGIN,
        newKey: { name: 'Adopted sample', value: 'fake-adopted-key' },
      })
    ).rejects.toThrow()
    const adopted = config().ai.secrets.find((s) => s.name === 'Independent sample')!
    expect(secrets().get(adopted.keyId)).toBe('fake-adopted-key')
    expect(allowedHttpOrigins()).toEqual([])
  })
  it('serialises competing new-name submissions without overwriting', async () => {
    const results = await Promise.allSettled([
      allowKeyRecipient({
        address: ORIGIN,
        newKey: { name: 'Concurrent sample', value: 'fake-first-key' },
      }),
      allowKeyRecipient({
        address: ORIGIN,
        newKey: { name: 'Concurrent sample', value: 'fake-second-key' },
      }),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(
      secrets().get(config().ai.secrets.find((s) => s.name === 'Concurrent sample')!.keyId)
    ).toBe('fake-first-key')
  })
  it('removing the HTTP exception blocks the literal request again', async () => {
    await allowKeyRecipient({ address: ORIGIN, keyId: 'sample-key' })
    forgetHttpOrigin(ORIGIN)
    await expect(literal()).rejects.toThrow(/unencrypted HTTP/)
    expect(network).not.toHaveBeenCalled()
  })
  it('preserves HTTPS, loopback and ordinary keyless HTTP, and denies public HTTP', async () => {
    await allowKeyRecipient({ address: 'https://API.SAMPLE.EXAMPLE:443/path', keyId: 'sample-key' })
    await context().fetch('https://api.sample.example/status', { headers: { 'X-API-Key': VALUE } })
    await context().fetch('http://localhost:8123', {
      headers: { Authorization: 'Bearer fake-loopback-only' },
    })
    await context().fetch(ORIGIN)
    await context().fetch('http://public.sample.example')
    await expect(
      allowKeyRecipient({ address: 'http://public.sample.example', keyId: 'sample-key' })
    ).rejects.toThrow()
    expect(network).toHaveBeenCalledTimes(4)
  })
})
