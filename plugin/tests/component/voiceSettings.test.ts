/**
 * Where voice input is set up.
 *
 * The two models are on the list because of where they run and what they cost, and that is
 * the sort of thing a person needs told rather than looked up — so the note travels with the
 * choice. The key is deliberately the one OpenRouter key, shared with image generation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import GeneralSettings from '@/components/settings/ai/GeneralSettings.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { TRANSCRIPTION_MODELS, DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { voiceSettings } from '@/ai/transcriptionSettings'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

const STUBS = { Search: true, Dropdown: true, Input: true, Checkbox: true }

const open = () => mount(GeneralSettings, { global: { stubs: STUBS } })

/** The dropdown whose options are the transcription models. */
const modelPicker = (wrapper: ReturnType<typeof open>) =>
  wrapper
    .findAllComponents(Dropdown)
    .find((d) =>
      (d.props('options') as { value: string }[]).some(
        (o) => o.value === TRANSCRIPTION_MODELS[0].id
      )
    )

beforeEach(() => {
  app = useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true } as AiSettings
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

describe('the voice section', () => {
  it('is there once the agent is switched on', () => {
    expect(open().text()).toContain('Voice input')
  })

  it('offers both models, and a way in for one of your own', () => {
    const values = (modelPicker(open())?.props('options') as { value: string }[]).map(
      (o) => o.value
    )

    expect(values).toEqual([...TRANSCRIPTION_MODELS.map((m) => m.id), 'custom'])
  })

  it('says why each one is on the list rather than leaving the name to speak for itself', () => {
    expect(open().text()).toContain('European endpoint')
  })

  it('starts on the cheap one, which is the one that was chosen', () => {
    expect(modelPicker(open())?.props('modelValue')).toBe(DEFAULT_TRANSCRIPTION.modelId)
  })

  it('remembers the model that was picked', async () => {
    const wrapper = open()

    await modelPicker(wrapper)?.vm.$emit('update:model-value', TRANSCRIPTION_MODELS[1].id)

    expect(AbeleConfig.getInstance().ai.voice?.modelId).toBe(TRANSCRIPTION_MODELS[1].id)
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
  })

  it('asks for a model id of your own only when that is what was chosen', async () => {
    const wrapper = open()
    expect(wrapper.text()).not.toContain('Model id')

    await modelPicker(wrapper)?.vm.$emit('update:model-value', 'custom')

    expect(wrapper.text()).toContain('Model id')
  })

  it('shows a model of your own as one of your own, not as an unknown', async () => {
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      voice: { modelId: 'someone/else', endpoint: '', apiKeyId: '', language: '' },
    } as AiSettings

    expect(modelPicker(open())?.props('modelValue')).toBe('custom')
  })
})

describe('the key', () => {
  it('is the one OpenRouter key, so it is not asked for twice', () => {
    expect(voiceSettings().apiKeyId).toBe('')
    expect(DEFAULT_TRANSCRIPTION.apiKeyId).toBe('abele-openrouter')
  })

  it('goes into the keychain when it is entered', async () => {
    const wrapper = open()
    const field = wrapper.findAll('input[type="password"]').at(-1)

    await field?.setValue('sk-or-secret')
    await wrapper
      .findAll('.abele-obsidian-icon')
      .find((i) => i.attributes('aria-label') === 'Save key' && i.isVisible())
      ?.trigger('click')

    expect(app.secretStorage.getSecret('abele-openrouter')).toBe('sk-or-secret')
  })
})
