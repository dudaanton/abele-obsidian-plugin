import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import AiAgentSelector from '@/components/AiAgentSelector.vue'
import { Menu } from 'obsidian'

const f = vi.hoisted(() => ({
  provider: 'sample-provider',
  model: 'sample-model',
  duplicate: false,
  save: vi.fn(),
}))
vi.mock('@/ai/ChatService', () => ({
  ChatService: {
    getInstance: () => ({
      activeSession: {
        value: {
          place: { value: null },
          messages: { value: [{}] },
          agent: {
            value: {
              id: 'sample-agent',
              name: 'Sample agent',
              providerId: 'sample-provider',
              modelId: 'sample-model',
            },
          },
          activeProviderId: { value: f.provider },
          activeModelId: {
            get value() {
              return f.model
            },
            set value(value) {
              f.model = value
            },
          },
          save: f.save,
          resolveModel: () => ({ id: 'sample-model', name: 'Sample model' }),
          isOverridden: () => true,
        },
      },
    }),
  },
}))
vi.mock('@/ai/agents/AgentRegistry', () => ({
  AgentRegistry: {
    getInstance: () => ({ list: () => [{ id: 'sample-agent', name: 'Sample agent' }] }),
  },
}))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: {
    getInstance: () => ({
      ai: {
        providers: [
          {
            id: 'sample-provider',
            models: f.duplicate
              ? [
                  { id: 'sample-model', entryId: 'sample-medium', name: 'Balanced' },
                  { id: 'sample-model', entryId: 'sample-high', name: 'Thorough' },
                ]
              : [{ id: 'sample-model', name: 'Sample model' }],
          },
        ],
      },
    }),
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ nodes: { value: [] } }) },
}))

it.each(['sample-provider', 'other-provider'])(
  'compares actual provider and model identities rather than the presence of an override (%s)',
  (provider) => {
    f.provider = provider
    const wrapper = mount(AiAgentSelector)
    try {
      expect(wrapper.find('.abele-agent-selector__model').exists()).toBe(
        provider !== 'sample-provider'
      )
    } finally {
      wrapper.unmount()
    }
  }
)

it('selects and checks only the second entry when API ids are identical', async () => {
  f.duplicate = true
  f.provider = 'sample-provider'
  f.model = 'sample-medium'
  const show = vi.spyOn(Menu.prototype, 'showAtPosition')
  const wrapper = mount(AiAgentSelector)
  try {
    await wrapper.find('.abele-agent-selector__model').trigger('click')
    const menu = show.mock.instances.at(-1) as Menu
    const choices = menu.items.filter((item) => item.section === 'models')
    expect(choices.map((item) => item.checked)).toEqual([true, false])
    choices[1].handler!()
    expect(f.model).toBe('sample-high')
    expect(f.save).toHaveBeenCalled()
    await wrapper.find('.abele-agent-selector__model').trigger('click')
    const reopened = show.mock.instances.at(-1) as Menu
    expect(
      reopened.items.filter((item) => item.section === 'models').map((item) => item.checked)
    ).toEqual([false, true])
  } finally {
    wrapper.unmount()
    show.mockRestore()
    f.duplicate = false
    f.model = 'sample-model'
  }
})
