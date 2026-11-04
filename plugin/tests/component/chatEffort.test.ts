import { mount } from '@vue/test-utils'
import { computed, nextTick, ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { Menu, Platform } from 'obsidian'
import ChatEffort from '@/components/ChatEffort.vue'
import { addEffortItems } from '@/components/chatEffort'

const state = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/ai/ChatService', () => ({
  ChatService: { getInstance: () => ({ activeSession: { value: state.session } }) },
}))

function session() {
  const own = ref<'low' | 'medium' | 'high'>()
  const model = ref({
    id: 'sample-model',
    name: 'Sample',
    baseUrl: 'https://sample.invalid/v1',
    apiKey: '',
    contextWindow: 10000,
    maxTokens: 100,
    supportsReasoning: true,
    reasoningEffort: 'medium' as const,
  })
  return {
    own,
    model,
    reasoningEffort: computed({
      get: () => own.value ?? model.value.reasoningEffort,
      set: (v) => {
        own.value = v
      },
    }),
    resolveModel: () => model.value,
    isOverridden: () => own.value !== undefined,
    isStreaming: ref(false),
    isExecutingTool: ref(false),
    save: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  Platform.isPhone = false
})

it('shows the inherited level, highlights a chat choice, and hides for unsupported models', async () => {
  const s = session()
  state.session = s
  const wrapper = mount(ChatEffort)
  expect(wrapper.text()).toBe('Medium')
  expect(wrapper.get('button').classes()).not.toContain('abele-chat-effort_own')
  s.reasoningEffort.value = 'high'
  await nextTick()
  expect(wrapper.text()).toBe('High')
  expect(wrapper.get('button').classes()).toContain('abele-chat-effort_own')
  s.model.value.supportsReasoning = false
  await nextTick()
  expect(wrapper.find('button').exists()).toBe(false)
  expect(s.own.value).toBe('high')
  wrapper.unmount()
})

it('offers checked choices and a persisted return to following the model', () => {
  const s = session()
  const menu = new Menu()
  addEffortItems(menu, s, true)
  const items = (
    menu as unknown as { items: { title: string; checked: boolean; handler: () => void }[] }
  ).items
  expect(items.find((i) => i.title.startsWith('As Sample'))?.checked).toBe(true)
  items.find((i) => i.title === 'High')!.handler()
  expect(s.reasoningEffort.value).toBe('high')
  expect(s.save).toHaveBeenCalledOnce()
  items.find((i) => i.title.startsWith('As Sample'))!.handler()
  expect(s.reasoningEffort.value).toBe('medium')
  expect(s.own.value).toBeUndefined()
})

it('leaves phone effort selection to the agent menu', () => {
  Platform.isPhone = true
  state.session = session()
  const wrapper = mount(ChatEffort)
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
  Platform.isPhone = false
})
