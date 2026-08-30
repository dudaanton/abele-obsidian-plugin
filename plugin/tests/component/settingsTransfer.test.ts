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
import TransferSendModal from '@/components/settings/transfer/TransferSendModal.vue'
import TransferPreviewModal from '@/components/settings/transfer/TransferPreviewModal.vue'
import Input from '@/components/obsidian/Input.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Button from '@/components/obsidian/Button.vue'
import QrCode from '@/components/obsidian/QrCode.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp
/** The keychain as the fake vault implements it, for the test that makes it refuse one id. */
let original: (id: string, value: string) => void

/** The dialog itself belongs to Obsidian; what these tests ask about is what it holds. */
const STUBS = {
  ObsidianModal: { template: '<div><slot /></div>' },
  // Obsidian's own widget, which needs a real app to construct.
  Dropdown: {
    name: 'Dropdown',
    props: ['modelValue', 'options'],
    emits: ['update:model-value'],
    template: '<div class="dropdown-stub" />',
  },
}

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
  app = useVault([
    { path: 'Scripts/tally.js', content: 'const run = () => 42\n' },
    {
      path: 'Notes/Writing.md',
      frontmatter: { type: 'abele-skill', name: 'writing', description: 'How to write' },
      content: 'Write plainly.',
    },
  ])
  const config = AbeleConfig.getInstance()
  config.applySettings({
    refreshDelay: 500,
    ai: {
      ...DEFAULT_AI_SETTINGS,
      providers: [providerNamed('p1', 'openwebui')],
      scriptsFolder: 'Scripts',
    } as AiSettings,
  })
  app.secretStorage.setSecret('key-p1', 'sk-the-secret')
  original = app.secretStorage.setSecret.bind(app.secretStorage)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The cards of the sending screen, by the name each one shows. */
const rowNamed = (wrapper: ReturnType<typeof mount>, name: string) =>
  wrapper.findAll('.abele-card').find((card) => card.text().includes(name))

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
    const show = wrapper.findAllComponents(Button).find((b) => b.props('text') === 'Send')

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
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())

    const shown = wrapper.findComponent(TransferSendModal)
    expect(shown.exists()).toBe(true)
    expect(shown.props('frames').length).toBeGreaterThan(0)
    expect(shown.props('code')).toMatch(/^[A-Z2-9]{8}$/)
  })

  it('sends no code, and needs none, when keys are left behind', async () => {
    const wrapper = open(TransferSettings)

    // The first checkbox on the screen is the one that decides about keys.
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await clickButton(wrapper, 'Send')

    expect(wrapper.findComponent(TransferSendModal).props('code')).toBeUndefined()
  })
})

describe('the preview of what will be sent', () => {
  const openPreview = async () => {
    const wrapper = open(TransferSettings)
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await flushPromises()
    await clickButton(wrapper, 'Preview')
    return wrapper
  }

  it('shows the settings themselves, not a count of them', async () => {
    const wrapper = await openPreview()

    expect(wrapper.findComponent(TransferPreviewModal).exists()).toBe(true)
    expect(wrapper.text()).toContain('https://openwebui.example')
  })

  it('says what it comes to, in items, keys and codes', async () => {
    const wrapper = await openPreview()

    expect(wrapper.text()).toContain('1 item')
    expect(wrapper.text()).toContain('1 key')
    expect(wrapper.text()).toContain('1 code')
  })

  /** A preview anyone can be looking over your shoulder at is not the place for the key. */
  it('masks the key it would send', async () => {
    const wrapper = await openPreview()

    expect(wrapper.text()).not.toContain('sk-the-secret')
    expect(wrapper.text()).toContain('key-p1')
  })

  /**
   * The provider still names the keychain slot it uses — that is settings, and the other side
   * needs it. What must not be there is the block of keys, because none are going.
   */
  it('shows no keys block at all when they are being left behind', async () => {
    const wrapper = open(TransferSettings)
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await flushPromises()
    await clickButton(wrapper, 'Preview')

    const preview = wrapper.findComponent(TransferPreviewModal)
    expect(preview.text()).not.toContain('Keys')
    expect(preview.text()).not.toContain('1 key')
    expect(preview.text()).toContain('apiKeyId')
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
    await clickButton(wrapper, 'Send')

    return wrapper.findComponent(TransferSendModal).props('frames') as string[]
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


describe('the scripts, skills and prompts themselves', () => {
  const sendFile = async (name: string) => {
    const wrapper = open(TransferSettings)
    await flushPromises()
    await rowNamed(wrapper, name)?.trigger('click')
    // Nothing here needs a key, so the transfer stays open and needs no code.
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await flushPromises()
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())

    return wrapper.findComponent(TransferSendModal).props('frames') as string[]
  }

  it('offers a script that lives in the scripts folder', async () => {
    const wrapper = open(TransferSettings)
    await flushPromises()

    expect(rowNamed(wrapper, 'tally.js')).toBeTruthy()
  })

  it('offers a skill by the name it calls itself', async () => {
    const wrapper = open(TransferSettings)
    await flushPromises()

    expect(rowNamed(wrapper, 'writing')).toBeTruthy()
  })

  it('writes an arriving script into this vault', async () => {
    const frames = await sendFile('tally.js')
    const receiving = useVault([])
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      scriptsFolder: 'Scripts',
    } as AiSettings

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => wrapper.text().includes('to apply'))
    await clickButton(wrapper, 'Apply')
    await flushPromises()

    const written = receiving.vault.getFileByPath('Scripts/tally.js')
    expect(written).toBeTruthy()
    expect(await receiving.vault.read(written!)).toBe('const run = () => 42\n')
  })

  /** The other device is entitled to keep its scripts somewhere else entirely. */
  it('puts it in the folder this vault uses, not the one it came from', async () => {
    const frames = await sendFile('tally.js')
    const receiving = useVault([])
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      scriptsFolder: 'Automation',
    } as AiSettings

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => wrapper.text().includes('to apply'))
    await clickButton(wrapper, 'Apply')
    await flushPromises()

    expect(receiving.vault.getFileByPath('Automation/tally.js')).toBeTruthy()
    expect(receiving.vault.getFileByPath('Scripts/tally.js')).toBeNull()
  })

  it('says a file this vault already has, unchanged, would change nothing', async () => {
    const frames = await sendFile('tally.js')

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => wrapper.text().includes('to apply'))

    expect(wrapper.text()).toContain('unchanged')
  })
})

describe('choosing between keeping and replacing', () => {
  /** The sender has one provider; this vault has a different one. */
  const arrive = async () => {
    const wrapper = open(TransferSettings)
    await flushPromises()
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await flushPromises()
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())
    const frames = wrapper.findComponent(TransferSendModal).props('frames') as string[]

    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      providers: [providerNamed('local', 'mine')],
    } as AiSettings

    const receiving = open(TransferScanModal)
    await clickButton(receiving, 'Paste the text')
    await receiving.findComponent(Input).vm.$emit('update:model-value', frames.join('\n'))
    await waitFor(() => receiving.text().includes('to apply'))

    return receiving
  }

  const chooseMode = async (wrapper: ReturnType<typeof open>, mode: string) => {
    const dropdown = wrapper
      .findAllComponents({ name: 'Dropdown' })
      .find((d) => (d.props('options') as { value: string }[])?.some((o) => o.value === 'replace'))
    await dropdown?.vm.$emit('update:model-value', mode)
    await flushPromises()
  }

  it('keeps what is already here by default', async () => {
    const wrapper = await arrive()

    await clickButton(wrapper, 'Apply')

    expect(AbeleConfig.getInstance().ai.providers.map((p) => p.name)).toEqual([
      'mine',
      'openwebui',
    ])
  })

  it('replaces it when that is what was chosen', async () => {
    const wrapper = await arrive()

    await chooseMode(wrapper, 'replace')
    await clickButton(wrapper, 'Apply')

    expect(AbeleConfig.getInstance().ai.providers.map((p) => p.name)).toEqual(['openwebui'])
  })

  it('names what replacing would take away, before it does', async () => {
    const wrapper = await arrive()

    await chooseMode(wrapper, 'replace')

    expect(wrapper.text()).toContain('will be removed')
    expect(wrapper.text()).toContain('mine')
  })

  it('promises to leave the scripts and notes alone either way', async () => {
    const wrapper = await arrive()

    await chooseMode(wrapper, 'replace')

    expect(wrapper.text()).toContain('never deleted')
  })
})

describe('a transfer that carries a key', () => {
  const lockedFrames = async () => {
    const wrapper = open(TransferSettings)
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())
    const shown = wrapper.findComponent(TransferSendModal)

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
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())
    const shown = wrapper.findComponent(TransferSendModal)
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

/**
 * The roads that are not a picture.
 *
 * A real set of settings came to eighty-four codes, on a phone whose webview has no camera at
 * all — so the codes were being photographed one at a time, which is the opposite of what this
 * feature is for. The transfer therefore also goes as one line of text, to paste or to save as
 * a file, and it is the same frame the codes are made of so the receiving side is unchanged.
 */
describe('sending without a camera', () => {
  const clipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  const send = async () => {
    const wrapper = open(TransferSettings)
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    // Keys off: what is being asked here is how the transfer travels, not how it is locked.
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await flushPromises()
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())

    return wrapper.findComponent(TransferSendModal)
  }

  it('copies the whole transfer as one line, not as a pile of codes', async () => {
    const writeText = clipboard()
    const modal = await send()

    await clickButton(modal, 'Copy the text')

    const copied = writeText.mock.calls[0][0] as string
    expect(copied.split('\n')).toHaveLength(1)
    expect(copied).toBe(modal.props('text'))
  })

  it('is read on the other side in one paste', async () => {
    const modal = await send()
    const text = modal.props('text') as string
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings

    const wrapper = open(TransferScanModal)
    await clickButton(wrapper, 'Paste the text')
    await wrapper.findComponent(Input).vm.$emit('update:model-value', text)
    await flushPromises()

    expect(wrapper.text()).toContain('openwebui')
  })

  it('saves it into the vault, under a name a file may have', async () => {
    const modal = await send()

    await clickButton(modal, 'Save a file')

    const saved = app.vault.getFiles().filter((file) => file.path.startsWith('Abele transfer'))
    expect(saved).toHaveLength(1)
    expect(saved[0].path).toMatch(/^Abele transfer \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.txt$/)
    await expect(app.vault.read(saved[0])).resolves.toBe(modal.props('text'))
  })
})

describe('what the sending screen leads with', () => {
  const modalWith = (count: number) =>
    open(TransferSendModal, {
      frames: Array.from({ length: count }, (_, i) => `ABL1:ABCD:${i + 1}/${count}:AAAA:X`),
      text: 'ABL1:ABCD:1/1:AAAA:X',
    })

  it('shows a short series straight away, because a camera can still do it', () => {
    const modal = modalWith(3)

    expect(modal.findComponent(QrCode).exists()).toBe(true)
  })

  it('does not put eighty-four codes in front of anyone', () => {
    const modal = modalWith(84)

    expect(modal.findComponent(QrCode).exists()).toBe(false)
    expect(modal.text()).toContain('84 codes')
  })

  it('still shows them to whoever asks', async () => {
    const modal = modalWith(84)

    await clickButton(modal, 'Show the codes')

    expect(modal.findComponent(QrCode).exists()).toBe(true)
  })
})

describe('reading a transfer out of a file', () => {
  /** The picker is the browser's; what is being tested is what happens to what it hands back. */
  const pick = async (wrapper: ReturnType<typeof mount>, contents: string) => {
    const input = {
      type: '',
      files: [new File([contents], 'transfer.txt', { type: 'text/plain' })],
      onchange: null as (() => void) | null,
      click() {
        this.onchange?.()
      },
    }
    // `createEl` is Obsidian's, and belongs to the window the settings opened in — here there
    // is only one window and no Obsidian, so it is put there for the picker to find.
    Object.defineProperty(document, 'createEl', {
      value: (tag: string) => (tag === 'input' ? input : document.createElement(tag)),
      configurable: true,
    })

    await clickButton(wrapper, 'Open a file')
    await flushPromises()
  }

  const transferText = async () => {
    const wrapper = open(TransferSettings)
    await rowNamed(wrapper, 'openwebui')?.trigger('click')
    await wrapper.findComponent(Checkbox).vm.$emit('toggle')
    await flushPromises()
    await clickButton(wrapper, 'Send')
    await waitFor(() => wrapper.findComponent(TransferSendModal).exists())

    return wrapper.findComponent(TransferSendModal).props('text') as string
  }

  it('takes the whole transfer out of the file it was saved as', async () => {
    const text = await transferText()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings

    const wrapper = open(TransferScanModal)
    await pick(wrapper, text)

    expect(wrapper.text()).toContain('openwebui')
  })

  /** A file picked by mistake must say so, rather than looking like nothing happened. */
  it('says so when there is no transfer in it', async () => {
    const wrapper = open(TransferScanModal)

    await pick(wrapper, 'Dear diary, today I picked the wrong file.')

    expect(wrapper.text()).toContain('No transfer in that file.')
  })
})
