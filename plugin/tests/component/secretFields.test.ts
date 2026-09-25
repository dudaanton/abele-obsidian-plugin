/**
 * Every field in the settings that holds a key or a token can show the key it holds and copy
 * it, right where the key was entered: the AI providers, web search, voice input, image
 * providers, the named secrets, the GitHub token and the Firefly III token.
 *
 * Shown only when asked for; copied through the same clipboard as the list of all keys, so on
 * the desktop it comes off the clipboard a minute later. Every value is fake.
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

import SecretField from '@/components/settings/SecretField.vue'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import GithubSettings from '@/components/settings/GithubSettings.vue'
import FinanceSettings from '@/components/settings/FinanceSettings.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { CLEAR_AFTER_MS } from '@/secrets/clipboard'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { GITHUB_TOKEN_KEY_ID, DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { FIREFLY_TOKEN_KEY_ID } from '@/secrets/legacy'
import { voiceKeyId } from '@/ai/transcriptionSettings'
import { DEFAULT_VOICE_SETTINGS } from '@/ai/transcriptionSettings'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

const icon = (view: VueWrapper, tooltip: string) =>
  view.findAllComponents(Icon).find((i) => i.props('tooltip') === tooltip)

/** The field whose stored value is `value`, found by what it would show. */
const fieldHolding = (view: VueWrapper, value: string) =>
  view.findAllComponents(SecretField).find((f) => f.props('value') === value)

beforeEach(() => {
  app = useVault([])
  clip.text = ''
  clip.readable = true
  Notice.shown.length = 0
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a secret field', () => {
  const mountField = (value: string) =>
    mount(SecretField, { props: { value, modelValue: '', placeholder: 'sk-...' } })

  it('masks the stored key until asked, then shows all of it, and hides it again', async () => {
    const view = mountField('sk-fake-provider-value')
    expect(view.text()).not.toContain('sk-fake-provider-value')
    expect(view.text()).toContain('sk-f••••alue')

    await icon(view, 'Show the key')!.trigger('click')
    expect(view.text()).toContain('sk-fake-provider-value')

    await icon(view, 'Hide the key')!.trigger('click')
    expect(view.text()).not.toContain('sk-fake-provider-value')
  })

  it('copies the stored key, and clears it off the clipboard a minute later', async () => {
    vi.useFakeTimers()
    const view = mountField('sk-fake-provider-value')

    await icon(view, 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe('sk-fake-provider-value')
    expect(Notice.shown.at(-1)).toMatch(/cleared from the clipboard in a minute/)

    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS)
    expect(clip.text).toBe('')
  })

  it('where the clipboard cannot be read back, copies and says it stays there', async () => {
    clip.readable = false
    const view = mountField('sk-fake-provider-value')
    await icon(view, 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe('sk-fake-provider-value')
    expect(Notice.shown.at(-1)).toMatch(/stays on the clipboard/)
  })

  it('offers nothing to show or copy while no key is stored', () => {
    const view = mountField('')
    expect(icon(view, 'Show the key')).toBeUndefined()
    expect(icon(view, 'Copy the key')).toBeUndefined()
  })

  it('saves a new key typed into it', async () => {
    const view = mountField('sk-old-value-000')
    await view.setProps({ modelValue: 'sk-new' })
    await icon(view, 'Save key')!.trigger('click')
    expect(view.emitted('save')).toHaveLength(1)
  })
})

describe('the AI settings', () => {
  beforeEach(() => {
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      providers: [
        { id: 'p', name: 'OpenAI', baseUrl: 'http://x', apiKeyId: 'abele-provider-p', models: [] },
      ],
      braveSearchApiKey: 'abele-brave-search',
      imageProviders: [
        {
          id: 'img',
          name: 'Pictures',
          apiType: 'openai',
          endpoint: '',
          apiKeyId: 'abele-img-img',
          models: [],
        },
      ],
      voice: { ...DEFAULT_VOICE_SETTINGS },
    } as AiSettings
    app.secretStorage.setSecret('abele-provider-p', 'fake-provider-value')
    app.secretStorage.setSecret('abele-brave-search', 'fake-brave-value')
    app.secretStorage.setSecret('abele-img-img', 'fake-image-value')
    app.secretStorage.setSecret(voiceKeyId(DEFAULT_VOICE_SETTINGS), 'fake-voice-value')
  })

  const open = () =>
    mount(GeneralSettings, { global: { stubs: { Search: true, Dropdown: true, Checkbox: true } } })

  it.each([
    ['provider', 'fake-provider-value'],
    ['web search', 'fake-brave-value'],
    ['image provider', 'fake-image-value'],
    ['voice input', 'fake-voice-value'],
  ])('shows and copies the %s key where it is entered', async (_, value) => {
    const view = open()
    const field = fieldHolding(view, value)
    expect(field).toBeDefined()
    expect(view.text()).not.toContain(value)

    await icon(field!, 'Show the key')!.trigger('click')
    expect(field!.text()).toContain(value)

    await icon(field!, 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe(value)
  })

  it('copies a named secret through the same clipboard, cleared later on the desktop', async () => {
    AbeleConfig.getInstance().ai = {
      ...AbeleConfig.getInstance().ai,
      secrets: [{ name: 'Weather', keyId: 'abele-secret-1' }],
    }
    app.secretStorage.setSecret('abele-secret-1', 'fake-weather-value')
    const view = open()
    await view
      .findAll('.abele-card')
      .find((c) => c.text().includes('Weather'))!
      .trigger('click')

    const editor = view.find('.abele-ai-secret__editor')
    const copy = editor.findAllComponents(Icon).find((i) => i.props('tooltip') === 'Copy the key')
    await copy!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe('fake-weather-value')
    expect(Notice.shown.at(-1)).toMatch(/cleared from the clipboard in a minute/)
  })
})

describe('the GitHub token', () => {
  it('can be shown and copied where it is entered', async () => {
    AbeleConfig.getInstance().github = {
      ...DEFAULT_GITHUB_SETTINGS,
      enabled: true,
      keyId: GITHUB_TOKEN_KEY_ID,
    }
    app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, 'fake-github-value')
    const view = mount(GithubSettings)
    const field = fieldHolding(view, 'fake-github-value')!
    expect(view.text()).not.toContain('fake-github-value')

    await icon(field, 'Show the key')!.trigger('click')
    expect(field.text()).toContain('fake-github-value')
    await icon(field, 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe('fake-github-value')
    // Forgetting it is still there.
    expect(icon(view, 'Forget the token')).toBeDefined()
  })
})

describe('the Firefly III token', () => {
  it('can be shown and copied, replaced, and forgotten', async () => {
    app.secretStorage.setSecret(FIREFLY_TOKEN_KEY_ID, 'fake-firefly-value')
    const view = mount(FinanceSettings, { global: { stubs: { Search: true } } })
    const field = fieldHolding(view, 'fake-firefly-value')!

    await icon(field, 'Show the key')!.trigger('click')
    expect(field.text()).toContain('fake-firefly-value')
    await icon(field, 'Copy the key')!.trigger('click')
    await flushPromises()
    expect(clip.text).toBe('fake-firefly-value')

    await field.find('input').setValue('fake-firefly-next')
    await icon(view, 'Save the token')!.trigger('click')
    expect(app.secretStorage.getSecret(FIREFLY_TOKEN_KEY_ID)).toBe('fake-firefly-next')

    await icon(view, 'Forget the token')!.trigger('click')
    expect(app.secretStorage.getSecret(FIREFLY_TOKEN_KEY_ID) ?? '').toBe('')
  })
})
