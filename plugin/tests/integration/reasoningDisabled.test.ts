import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ModelEditModal from '@/components/settings/ModelEditModal.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Button from '@/components/obsidian/Button.vue'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig, type AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiModelConfig } from '@/ai/types'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { useVault } from '../helpers/testEnv'

const model: AiModelConfig = {
  id: 'sample-model',
  name: 'Sample model',
  contextWindow: 1000,
  maxTokens: 100,
  supportsReasoning: false,
}
const provider = {
  id: 'sample-provider',
  name: 'Sample provider',
  baseUrl: 'https://example.invalid/v1',
  apiKeyId: '',
  models: [model],
}
const stubs = { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } }

afterEach(() => {
  vi.restoreAllMocks()
  ChatService.getInstance().destroy()
  AgentRegistry.destroy()
  AbeleConfig.getInstance().destroy()
})

describe('explicit reasoning off', () => {
  it.each([
    { supportsReasoning: false },
    { supportsReasoning: true },
    { supportsReasoning: false, reasoningEffort: 'high' as const },
    { supportsReasoning: false, reasoningDisabled: true, expected: 'none' },
    {
      supportsReasoning: false,
      reasoningDisabled: true,
      reasoningEffort: 'high' as const,
      expected: 'none',
    },
    ...(['low', 'medium', 'high'] as const).map((effort) => ({
      supportsReasoning: true,
      reasoningEffort: effort,
      expected: effort,
    })),
  ])('sends only the selected reasoning choice: %j', async (choice) => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"Sample"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        )
      )
    for await (const event of new OpenAIClient().stream(
      { ...model, ...choice, baseUrl: provider.baseUrl, apiKey: '' },
      '',
      [],
      [
        {
          name: 'sample_tool',
          description: 'Sample tool',
          parameters: { type: 'object', properties: {} },
        },
      ],
      { reasoningEffort: 'reasoningEffort' in choice ? choice.reasoningEffort : undefined }
    ))
      expect(event).toBeDefined()
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.tools).toHaveLength(1)
    if ('expected' in choice) expect(body.reasoning_effort).toBe(choice.expected)
    else expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('round-trips the toggle choice through saved settings and transfer to every model resolver', async () => {
    useVault([])
    const view = mount(ModelEditModal, {
      props: { model: { ...model, supportsReasoning: true, reasoningEffort: 'high' } },
      global: { stubs },
    })
    const save = async (editor: typeof view) => {
      await editor
        .findAllComponents(Button)
        .find((b) => b.props('text') === 'Save')!
        .vm.$emit('click')
      return editor.emitted('save')!.at(-1)![0] as AiModelConfig
    }
    try {
      await view.findComponent(Checkbox).vm.$emit('toggle')
      const saved = await save(view)
      expect(saved).toMatchObject({ supportsReasoning: false, reasoningDisabled: true })
      const source = {
        ai: {
          ...DEFAULT_AI_SETTINGS,
          providers: [{ ...provider, models: [saved] }],
          activeProviderId: provider.id,
          activeModelId: model.id,
          auxiliaryModelId: `${provider.id}::${model.id}`,
        },
      } as AbeleSettings
      const received = applyEntries(JSON.parse(JSON.stringify(collectEntries(source))), {
        ...source,
        ai: { ...source.ai, providers: [] },
      })
      AbeleConfig.getInstance().applySettings(JSON.parse(JSON.stringify(received)))
      const service = ChatService.getInstance()
      const registry = AgentRegistry.getInstance()
      const agent = registry.create({
        name: 'Sample agent',
        providerId: provider.id,
        modelId: model.id,
        fallbackProviderId: provider.id,
        fallbackModelId: model.id,
        auxiliaryProviderId: provider.id,
        auxiliaryModelId: model.id,
      })
      for (const config of [
        service.getActiveModelConfig(),
        service.getModelConfigFor(provider.id, model.id),
        service.getAuxiliaryModelConfig(),
        registry.resolveModel(agent),
        registry.resolveModel(agent, { fallback: true }),
        registry.resolveModel(agent, { background: true }),
      ])
        expect(config).toHaveProperty('reasoningDisabled', true)
      const reopened = mount(ModelEditModal, {
        props: { model: received.ai.providers[0].models[0] },
        global: { stubs },
      })
      try {
        expect(await save(reopened)).toHaveProperty('reasoningDisabled', true)
        await reopened.findComponent(Checkbox).vm.$emit('toggle')
        expect(await save(reopened)).toMatchObject({
          supportsReasoning: true,
          reasoningEffort: 'high',
        })
        expect(await save(reopened)).not.toHaveProperty('reasoningDisabled', true)
      } finally {
        reopened.unmount()
      }
    } finally {
      view.unmount()
    }
  })

  it('does not mark an untouched legacy model off on save', async () => {
    const view = mount(ModelEditModal, { props: { model }, global: { stubs } })
    try {
      await view
        .findAllComponents(Button)
        .find((b) => b.props('text') === 'Save')!
        .vm.$emit('click')
      expect(view.emitted('save')![0][0]).not.toHaveProperty('reasoningDisabled')
    } finally {
      view.unmount()
    }
  })
})
