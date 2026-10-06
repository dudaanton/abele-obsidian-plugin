import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import AiChatInput from '@/components/AiChatInput.vue'
import AiChat from '@/components/AiChat.vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'
import type { QueuedMessage } from '@/ai/types'

let wrapper: ReturnType<typeof mount>
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

const openInput = () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  wrapper = mount(AiChatInput, {
    props: {
      isStreaming: true,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
    },
    global: { stubs: { VoiceRecorder: true } },
  })
  return wrapper
}

it('offers attachment and dictation controls while a message will be deferred', async () => {
  const input = openInput()
  expect(input.find('[data-icon="paperclip"]').exists()).toBe(true)
  await input.get('[data-icon="mic"]').trigger('click')
  expect(input.findComponent(VoiceRecorder).exists()).toBe(true)
  input.findComponent(VoiceRecorder).vm.$emit('send', 'Sample dictated words')
  await flushPromises()
  expect(input.emitted('send')).toEqual([['Sample dictated words', []]])
})

it('sends attachments together with dictated words while streaming', async () => {
  const input = openInput()
  const app = useVault([{ path: 'sample-note.md', content: 'Sample note body' }])
  input.vm.addAttachment(app.vault.getAbstractFileByPath('sample-note.md'))
  await input.get('[data-icon="mic"]').trigger('click')
  input.findComponent(VoiceRecorder).vm.$emit('send', 'Describe this note')
  await flushPromises()
  expect(input.emitted('send')).toEqual([['Describe this note', ['sample-note.md']]])
})

describe('queued media in the chat', () => {
  const openChat = () => {
    useVault([{ path: 'sample-note.md', content: 'Sample body' }])
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    const queued = ref<QueuedMessage[]>([
      { id: 'sample-queued', content: '', attachments: ['sample-note.md'] },
    ])
    const service = ChatService.getInstance()
    service.tabOrder.value = ['tab-a']
    service.activeTabId.value = 'tab-a'
    vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
      value: fakeChatSession({ queuedMessages: queued, overrides: { isStreaming: ref(true) } }),
    } as never)
    wrapper = mount(AiChat, { attachTo: document.body })
    return queued
  }

  it('names an attachment-only message in the queue', () => {
    openChat()
    expect(wrapper.get('.abele-ai-chat__queued-item').text()).toContain('sample-note.md')
  })

  it('returns the attachment to the composer for editing, without leaving a queued copy', async () => {
    const queued = openChat()
    await wrapper.get('.abele-ai-chat__queued-edit').trigger('click')
    expect(queued.value).toEqual([])
    expect(
      wrapper
        .findComponent(AiChatInput)
        .vm.takeDraft()
        .attachments.map((f: { path: string }) => f.path)
    ).toEqual(['sample-note.md'])
  })

  it('cancels an attachment-only message without deleting the vault file', async () => {
    const queued = openChat()
    await wrapper.get('.abele-ai-chat__queued-remove').trigger('click')
    expect(queued.value).toEqual([])
    expect(wrapper.findComponent(AiChatInput).vm.takeDraft().attachments).toEqual([])
  })
})
