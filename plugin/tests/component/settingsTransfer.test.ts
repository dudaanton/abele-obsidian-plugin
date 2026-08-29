/**
 * The two halves of a settings transfer, meeting.
 *
 * The sending screen turns what was ticked into codes; the receiving one reads those very
 * codes back and writes what arrived. Testing them apart would leave the join untested, and
 * the join is the whole feature — so these drive the real screens against each other, with
 * the frames passed between them the way a camera would.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TransferSettings from '@/components/settings/TransferSettings.vue'
import TransferScanModal from '@/components/settings/transfer/TransferScanModal.vue'
import TransferShowModal from '@/components/settings/transfer/TransferShowModal.vue'
import Input from '@/components/obsidian/Input.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Button from '@/components/obsidian/Button.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp
/** The keychain as the fake vault implements it, for the test that makes it refuse one id. */
let original: (id: string, value: string) => void

/** The dialog itself belongs to Obsidian; what these tests ask about is what it holds. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

const open = <T>(component: T, props: Record<string, unknown> = {}) =>
  mount(component as never, { props, global: { stubs: STUBS } })

const providerNamed = (id: string, name: string) => ({
  id,
  name,
  baseUrl: `https://${name}.example`,
  apiKeyId: `key-${id}`,
  models: [{ id: 'm1', name: 'Model one' }],
})

beforeEach(() => {
  app = useVault([])
  const config = AbeleConfig.getInstance()
  config.applySettings({
    refreshDelay: 500,
    ai: { ...DEFAULT_AI_SETTINGS, providers: [providerNamed('p1', 'openwebui')] } as AiSettings,
  })
  app.secretStorage.setSecret('key-p1', 'sk-the-secret')
  original = app.secretStorage.setSecret.bind(app.secretStorage)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The rows of the sending screen, by the name each one shows. */
const rowNamed = (wrapper: ReturnType<typeof mount>, name: string) =>
  wrapper.findAll('.abele-transfer__entry').find((row) => row.text().includes(name))

const clickButton = async (wrapper: ReturnType<typeof mount>, text: string) => {
  const button = wrapper.findAllComponents(Button).find((b) => b.props('text') === text)
  await button?.trigger('click')
  await flushPromises()
}

/**
 * Waits for something the browser is actually computing.
 *
 * Locking a transfer derives a key, which is deliberately expensive and lands well after the
 * microtasks `flushPromises` drains — so anything behind the encryption has to be waited for
 * in real time, not in ticks.
 */
const waitFor = async (ready: () => boolean, timeout = 4000) => {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for the transfer')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await flushPromises()
}

describe('choosing what to send', () => {
  it('offers what the settings actually hold', () => {
    const wrapper = open(TransferSettings)

    expect(rowNamed(wrapper, 'openwebui')).toBeTruthy()
  })

  it('will not make a transfer out of nothing', () => {
    const wrapper = open(TransferSettings)
    const show = wrapper.findAllComponents(Button).find((b) => b.props('text') === 'Show QR')

    expect(show?.props('disabled')).toBe(true)
  })

  it('says how many codes the selection comes to', async () => {
    const wrapper = open(TransferSettings)

    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Fits in one code')
  })

  it('shows the codes, with a one-time code because a key is going along', async () => {
    const wrapper = open(TransferSettings)

    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await clickButton(wrapper, 'Show QR')
    await waitFor(() => wrapper.findComponent(TransferShowModal).exists())

    const shown = wrapper.findComponent(TransferShowModal)
    expect(shown.exists()).toBe(true)
    expect(shown.props('frames').length).toBeGreaterThan(0)
    expect(shown.props('code')).toMatch(/^[A-Z2-9]{8}$/)
  })

  it('sends no code, and needs none, when keys are left behind', async () => {
    const wrapper = open(TransferSettings)

    // The first checkbox on the screen is the one that decides about keys.
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await clickButton(wrapper, 'Show QR')

    expect(wrapper.findComponent(TransferShowModal).props('code')).toBeUndefined()
  })
})

describe('reading a transfer on the other device', () => {
  /** What the sending screen produced, handed over the way a camera would deliver it. */
  const framesFor = async () => {
    const wrapper = open(TransferSettings)
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    // Keys off: the locked case has its own test, and this one is about what arrives.
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await flushPromises()
    await clickButton(wrapper, 'Show QR')

    return wrapper.findComponent(TransferShowModal).props('frames') as string[]
  }

  const paste = async (wrapper: ReturnType<typeof mount>, frames: string[]) => {
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await flushPromises()
  }

  it('says what would happen before anything is written', async () => {
    const frames = await framesFor()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await paste(wrapper, frames)

    expect(wrapper.text()).toContain('openwebui')
    expect(wrapper.text()).toContain('new')
    expect(AbeleConfig.getInstance().ai.providers).toHaveLength(0)
  })

  it('writes what was accepted into the settings', async () => {
    const frames = await framesFor()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await paste(wrapper, frames)
    await clickButton(wrapper, 'Apply')

    expect(AbeleConfig.getInstance().ai.providers.map((p) => p.name)).toEqual(['openwebui'])
    expect(wrapper.emitted('applied')?.[0]?.[0]).toMatchObject({ items: 1, keysRefused: 0 })
  })

  it('calls a provider it already has a replacement rather than a new one', async () => {
    const frames = await framesFor()

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await paste(wrapper, frames)

    expect(wrapper.text()).toContain('unchanged')
  })

  it('collects the frames it is given without minding the order', async () => {
    const frames = await framesFor()

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await paste(wrapper, [...frames].reverse())

    expect(wrapper.text()).toContain('openwebui')
  })
})

describe('a transfer that carries a key', () => {
  const lockedFrames = async () => {
    const wrapper = open(TransferSettings)
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await clickButton(wrapper, 'Show QR')
    await waitFor(() => wrapper.findComponent(TransferShowModal).exists())
    const shown = wrapper.findComponent(TransferShowModal)

    return { frames: shown.props('frames') as string[], code: shown.props('code') as string }
  }

  it('asks for the code before it will say what is inside', async () => {
    const { frames } = await lockedFrames()

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => wrapper.text().includes('locked'))

    expect(wrapper.text()).toContain('locked')
    expect(wrapper.text()).not.toContain('openwebui')
  })

  it('refuses a code that is not the one', async () => {
    const { frames } = await lockedFrames()

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => wrapper.text().includes('locked'))
    await wrapper.findComponent(Input).vm.$emit('update:model-value', 'WRONGONE')
    await clickButton(wrapper, 'Unlock')
    await waitFor(() => wrapper.text().includes('does not open'))

    expect(wrapper.text()).toContain('does not open')
  })

  /**
   * Obsidian refuses a key id that is not lowercase letters, numbers and dashes, and a
   * transfer can carry any id at all — from an older settings file, or one edited by hand.
   * One refusal must not leave the settings half applied.
   */
  it('applies the rest when the keychain refuses one of the keys', async () => {
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      providers: [providerNamed('p1', 'openwebui'), providerNamed('P2', 'other')],
    } as AiSettings
    app.secretStorage.setSecret('key-p1', 'sk-the-secret')
    // Both keys travel; it is the writing of the second one this vault will refuse.
    app.secretStorage.setSecret('key-P2', 'sk-the-other')
    const refusing = vi
      .spyOn(app.secretStorage, 'setSecret')
      .mockImplementation((id: string, value: string) => {
        if (id === 'key-P2') throw new Error('Secret ID is invalid')
        original(id, value)
      })

    const wrapper = open(TransferSettings)
    for (const name of ['openwebui', 'other']) await rowNamed(wrapper, name)?.trigger('click')
    await clickButton(wrapper, 'Show QR')
    await waitFor(() => wrapper.findComponent(TransferShowModal).exists())
    const shown = wrapper.findComponent(TransferShowModal)
    const frames = shown.props('frames') as string[]
    const code = shown.props('code') as string

    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings
    const receiving = open(TransferScanModal)
    await clickButton(receiving, 'Paste the text')
    await receiving.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => receiving.text().includes('locked'))
    await receiving.findComponent(Input).vm.$emit('update:model-value', code)
    await clickButton(receiving, 'Unlock')
    await waitFor(() => receiving.text().includes('to apply'))
    await clickButton(receiving, 'Apply')

    expect(refusing).toHaveBeenCalled()
    expect(AbeleConfig.getInstance().ai.providers).toHaveLength(2)
    expect(receiving.emitted('applied')?.[0]?.[0]).toMatchObject({ items: 2, keysRefused: 1 })
  })

  it("puts the key into this device's keychain once unlocked", async () => {
    const { frames, code } = await lockedFrames()
    app.secretStorage.setSecret('key-p1', '')

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => wrapper.text().includes('locked'))
    await wrapper.findComponent(Input).vm.$emit('update:model-value', code)
    await clickButton(wrapper, 'Unlock')
    await waitFor(() => wrapper.text().includes('to apply'))
    await clickButton(wrapper, 'Apply')

    expect(app.secretStorage.getSecret('key-p1')).toBe('sk-the-secret')
  })
})
