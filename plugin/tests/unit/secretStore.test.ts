/**
 * The synced secret store across devices: each device is a `SecretStore` with a keychain of
 * its own, and all of them share one settings file, the way Obsidian Sync or Syncthing make
 * them share `data.json`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SecretStore, type Keychain, type StoreHost } from '@/secrets/SecretStore'
import { deviceKeyId, isStoreFile, type SecretStoreFile } from '@/secrets/storeFile'

const FAST = { iterations: 1000 }

interface Shared {
  file: unknown
  copies: unknown[]
  clock: number
}

const shared = (): Shared => ({ file: null, copies: [], clock: 1000 })

class FakeKeychain implements Keychain {
  readonly values = new Map<string, string>()
  getSecret(id: string) {
    return this.values.get(id) ?? null
  }
  setSecret(id: string, value: string) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('invalid id')
    this.values.set(id, value)
  }
  deleteSecret(id: string) {
    return this.values.delete(id)
  }
}

interface Device {
  store: SecretStore
  keychain: FakeKeychain
  writes: number
}

/**
 * A device on the shared file. `ids` is what its settings point at; `own` the ids that belong
 * to it alone and must never be in the store.
 */
function device(on: Shared, ids: string[] = [], own?: string[]): Device {
  const keychain = new FakeKeychain()
  const made: Device = { store: null as unknown as SecretStore, keychain, writes: 0 }
  const host: StoreHost = {
    keychain: () => keychain,
    read: () => on.file,
    write: async (file: SecretStoreFile | null) => {
      made.writes++
      // Through JSON, as it goes to disk: nothing is shared by reference between devices.
      on.file = file ? JSON.parse(JSON.stringify(file)) : null
    },
    ids: () => ids,
    conflictCopies: async () => on.copies,
    now: () => ++on.clock,
    ...(own ? { deviceOnly: () => own } : {}),
  }
  made.store = new SecretStore(host)
  return made
}

afterEach(() => vi.restoreAllMocks())

describe('a present but malformed synced store', () => {
  it.each([{}, '', false, 1, { id: 'bad', v: 99 }])(
    'is damaged rather than disabled: %j',
    async (bad) => {
      const on = shared()
      const local = device(on, ['sample-key'])
      local.keychain.setSecret('sample-key', 'invented-value')
      await local.store.enable('sample-passphrase', FAST)
      const valid = on.file
      const slot = deviceKeyId((valid as SecretStoreFile).id)
      const savedKey = local.keychain.getSecret(slot)
      on.file = bad
      await local.store.load()
      expect(local.store.status.value).toBe('damaged')
      expect(local.keychain.getSecret(slot)).toBe(savedKey)
      expect(local.store.get('sample-key')).toBe('invented-value')
      on.file = valid
      await local.store.load()
      expect(local.store.status.value).toBe('unlocked')
    }
  )

  it('retains a saved device key across a cold load of truncated settings', async () => {
    const on = shared()
    const local = device(on)
    await local.store.enable('sample-passphrase', FAST)
    const valid = on.file as SecretStoreFile
    const slot = deviceKeyId(valid.id)
    const saved = local.keychain.getSecret(slot)!
    const restarted = device(on)
    restarted.keychain.setSecret(slot, saved)
    on.file = { id: valid.id, v: 99 }
    await restarted.store.load()
    expect(restarted.store.status.value).toBe('damaged')
    expect(restarted.keychain.getSecret(slot)).toBe(saved)
    on.file = valid
    await restarted.store.load()
    expect(restarted.store.status.value).toBe('unlocked')
  })
})

describe('device-local node credentials', () => {
  it('does not record a local token in an unlocked synced store or carry it to another device', async () => {
    const on = shared()
    const local = device(on)
    await local.store.enable('sample-passphrase', FAST)
    const writes = local.writes
    local.store.setLocal('abele-node-sample', 'sample-token')
    await local.store.flush()
    expect(local.store.getLocal('abele-node-sample')).toBe('sample-token')
    expect(local.store.contents()).toEqual([])
    expect(local.writes).toBe(writes)
    const remote = device(on)
    await remote.store.load()
    await remote.store.unlock('sample-passphrase')
    expect(remote.store.getLocal('abele-node-sample')).toBe('')
    local.store.forgetLocal('abele-node-sample')
    expect(local.store.getLocal('abele-node-sample')).toBe('')
  })
})

describe('turning the store on', () => {
  it('forgetting a deleted connection locally does not revoke a shared token on other devices', async () => {
    const on = shared()
    const local = device(on, ['sample-connection-key'])
    local.keychain.setSecret('sample-connection-key', 'invented-token')
    await local.store.enable('sample-passphrase', FAST)
    const writes = local.writes
    local.store.forgetLocal('sample-connection-key')
    await local.store.flush()
    expect(local.keychain.getSecret('sample-connection-key')).toBeNull()
    expect(local.writes).toBe(writes)
    const other = device(on, ['sample-connection-key'])
    await other.store.load()
    await other.store.unlock('sample-passphrase')
    expect(other.store.get('sample-connection-key')).toBe('invented-token')
  })

  it('moves the secrets the settings point at into it, and nothing else from the keychain', async () => {
    const on = shared()
    const mac = device(on, ['abele-github-token', 'abele-brave-search', 'abele-empty'])
    mac.keychain.setSecret('abele-github-token', 'github_pat_1')
    mac.keychain.setSecret('abele-brave-search', 'BSA-1')
    mac.keychain.setSecret('another-plugins-key', 'not ours')

    await mac.store.enable('passphrase', FAST)

    expect(mac.store.status.value).toBe('unlocked')
    expect(mac.store.count()).toBe(2)
    expect(isStoreFile(on.file)).toBe(true)
    expect(JSON.stringify(on.file)).not.toContain('github_pat_1')
    expect(JSON.stringify(on.file)).not.toContain('not ours')
    // Reads are unchanged for every feature.
    expect(mac.store.get('abele-github-token')).toBe('github_pat_1')
  })

  it('keeps the derived key in the keychain, never the passphrase', async () => {
    const on = shared()
    const mac = device(on)
    await mac.store.enable('my secret phrase', FAST)

    const id = (on.file as SecretStoreFile).id
    const stored = mac.keychain.getSecret(deviceKeyId(id))
    expect(stored).toBeTruthy()
    expect([...mac.keychain.values.values()].join('|')).not.toContain('my secret phrase')
  })
})

describe('a second device', () => {
  async function macWithKeys(on: Shared) {
    const mac = device(on, ['abele-github-token', 'abele-provider-x'])
    mac.keychain.setSecret('abele-github-token', 'github_pat_1')
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    return mac
  }

  it('is locked until the passphrase is typed, and then has every key', async () => {
    const on = shared()
    await macWithKeys(on)
    const phone = device(on, ['abele-github-token', 'abele-provider-x'])

    await phone.store.load()
    expect(phone.store.status.value).toBe('locked')
    expect(phone.store.get('abele-provider-x')).toBe('')

    expect(await phone.store.unlock('passphrase')).toBe(true)
    expect(phone.store.status.value).toBe('unlocked')
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')
    // In the keychain too, so a read before the store opens at the next start finds it.
    expect(phone.keychain.getSecret('abele-github-token')).toBe('github_pat_1')
  })

  it('refuses a wrong passphrase and keeps nothing from the attempt', async () => {
    const on = shared()
    await macWithKeys(on)
    const phone = device(on)
    await phone.store.load()

    expect(await phone.store.unlock('Passphrase')).toBe(false)
    expect(phone.store.status.value).toBe('locked')
    expect(phone.keychain.values.size).toBe(0)
  })

  it('adds a key only it had, without replacing one the store already holds', async () => {
    const on = shared()
    const mac = await macWithKeys(on)
    const phone = device(on, ['abele-provider-x', 'abele-voice'])
    phone.keychain.setSecret('abele-provider-x', 'sk-old-on-phone')
    phone.keychain.setSecret('abele-voice', 'sk-or-phone')

    await phone.store.load()
    await phone.store.unlock('passphrase')
    await phone.store.flush()

    expect(phone.store.get('abele-provider-x')).toBe('sk-1')
    expect(phone.store.get('abele-voice')).toBe('sk-or-phone')

    await mac.store.load()
    expect(mac.store.get('abele-voice')).toBe('sk-or-phone')
    expect(mac.keychain.getSecret('abele-voice')).toBe('sk-or-phone')
  })

  it('sees a key set on the other device once the settings arrive', async () => {
    const on = shared()
    const mac = await macWithKeys(on)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')

    mac.store.set('abele-brave-search', 'BSA-new')
    await mac.store.flush()
    await phone.store.load()

    expect(phone.store.get('abele-brave-search')).toBe('BSA-new')
  })

  it('sees a key removed on the other device go', async () => {
    const on = shared()
    const mac = await macWithKeys(on)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')

    mac.store.remove('abele-provider-x')
    await mac.store.flush()
    await phone.store.load()

    expect(phone.store.get('abele-provider-x')).toBe('')
    expect(phone.keychain.getSecret('abele-provider-x')).toBeNull()
  })
})

describe('two devices writing at once', () => {
  it('loses neither key when one device’s file overwrote the other’s', async () => {
    const on = shared()
    const mac = device(on)
    await mac.store.enable('passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')

    mac.store.set('abele-provider-a', 'from-mac')
    await mac.store.flush()

    // The phone writes from its own copy, which never saw the Mac's key, and wins the sync.
    phone.store.set('abele-provider-b', 'from-phone')
    await phone.store.flush()

    // Obsidian Sync applies the phone's version over the Mac's; the Mac is told data.json
    // changed, reopens, finds its key missing, merges and writes it back.
    await mac.store.load()
    await mac.store.flush()
    await phone.store.load()

    for (const one of [mac, phone]) {
      expect(one.store.get('abele-provider-a')).toBe('from-mac')
      expect(one.store.get('abele-provider-b')).toBe('from-phone')
    }
  })

  it('merges the store out of a Syncthing conflict copy of the settings', async () => {
    const on = shared()
    const mac = device(on)
    await mac.store.enable('passphrase', FAST)
    mac.store.set('abele-provider-a', 'kept-in-conflict-copy')
    await mac.store.flush()

    // Syncthing kept the Mac's file aside as the loser, and put an older one in place.
    on.copies = [JSON.parse(JSON.stringify(on.file))]
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    phone.store.remove('abele-provider-a')
    await phone.store.flush()
    // The removal is newer than the conflict copy's value, so the copy does not bring it back.
    await phone.store.load()
    expect(phone.store.get('abele-provider-a')).toBe('')
  })

  it('writes back a key it found only in a conflict copy', async () => {
    const on = shared()
    const mac = device(on)
    await mac.store.enable('passphrase', FAST)
    const withoutIt = JSON.parse(JSON.stringify(on.file))
    mac.store.set('abele-provider-a', 'only-in-copy')
    await mac.store.flush()

    on.copies = [on.file]
    on.file = withoutIt
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    await phone.store.flush()

    expect(phone.store.get('abele-provider-a')).toBe('only-in-copy')
    on.copies = []
    const third = device(on)
    await third.store.load()
    await third.store.unlock('passphrase')
    expect(third.store.get('abele-provider-a')).toBe('only-in-copy')
  })
})

describe('changing the passphrase', () => {
  it('re-encrypts; another device is out of date until it gets the new one', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('old phrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('old phrase')

    const before = JSON.stringify(on.file)
    await mac.store.changePassphrase('new phrase', FAST)
    expect(JSON.stringify(on.file)).not.toBe(before)
    expect(mac.store.status.value).toBe('unlocked')

    // A key set on the phone before it learns the new passphrase is not lost.
    phone.store.set('abele-provider-y', 'sk-phone')
    await phone.store.load()
    expect(phone.store.status.value).toBe('stale')

    expect(await phone.store.unlock('old phrase')).toBe(false)
    expect(await phone.store.unlock('new phrase')).toBe(true)
    await phone.store.flush()
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')

    await mac.store.load()
    expect(mac.store.get('abele-provider-y')).toBe('sk-phone')
  })
})

describe('removing from this device, and turning it off', () => {
  it('takes the key and the secrets out of this device only', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')

    await phone.store.lock()
    expect(phone.store.status.value).toBe('locked')
    expect(phone.store.get('abele-provider-x')).toBe('')
    expect(phone.keychain.values.size).toBe(0)
    expect(mac.store.get('abele-provider-x')).toBe('sk-1')

    // And it comes back with the passphrase.
    expect(await phone.store.unlock('passphrase')).toBe(true)
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')
  })

  it('turning it off leaves every device with its keys, and the file with none', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    const storeId = (on.file as SecretStoreFile).id
    const macKeyId = deviceKeyId(storeId)

    await mac.store.disable()
    // No store in the file, and a marker saying so: the absence alone turns nothing off.
    expect(isStoreFile(on.file)).toBe(false)
    expect(on.file).toEqual({ off: true, id: storeId })
    expect(mac.store.status.value).toBe('off')
    expect(mac.store.get('abele-provider-x')).toBe('sk-1')
    expect(mac.keychain.getSecret(macKeyId)).toBeNull()

    await phone.store.load()
    expect(phone.store.status.value).toBe('off')
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')
    expect(phone.keychain.getSecret(macKeyId)).toBeNull()
  })

  it('is not turned off by a settings file that simply holds no store', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    const keyId = deviceKeyId((on.file as SecretStoreFile).id)

    // A fresh install's file, a transfer's, an older build's: none of them names a store.
    on.file = null
    await phone.store.load()

    expect(phone.store.status.value).toBe('unlocked')
    expect(phone.keychain.getSecret(keyId)).not.toBeNull()
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')
  })

  it('throwing a store away says so in the file too', async () => {
    const on = shared()
    const mac = device(on)
    await mac.store.enable('passphrase', FAST)
    const id = (on.file as SecretStoreFile).id
    const phone = device(on)
    await phone.store.load()
    expect(phone.store.status.value).toBe('locked')

    await phone.store.discard()
    expect(on.file).toEqual({ off: true, id })
    await mac.store.load()
    expect(mac.store.status.value).toBe('off')
  })

  it('writes only to the keychain once off', async () => {
    const on = shared()
    const mac = device(on)
    mac.store.set('abele-provider-x', 'sk-1')
    await mac.store.flush()
    expect(on.file).toBeNull()
    expect(mac.writes).toBe(0)
    expect(mac.keychain.getSecret('abele-provider-x')).toBe('sk-1')
  })
})

describe('a damaged store', () => {
  it('is reported as damaged, not as a wrong passphrase, and the keychain is left alone', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)

    const file = on.file as SecretStoreFile
    on.file = { ...file, entries: { ...file.entries, data: file.check.data } }
    await mac.store.load()

    expect(mac.store.status.value).toBe('damaged')
    expect(mac.store.get('abele-provider-x')).toBe('sk-1')
  })
})

describe('what reaches the console', () => {
  it('never a secret, a key or the passphrase', async () => {
    const said: string[] = []
    for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      })
    }

    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-very-secret')
    await mac.store.enable('the passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('wrong')
    await phone.store.unlock('the passphrase')
    const file = on.file as SecretStoreFile
    on.file = { ...file, entries: { ...file.entries, data: file.check.data } }
    await phone.store.load()

    const all = said.join('\n')
    expect(all).not.toContain('sk-very-secret')
    expect(all).not.toContain('the passphrase')
    expect(all).not.toContain(mac.keychain.getSecret(deviceKeyId(file.id)) ?? '<none>')
  })
})

describe('what the store says about each key, for the list of keys', () => {
  it('is nothing while the store is off, locked or cannot be opened', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'fake-value-1')
    expect(mac.store.contents()).toBeNull()

    await mac.store.enable('the passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    expect(phone.store.status.value).toBe('locked')
    expect(phone.store.contents()).toBeNull()
  })

  it('names each key, when it was set, and whether this keychain holds the same — never a value', async () => {
    const on = shared()
    const mac = device(on, ['abele-a', 'abele-b', 'abele-c'])
    mac.keychain.setSecret('abele-a', 'fake-a')
    mac.keychain.setSecret('abele-b', 'fake-b')
    mac.keychain.setSecret('abele-c', 'fake-c')
    await mac.store.enable('the passphrase', FAST)
    mac.store.remove('abele-c')
    // Changed behind the store's back — Obsidian's own keychain screen can do that.
    mac.keychain.setSecret('abele-b', 'fake-b-edited')
    mac.keychain.deleteSecret('abele-a')

    const contents = mac.store.contents()!
    expect(JSON.stringify(contents)).not.toMatch(/fake-/)
    const by = Object.fromEntries(contents.map((c) => [c.id, c]))
    expect(by['abele-a']).toMatchObject({ removed: false, inKeychain: 'missing' })
    expect(by['abele-b']).toMatchObject({ removed: false, inKeychain: 'different' })
    expect(by['abele-c']).toMatchObject({ removed: true })
    expect(by['abele-a'].at).toBeGreaterThan(0)
  })
})

/**
 * The sync device token is minted for one device and must stay on it: a phone that received
 * the laptop's token would sync as the laptop, and the server would see one device where there
 * are two. So it has a road of its own, to the keychain and nowhere else.
 */
describe('a secret kept on this device alone', () => {
  it('round-trips through the keychain', () => {
    const mac = device(shared())

    mac.store.device.set('abele-sync-device-1', 'absd_token')

    expect(mac.store.device.get('abele-sync-device-1')).toBe('absd_token')
    expect(mac.keychain.getSecret('abele-sync-device-1')).toBe('absd_token')
    expect(mac.store.device.get('abele-sync-device-unknown')).toBe('')
  })

  it('never enters the store, even with the store open here', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    const writes = mac.writes

    mac.store.device.set('abele-sync-device-1', 'absd_token')
    await mac.store.flush()

    expect(mac.writes).toBe(writes)
    expect(mac.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
    // Another device opening the same store finds no such secret.
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    expect(phone.store.get('abele-sync-device-1')).toBe('')
    expect(phone.keychain.getSecret('abele-sync-device-1')).toBeNull()
  })

  /**
   * The id comes out of the settings, which an agent or another device's file can write. Named
   * at a provider's key, the road would hand that key to the sync server as a bearer token and
   * delete it on Disconnect; only an id this plugin mints for a device token is ever taken.
   */
  it('touches no keychain entry that is not a sync device token', () => {
    const mac = device(shared())
    mac.keychain.setSecret('abele-provider-x', 'sk-provider')

    expect(mac.store.device.get('abele-provider-x')).toBe('')
    mac.store.device.remove('abele-provider-x')
    expect(() => mac.store.device.set('abele-provider-x', 'absd_token')).toThrow()
    expect(mac.store.device.get('abele-sync-device-')).toBe('')

    expect(mac.keychain.getSecret('abele-provider-x')).toBe('sk-provider')
  })

  it('is taken out of the keychain by a removal, and by setting it empty', () => {
    const mac = device(shared())
    mac.store.device.set('abele-sync-device-1', 'absd_token')
    mac.store.device.set('abele-sync-device-2', 'absd_other')

    mac.store.device.remove('abele-sync-device-1')
    mac.store.device.set('abele-sync-device-2', '')

    expect(mac.keychain.getSecret('abele-sync-device-1')).toBeNull()
    expect(mac.keychain.getSecret('abele-sync-device-2')).toBeNull()
    expect(mac.store.device.get('abele-sync-device-1')).toBe('')
  })
})

/**
 * A store that already holds a device-only id — written by a build that let the token in, or by
 * a hand edit. The id is shared between devices (the settings carrying it travel), so the entry
 * would hand one device's token to every other: the store drops it, and drops it quietly — a
 * removal written in its place would take each device's own token out of its keychain.
 */
describe('a device-only id the store already holds', () => {
  const TOKEN = 'abele-sync-device-1'

  /** The token put into the store's entries the way an older build did, and written out. */
  async function leak(mac: Device, value: string): Promise<void> {
    ;(mac.store as unknown as { entries: Record<string, unknown> }).entries[TOKEN] = {
      value,
      at: 5,
    }
    mac.store.set('abele-provider-x', mac.store.get('abele-provider-x'))
    await mac.store.flush()
  }

  async function leaked(on: Shared) {
    // A device of an older build, whose settings counted the token among the store's secrets.
    const mac = device(on, ['abele-provider-x', TOKEN])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    mac.keychain.setSecret(TOKEN, 'absd_mac')
    await mac.store.enable('passphrase', FAST)
    await leak(mac, 'absd_mac')
    expect(mac.store.contents()!.map((c) => c.id)).toContain(TOKEN)
    return mac
  }

  function phoneWithToken(on: Shared) {
    const phone = device(on, ['abele-provider-x'], [TOKEN])
    phone.keychain.setSecret(TOKEN, 'absd_phone')
    return phone
  }

  it('is dropped on unlock and on load, and this device keeps its own token', async () => {
    const on = shared()
    const mac = await leaked(on)
    const phone = phoneWithToken(on)

    await phone.store.load()
    expect(await phone.store.unlock('passphrase')).toBe(true)
    await phone.store.flush()

    expect(phone.keychain.getSecret(TOKEN)).toBe('absd_phone')
    expect(phone.store.device.get(TOKEN)).toBe('absd_phone')
    expect(phone.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')

    // The leaky device writes it back in; the next load drops it again.
    await leak(mac, 'absd_mac2')
    await phone.store.load()
    await phone.store.flush()
    expect(phone.keychain.getSecret(TOKEN)).toBe('absd_phone')
    expect(phone.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
  })

  it('leaves the file without it and without a removal in its place', async () => {
    const on = shared()
    await leaked(on)
    const phone = phoneWithToken(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    await phone.store.flush()

    // A third device opening what the phone wrote finds no such key, removed or not.
    const tablet = device(on)
    tablet.keychain.setSecret(TOKEN, 'absd_tablet')
    await tablet.store.load()
    await tablet.store.unlock('passphrase')
    expect(tablet.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
    expect(tablet.keychain.getSecret(TOKEN)).toBe('absd_tablet')
  })

  it('stays in this device’s keychain when the store is removed from it', async () => {
    const on = shared()
    await leaked(on)
    const phone = phoneWithToken(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')

    await phone.store.lock()

    expect(phone.keychain.getSecret(TOKEN)).toBe('absd_phone')
    expect(phone.keychain.getSecret('abele-provider-x')).toBeNull()
  })

  it('is kept out when something sets it through the store road', async () => {
    const on = shared()
    const phone = device(on, ['abele-provider-x'], [TOKEN])
    phone.keychain.setSecret('abele-provider-x', 'sk-1')
    await phone.store.enable('passphrase', FAST)
    const writes = phone.writes

    phone.store.set(TOKEN, 'absd_phone')
    await phone.store.flush()

    expect(phone.writes).toBe(writes)
    expect(phone.keychain.getSecret(TOKEN)).toBe('absd_phone')
    expect(phone.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
  })
})

/**
 * `data.json` syncs and the later save wins, so a device that wrote the store back every time it
 * read the other's would hand the file back for ever. A load writes only when the store it read
 * is missing something this device holds.
 */
describe('settling', () => {
  async function macWithKeys(on: Shared): Promise<Device> {
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    return mac
  }

  it('writes nothing on a load of a store that holds what this device already has', async () => {
    const on = shared()
    const mac = await macWithKeys(on)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    await phone.store.flush()
    mac.store.set('abele-brave-search', 'BSA-new')
    await mac.store.flush()
    await phone.store.load()
    await phone.store.flush()

    const writes = { mac: mac.writes, phone: phone.writes }
    for (let round = 0; round < 3; round++) {
      await mac.store.load()
      await mac.store.flush()
      await phone.store.load()
      await phone.store.flush()
    }

    expect({ mac: mac.writes, phone: phone.writes }).toEqual(writes)
    expect(phone.store.get('abele-brave-search')).toBe('BSA-new')
  })

  it('settles after two devices wrote at once: one write back, then none', async () => {
    const on = shared()
    const mac = device(on)
    await mac.store.enable('passphrase', FAST)
    const phone = device(on)
    await phone.store.load()
    await phone.store.unlock('passphrase')
    await phone.store.flush()
    mac.store.set('abele-provider-a', 'from-mac')
    await mac.store.flush()
    phone.store.set('abele-provider-b', 'from-phone')
    await phone.store.flush()

    // The Mac finds its key missing and writes it back; after that, loads write nothing.
    await mac.store.load()
    await mac.store.flush()
    await phone.store.load()
    await phone.store.flush()
    const writes = { mac: mac.writes, phone: phone.writes }
    await mac.store.load()
    await mac.store.flush()
    await phone.store.load()
    await phone.store.flush()

    expect({ mac: mac.writes, phone: phone.writes }).toEqual(writes)
  })
})

/**
 * Every id under the reserved prefix is a sync device token's, whichever device minted it and
 * whether or not this device's settings name it (pi review #4). A provider's `apiKeyId`, edited
 * or imported to point at one, must not carry it into the synced store, a transfer or a request.
 */
describe('the reserved device-token names', () => {
  const OTHER = 'abele-sync-device-elsewhere'

  it('are never read through the ordinary road, even where the keychain holds one', () => {
    const mac = device(shared(), ['abele-provider-x', OTHER])
    mac.keychain.setSecret(OTHER, 'absd_other')

    expect(mac.store.get(OTHER)).toBe('')
    expect(mac.store.device.get(OTHER)).toBe('absd_other')
  })

  it('are never moved into the store when it is made, nor recorded later', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x', OTHER])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    mac.keychain.setSecret(OTHER, 'absd_other')
    await mac.store.enable('passphrase', FAST)
    const writes = mac.writes

    mac.store.set('abele-sync-device-third', 'absd_third')
    await mac.store.flush()

    expect(mac.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
    expect(mac.writes).toBe(writes)
  })

  it('are dropped from a store that holds one, and never mirrored into the keychain', async () => {
    const on = shared()
    const mac = device(on, ['abele-provider-x'])
    mac.keychain.setSecret('abele-provider-x', 'sk-1')
    await mac.store.enable('passphrase', FAST)
    // An older build, or a hand edit, put another device's token into the file.
    const leaky = device(on, ['abele-provider-x'])
    await leaky.store.load()
    await leaky.store.unlock('passphrase')
    ;(leaky.store as unknown as { entries: Record<string, unknown> }).entries[OTHER] = {
      value: 'absd_other',
      at: 5,
    }
    leaky.store.set('abele-provider-x', 'sk-2')
    await leaky.store.flush()

    const phone = device(on, ['abele-provider-x'])
    await phone.store.load()
    await phone.store.unlock('passphrase')

    expect(phone.keychain.getSecret(OTHER)).toBeNull()
    expect(phone.store.contents()!.map((c) => c.id)).toEqual(['abele-provider-x'])
  })
})
