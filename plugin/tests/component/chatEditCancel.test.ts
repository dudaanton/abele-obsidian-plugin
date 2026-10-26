/**
 * Editing a sent message puts its text back in the field and stands the chat before it; sending
 * then starts a new branch. A line above the field says so, and its × takes the edit back: the
 * field empty again and the chat on the branch the message was on.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref, shallowRef } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

const messages: ChatMessage[] = [
  { id: 'q1', role: 'user', content: 'Plan a sample garden', timestamp: 1000 },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Put a pond near the shed.',
    timestamp: 2000,
    parentId: 'q1',
  },
  { id: 'q2', role: 'user', content: 'Add some shade', timestamp: 3000, parentId: 'a1' },
]

let wrapper: VueWrapper | undefined
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('says an edit starts a new branch, and cancelling it empties the field and goes back', async () => {
  const createBranch = vi.fn()
  const switchBranch = vi.fn()
  const session = fakeChatSession({
    messages: ref([...messages]),
    kind: 'chat',
    overrides: { createBranch, switchBranch },
  })
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  wrapper = mount(AiChat, { attachTo: document.body })
  await flushPromises()
  const field = () => wrapper!.get('textarea').element as HTMLTextAreaElement
  const note = () => wrapper!.find('.abele-ai-chat__branch-note')
  expect(note().exists()).toBe(false)

  wrapper
    .findAllComponents(AiChatMessage)
    .find((m) => m.props('message').id === 'q2')!
    .vm.$emit('edit-message', 'q2')
  await flushPromises()
  expect(createBranch).toHaveBeenCalledWith('a1')
  expect(field().value).toBe('Add some shade')
  expect(note().text()).toBe('Editing your message: sending starts a new branch')

  await note().get('button[aria-label="Cancel editing"]').trigger('click')
  await flushPromises()
  expect(field().value).toBe('')
  expect(switchBranch).toHaveBeenCalledExactlyOnceWith('q2')
  expect(note().exists()).toBe(false)
})

it('cancels back to the exact selected continuation and restores the previous unsent draft', async () => {
  const switchBranch = vi.fn()
  const session = fakeChatSession({
    kind: 'chat',
    messages: ref([...messages]),
    overrides: { branchLeafId: 'sample-selected-leaf', switchBranch },
  })
  session.draft.value.text = 'Sample unsent follow-up'
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(chats, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  wrapper = mount(AiChat, { attachTo: document.body })
  await flushPromises()
  wrapper
    .findAllComponents(AiChatMessage)
    .find((m) => m.props('message').id === 'q2')!
    .vm.$emit('edit-message', 'q2')
  await flushPromises()
  await wrapper.get('[aria-label="Cancel editing"]').trigger('click')
  await flushPromises()
  expect(switchBranch).toHaveBeenCalledExactlyOnceWith('sample-selected-leaf')
  expect(session.draft.value.text).toBe('Sample unsent follow-up')
})

it('starts an edit of the first question before the root message', async () => {
  const visible = ref([...messages])
  const createBranch = vi.fn(() => {
    visible.value = []
  })
  const session = fakeChatSession({
    kind: 'chat',
    messages: visible,
    overrides: { createBranch, allMessages: ref([...messages]), branchLeafId: null },
  })
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(chats, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  wrapper = mount(AiChat, { attachTo: document.body })
  await flushPromises()
  wrapper
    .findAllComponents(AiChatMessage)
    .find((m) => m.props('message').id === 'q1')!
    .vm.$emit('edit-message', 'q1')
  await flushPromises()
  expect(createBranch).toHaveBeenCalledExactlyOnceWith(null)
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(messages[0].content)
  expect(wrapper.get('[aria-label="Cancel editing"]').exists()).toBe(true)
  Object.assign(session, { branchLeafId: 'sample-revised-root' })
  visible.value = [
    { id: 'sample-revised-root', role: 'user', content: 'Revised garden', timestamp: 4000 },
  ]
  await flushPromises()
  expect(wrapper.find('[aria-label="Cancel editing"]').exists()).toBe(false)
})

it('drops the editing affordance when the conversation changes', async () => {
  const active = shallowRef(fakeChatSession({ kind: 'chat', messages: ref([...messages]) }))
  const chats = ChatService.getInstance()
  vi.spyOn(chats, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(chats, 'activeSession', 'get').mockReturnValue(computed(() => active.value) as never)
  wrapper = mount(AiChat, { attachTo: document.body })
  await flushPromises()
  wrapper
    .findAllComponents(AiChatMessage)
    .find((m) => m.props('message').id === 'q2')!
    .vm.$emit('edit-message', 'q2')
  await flushPromises()
  active.value = fakeChatSession({
    kind: 'chat',
    messages: ref([...messages]),
    overrides: { id: 'second-sample-chat' },
  })
  await flushPromises()
  expect(wrapper.find('[aria-label="Cancel editing"]').exists()).toBe(false)
})
