/**
 * Nested chats keep Ask here and offer one step back to the immediate parent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { Platform } from 'obsidian'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import AiChat from '@/components/AiChat.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { ChatService } from '@/ai/ChatService'
import { CommentService, type TrailStep } from '@/ai/CommentService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type CommentAnchor } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

const revealAnchor = vi.fn(async (_id: string, _anchor: CommentAnchor, _sidebar?: boolean) => true)
vi.mock('@/ai/openChat', async (original) => ({
  ...(await original<typeof import('@/ai/openChat')>()),
  revealAnchor: (id: string, anchor: CommentAnchor, sidebar?: boolean) =>
    revealAnchor(id, anchor, sidebar),
}))

const messages = ref<ChatMessage[]>([
  { id: 'q', role: 'user', content: 'Does it have sleeping cars?', timestamp: 1 },
  { id: 'a', role: 'assistant', content: 'Yes, two classes of couchette.', timestamp: 2 },
])

const SECOND: CommentAnchor = {
  note: 'AI/Comments/first1.abchat',
  quote: 'sample route',
  message: 'c1a',
}
const FIRST: CommentAnchor = { note: 'AI/Chats/Sample.abchat', quote: 'night train', message: 'a1' }

const TRAIL: TrailStep[] = [
  { kind: 'chat', path: 'AI/Chats/Sample.abchat', title: 'Sample trip' },
  {
    kind: 'comment',
    path: 'AI/Comments/first1.abchat',
    id: 'first1',
    anchor: FIRST,
    title: 'Which train?',
  },
  {
    kind: 'comment',
    path: 'AI/Comments/second.abchat',
    id: 'second',
    anchor: SECOND,
    title: 'Sleeping cars?',
  },
]

function mountWith(kind: 'chat' | 'comment', anchor: CommentAnchor | null) {
  const service = ChatService.getInstance()
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({
      messages,
      kind,
      overrides: {
        currentChatFile: ref({ path: 'AI/Comments/second.abchat', basename: 'second' }),
        anchor: ref(anchor),
        commentId: 'second',
      },
    }),
  } as never)
  return mount(AiChat)
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  vi.spyOn(ChatService.getInstance(), 'ensureInitialized').mockImplementation(() => {})
  const comments = CommentService.getInstance()
  vi.spyOn(comments, 'trail').mockResolvedValue(TRAIL)
  vi.spyOn(comments, 'touch').mockImplementation(() => {})
  revealAnchor.mockClear()
})

afterEach(() => {
  Platform.isPhone = false
  vi.restoreAllMocks()
})

describe('a comment in its tab', () => {
  it('offers "Ask here" on its messages, the person’s and the agent’s', () => {
    const wrapper = mountWith('comment', SECOND)

    const rows = wrapper.findAllComponents(AiChatMessage)
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.props('canComment')).toBe(true)
  })

  it('replaces the trail with a reader-style Back button beside the chooser', async () => {
    const wrapper = mountWith('comment', SECOND)
    await flushPromises()

    expect(wrapper.find('.abele-breadcrumbs').exists()).toBe(false)
    const back = wrapper.find('.abele-chat-parent-back')
    expect(back.classes()).toContain('clickable-icon')
    expect(back.attributes('aria-label')).toBe('Back to Which train?')
    expect(back.element.nextElementSibling?.classList.contains('abele-chat-switch')).toBe(true)
  })

  it('opens only the immediate parent at the anchored message', async () => {
    const wrapper = mountWith('comment', SECOND)
    await flushPromises()

    await wrapper.find('.abele-chat-parent-back').trigger('click')
    expect(revealAnchor).toHaveBeenCalledExactlyOnceWith('second', SECOND, false)
  })

  it('names the root parent when it is the immediate parent', async () => {
    vi.mocked(CommentService.getInstance().trail).mockResolvedValue([TRAIL[0], TRAIL[2]])
    const wrapper = mountWith('comment', SECOND)
    await flushPromises()

    expect(wrapper.find('.abele-chat-parent-back').attributes('aria-label')).toContain(
      TRAIL[0].title
    )
  })

  it('offers Back for a nested ordinary chat too', async () => {
    const wrapper = mountWith('chat', SECOND)
    await flushPromises()
    await wrapper.find('.abele-chat-parent-back').trigger('click')
    expect(revealAnchor).toHaveBeenCalledExactlyOnceWith('second', SECOND, false)
  })

  it('draws no trail for a comment on a note, which has the way back already', async () => {
    const wrapper = mountWith('comment', { note: 'Notes/A.md', quote: 'x' })
    await flushPromises()

    expect(wrapper.find('.abele-breadcrumbs').exists()).toBe(false)
    expect(wrapper.find('.abele-chat-parent-back').exists()).toBe(false)
  })
})

describe('an ordinary chat', () => {
  it('keeps the drawer switch in the phone header beside the chat tree', () => {
    Platform.isPhone = true
    const wrapper = mountWith('chat', null)
    // Without it a phone's drawer shows Obsidian's own switcher and note line under the chat.
    expect(wrapper.findComponent(DrawerViewSwitch).exists()).toBe(true)
  })

  it('has no trail', async () => {
    const wrapper = mountWith('chat', null)
    await flushPromises()

    expect(wrapper.find('.abele-breadcrumbs').exists()).toBe(false)
    expect(wrapper.find('.abele-chat-parent-back').exists()).toBe(false)
  })
})
