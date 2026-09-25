/**
 * Every key the plugin knows on this device, in one dialog: masked until asked, shown for half
 * a minute, copied without being shown, all of them copied only after a warning, and — with
 * the synced store locked here — an unlock that brings the store's own keys into the list.
 *
 * Every value is fake. The console is watched throughout: no value may ever reach it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { Notice } from 'obsidian'

const clip = vi.hoisted(() => ({ text: '', readable: true }))
vi.mock('@/secrets/clipboard', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/secrets/clipboard')>()
  return {
    ...real,
    platformClipboard: () => ({
      write: async (text: string) => {
        clip.text = text
      },
      read: clip.readable ? async () => clip.text : null,
    }),
  }
})

import SecretsListModal from '@/components/settings/SecretsListModal.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { SecretStore, setSecrets, type Keychain } from '@/secrets/SecretStore'
import { CLEAR_AFTER_MS } from '@/secrets/clipboard'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }
const FAST = { iterations: 1000 }

let file: unknown = null
const said: string[] = []

function device(keys: Record<string, string>, ids: string[]) {
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
    ids: () => ids,
    conflictCopies: async () => [],
    now: () => Date.now(),
  })
  return { store, keychain: values }
}

const cardFor = (view: VueWrapper, name: string) =>
  view.findAll('.abele-card').find((c) => c.find('.abele-card__name').text() === name)!

const iconIn = (view: VueWrapper, name: string, tooltip: string) =>
  cardFor(view, name)
    .findAllComponents(Icon)
    .find((i) => i.props('tooltip') === tooltip)

const button = (view: VueWrapper, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)

const open = () => mount(SecretsListModal, { global: { stubs: STUBS } })

beforeEach(() => {
  file = null
  clip.text = ''
  clip.readable = true
  Notice.shown.length = 0
  said.length = 0
  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      said.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  }
  useVault([])
  AbeleConfig.getInstance().applySettings({
    refreshDelay: 300,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      providers: [
        { id: 'p', name: 'OpenAI', baseUrl: 'http://x', apiKeyId: 'abele-provider-p', models: [] },
      ],
      secrets: [{ name: 'Weather', keyId: 'abele-secret-1' }],
    },
  })
})

afterEach(() => {
  expect(said.join('\n')).not.toMatch(/fake-(openai|weather|github)-value/)
  setSecrets(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the list of keys', () => {
  it('names every key with where it is used and shows none of the values', async () => {
    const mac = device({ 'abele-provider-p': 'fake-openai-value' }, [])
    setSecrets(mac.store)
    const view = open()

    expect(cardFor(view, 'OpenAI').text()).toContain('AI provider · OpenAI')
    expect(cardFor(view, 'Weather').text()).toContain('Not set')
    expect(view.text()).not.toContain('fake-openai-value')
    // A key that is not set has nothing to show or copy.
    expect(iconIn(view, 'Weather', 'Show the key')).toBeUndefined()
  })

  it('shows a value only when asked, and hides it again after half a minute', async () => {
    vi.useFakeTimers()
    const mac = device({ 'abele-provider-p': 'fake-openai-value' }, [])
    setSecrets(mac.store)
    const view = open()

    await iconIn(view, 'OpenAI', 'Show the key')!.trigger('click')
    expect(cardFor(view, 'OpenAI').text()).toContain('fake-openai-value')

    await vi.advanceTimersByTimeAsync(29_000)
    expect(view.text()).toContain('fake-openai-value')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(view.text()).not.toContain('fake-openai-value')
  })

  it('hides a shown value when the window goes to the background', async () => {
    const mac = device({ 'abele-provider-p': 'fake-openai-value' }, [])
    setSecrets(mac.store)
    const view = open()
    await iconIn(view, 'OpenAI', 'Show the key')!.trigger('click')
    expect(view.text()).toContain('fake-openai-value')

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    expect(view.text()).not.toContain('fake-openai-value')
  })

  it('copies a key without showing it, and clears it off the clipboard a minute later', async () => {
    vi.useFakeTimers()
    const mac = device({ 'abele-provider-p': 'fake-openai-value' }, [])
    setSecrets(mac.store)
    const view = open()

    await iconIn(view, 'OpenAI', 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe('fake-openai-value')
    expect(view.text()).not.toContain('fake-openai-value')
    expect(Notice.shown.at(-1)).toMatch(/cleared from the clipboard in a minute/)

    view.unmount()
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS)
    expect(clip.text).toBe('')
  })

  it('where the clipboard cannot be read back, says it stays there', async () => {
    clip.readable = false
    const mac = device({ 'abele-provider-p': 'fake-openai-value' }, [])
    setSecrets(mac.store)
    const view = open()
    await iconIn(view, 'OpenAI', 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(Notice.shown.at(-1)).toMatch(/stays on the clipboard/)
  })

  it('copies all of them only after a warning, as one block of lines', async () => {
    const mac = device(
      { 'abele-provider-p': 'fake-openai-value', 'abele-secret-1': 'fake-weather-value' },
      []
    )
    setSecrets(mac.store)
    const view = open()

    await button(view, 'Copy all')!.trigger('click')
    expect(clip.text).toBe('')
    const confirm = view.findComponent(ConfirmModal)
    expect(confirm.props('message')).toMatch(/every key/i)

    confirm.vm.$emit('confirm')
    await flushPromises()
    expect(clip.text).toBe(
      'OpenAI (abele-provider-p) = fake-openai-value\nWeather (abele-secret-1) = fake-weather-value'
    )
  })
})

describe('with the synced store locked on this device', () => {
  it('says the store may hold more, and unlocking here brings its keys into the list', async () => {
    const mac = device({ 'abele-github-token': 'fake-github-value' }, ['abele-github-token'])
    await mac.store.enable('long enough', FAST)

    const phone = device({ 'abele-provider-p': 'fake-openai-value' }, ['abele-provider-p'])
    await phone.store.load()
    setSecrets(phone.store)
    const view = open()

    expect(view.text()).toMatch(/locked on this device/i)
    expect(view.text()).not.toContain('abele-github-token')
    expect(cardFor(view, 'OpenAI').text()).toContain('Store locked')

    await view.findComponent(Input).find('input').setValue('long enough')
    await button(view, 'Unlock')!.trigger('click')
    for (let i = 0; i < 50 && phone.store.status.value !== 'unlocked'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await flushPromises()

    // Used by no setting on this device, but in the store: listed, by its keychain id.
    expect(cardFor(view, 'abele-github-token').text()).toContain('Not used by any setting')
    expect(cardFor(view, 'OpenAI').text()).toContain('Synced')
  })
})
