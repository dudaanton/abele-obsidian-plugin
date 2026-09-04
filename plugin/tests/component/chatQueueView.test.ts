/**
 * What the chat shows for a message that is waiting.
 *
 * A queued message is not in the conversation — the agent has not been shown it — so it is
 * drawn apart from the transcript, with a way out of the queue. The other half is stopping:
 * that cancels what was lined up behind the answer, and the text goes back to the box it was
 * typed in rather than disappearing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type QueuedMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

const messages = ref<ChatMessage[]>([])
const queued = ref<QueuedMessage[]>([])
const streaming = ref(false)
let aborted = false

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = []
  queued.value = []
  streaming.value = false
  aborted = false

  const service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a']
  service.activeTabId.value = 'tab-a'
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({
      messages,
      queuedMessages: queued,
      kind: 'chat',
      overrides: {
        isStreaming: streaming,
        abort: () => {
          aborted = true
          queued.value = []
        },
      },
    }),
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const open = () => mount(AiChat, { attachTo: document.body })

const queuedTexts = (wrapper: ReturnType<typeof open>) =>
  wrapper.findAll('.abele-ai-chat__queued-text').map((el) => el.text())

const textarea = (wrapper: ReturnType<typeof open>) =>
  wrapper.get('.abele-chat-input__textarea').element as HTMLTextAreaElement

describe('a message waiting its turn', () => {
  it('is shown, so nobody is left wondering where it went', () => {
    queued.value = [{ id: 'q1', content: 'and also check the dates' }]

    expect(queuedTexts(open())).toEqual(['and also check the dates'])
  })

  it('is shown apart from the conversation, not as a message already sent', () => {
    messages.value = [
      { id: 'm1', role: 'user', content: 'summarise', timestamp: 1 },
    ] as ChatMessage[]
    queued.value = [{ id: 'q1', content: 'and also check the dates' }]

    const wrapper = open()

    expect(wrapper.findAll('.abele-ai-chat__queued-item')).toHaveLength(1)
    expect(wrapper.find('.abele-ai-chat__queued-item').text()).not.toContain('summarise')
  })

  it('can be taken back out of the queue', async () => {
    queued.value = [
      { id: 'q1', content: 'keep this' },
      { id: 'q2', content: 'drop this' },
    ]
    const wrapper = open()

    await wrapper.findAll('.abele-ai-chat__queued-remove')[1].trigger('click')

    expect(queuedTexts(wrapper)).toEqual(['keep this'])
  })

  it('leaves nothing behind when there is nothing queued', () => {
    expect(open().find('.abele-ai-chat__queued').exists()).toBe(false)
  })
})

describe('stopping the agent', () => {
  it('gives what was queued back to the input rather than dropping it', async () => {
    streaming.value = true
    queued.value = [
      { id: 'q1', content: 'and also check the dates' },
      { id: 'q2', content: 'and the totals' },
    ]
    const wrapper = open()

    await wrapper.get('.abele-chat-input__stop').trigger('click')
    await nextTick()

    expect(aborted).toBe(true)
    expect(textarea(wrapper).value).toBe('and also check the dates\nand the totals')
  })

  it('keeps what was already typed, putting the queue in front of it', async () => {
    streaming.value = true
    queued.value = [{ id: 'q1', content: 'queued first' }]
    const wrapper = open()
    await wrapper.get('.abele-chat-input__textarea').setValue('typed since')

    await wrapper.get('.abele-chat-input__stop').trigger('click')
    await nextTick()

    expect(textarea(wrapper).value).toBe('queued first\ntyped since')
  })
})
