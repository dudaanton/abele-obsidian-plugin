/**
 * The synced keys section, driven the way a person would: set a passphrase, unlock another
 * device, get it wrong, remove the keys from a device, turn it off. Each "device" is a store
 * with its own keychain over one shared settings file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import SecretStoreSettings from '@/components/settings/SecretStoreSettings.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import Badge from '@/components/obsidian/Badge.vue'
import { SecretStore, setSecrets, type Keychain } from '@/secrets/SecretStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

let file: unknown = null

function device(keys: Record<string, string> = {}): {
  store: SecretStore
  keychain: Map<string, string>
} {
  const values = new Map(Object.entries(keys))
  const keychain: Keychain = {
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, value) => void values.set(id, value),
    deleteSecret: (id) => values.delete(id),
  }
  const store = new SecretStore({
    keychain: () => keychain,
    read: () => file,
    write: async (next) => {
      file = next ? JSON.parse(JSON.stringify(next)) : null
    },
    ids: () => ['abele-provider-p'],
    conflictCopies: async () => [],
    now: () => Date.now(),
  })
  return { store, keychain: values }
}

const button = (view: VueWrapper, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)

const badge = (view: VueWrapper) => view.findComponent(Badge).props('text')

async function type(view: VueWrapper, values: string[]) {
  const inputs = view.findAllComponents(Input)
  for (const [i, value] of values.entries()) await inputs[i].find('input').setValue(value)
}

/** Clicks and waits for PBKDF2 at its real cost, which is a real wait. */
async function press(view: VueWrapper, text: string) {
  await button(view, text)!.trigger('click')
  for (
    let i = 0;
    i < 50 && view.findAllComponents(Button).some((b) => b.props('disabled') && b.props('accent'));
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await flushPromises()
}

beforeEach(() => {
  file = null
  useVault([])
  AbeleConfig.getInstance().applySettings({
    refreshDelay: 300,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      providers: [
        { id: 'p', name: 'P', baseUrl: 'http://x', apiKeyId: 'abele-provider-p', models: [] },
      ],
    },
  })
})

afterEach(() => setSecrets(null))

describe('synced keys, on the device that sets them up', () => {
  it('asks for the passphrase twice and will not take a short or mismatched one', async () => {
    const mac = device({ 'abele-provider-p': 'sk-1' })
    setSecrets(mac.store)
    const view = mount(SecretStoreSettings, { global: { stubs: STUBS } })
    expect(badge(view)).toBe('Off')

    await button(view, 'Set up')!.trigger('click')
    await type(view, ['short', 'short'])
    expect(button(view, 'Turn on')!.props('disabled')).toBe(true)
    await type(view, ['long enough', 'long enougH'])
    expect(button(view, 'Turn on')!.props('disabled')).toBe(true)
    expect(view.text()).toContain('The two do not match.')

    await type(view, ['long enough', 'long enough'])
    expect(button(view, 'Turn on')!.props('disabled')).toBe(false)
    await press(view, 'Turn on')

    expect(badge(view)).toBe('Unlocked on this device')
    expect(view.text()).toContain('1 key in the store')
    expect(JSON.stringify(file)).not.toContain('sk-1')
  })
})

describe('synced keys, on another device', () => {
  async function storeFromMac() {
    const mac = device({ 'abele-provider-p': 'sk-1' })
    await mac.store.enable('long enough', { iterations: 1000 })
  }

  it('says it is locked, refuses a wrong passphrase and opens with the right one', async () => {
    await storeFromMac()
    const phone = device()
    await phone.store.load()
    setSecrets(phone.store)
    const view = mount(SecretStoreSettings, { global: { stubs: STUBS } })
    expect(badge(view)).toBe('Locked on this device')

    await type(view, ['wrong one'])
    await press(view, 'Unlock')
    expect(view.text()).toContain('That passphrase does not open the store.')
    expect(badge(view)).toBe('Locked on this device')

    await type(view, ['long enough'])
    await press(view, 'Unlock')
    expect(badge(view)).toBe('Unlocked on this device')
    expect(phone.keychain.get('abele-provider-p')).toBe('sk-1')
  })

  it('removes the keys from this device after asking', async () => {
    await storeFromMac()
    const phone = device()
    await phone.store.load()
    await phone.store.unlock('long enough')
    setSecrets(phone.store)
    const view = mount(SecretStoreSettings, { global: { stubs: STUBS } })

    await button(view, 'Remove')!.trigger('click')
    expect(view.text()).toContain('the 1 key in the store leave')
    const confirm = view.findAllComponents(Button).filter((b) => b.props('text') === 'Remove')
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(badge(view)).toBe('Locked on this device')
    expect(phone.keychain.get('abele-provider-p')).toBeUndefined()
  })

  it('turns off everywhere, keeping the keys here', async () => {
    await storeFromMac()
    const phone = device()
    await phone.store.load()
    await phone.store.unlock('long enough')
    setSecrets(phone.store)
    const view = mount(SecretStoreSettings, { global: { stubs: STUBS } })

    await button(view, 'Turn off')!.trigger('click')
    const confirm = view.findAllComponents(Button).filter((b) => b.props('text') === 'Turn off')
    await confirm[confirm.length - 1].trigger('click')
    await flushPromises()

    expect(badge(view)).toBe('Off')
    expect(file).toBeNull()
    expect(phone.keychain.get('abele-provider-p')).toBe('sk-1')
  })
})
