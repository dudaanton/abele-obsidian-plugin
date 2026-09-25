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

/** A device on the shared file. `ids` is what its settings point at. */
function device(on: Shared, ids: string[] = []): Device {
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
  }
  made.store = new SecretStore(host)
  return made
}

afterEach(() => vi.restoreAllMocks())

describe('turning the store on', () => {
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
    const macKeyId = deviceKeyId((on.file as SecretStoreFile).id)

    await mac.store.disable()
    expect(on.file).toBeNull()
    expect(mac.store.status.value).toBe('off')
    expect(mac.store.get('abele-provider-x')).toBe('sk-1')
    expect(mac.keychain.getSecret(macKeyId)).toBeNull()

    await phone.store.load()
    expect(phone.store.status.value).toBe('off')
    expect(phone.store.get('abele-provider-x')).toBe('sk-1')
    expect(phone.keychain.getSecret(macKeyId)).toBeNull()
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
