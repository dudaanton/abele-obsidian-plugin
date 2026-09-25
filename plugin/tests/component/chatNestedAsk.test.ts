/**
 * "Ask here" in a comment's own tab, and the trail back up from it.
 *
 * A comment used to be the one place in the sidebar where a selection in a message offered
 * nothing: its tab was the one tab a new comment replaces, so asking there was switched off.
 * Now a comment is asked about like any chat, and what makes that bearable is the trail over
 * the messages — the chat or note it all started from, every comment in between, this one last —
 * each level a way back to the place the next one hangs on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { ChatService } from '@/ai/ChatService'
import { CommentService, type TrailStep } from '@/ai/CommentService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type CommentAnchor } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

const revealAnchor = vi.fn(async (_id: string, _anchor: CommentAnchor) => true)
vi.mock('@/ai/openChat', async (original) => ({
  ...(await original<typeof import('@/ai/openChat')>()),
  revealAnchor: (id: string, anchor: CommentAnchor) => revealAnchor(id, anchor),
}))

const messages = ref<ChatMessage[]>([
  { id: 'q', role: 'user', content: 'Does it have sleeping cars?', timestamp: 1 },
  { id: 'a', role: 'assistant', content: 'Yes, two classes of couchette.', timestamp: 2 },
])

const SECOND: CommentAnchor = { note: 'AI/Comments/first1.abchat', quote: 'Baltic', message: 'c1a' }
const FIRST: CommentAnchor = { note: 'AI/Chats/Riga.abchat', quote: 'night train', message: 'a1' }

const TRAIL: TrailStep[] = [
  { kind: 'chat', path: 'AI/Chats/Riga.abchat', title: 'Riga trip' },
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

afterEach(() => vi.restoreAllMocks())

describe('a comment in its tab', () => {
  it('offers "Ask here" on its messages, the person’s and the agent’s', () => {
    const wrapper = mountWith('comment', SECOND)

    const rows = wrapper.findAllComponents(AiChatMessage)
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.props('canComment')).toBe(true)
  })

  it('draws the trail from the chat it started in down to itself', async () => {
    const wrapper = mountWith('comment', SECOND)
    await flushPromises()

    const crumbs = wrapper.findAll('.abele-breadcrumbs__item')
    expect(crumbs.map((c) => c.text())).toEqual(['Riga trip', 'Which train?', 'Sleeping cars?'])
    expect(crumbs[2].classes()).toContain('abele-breadcrumbs__item_current')
  })

  it('goes back to a level by opening it at the place the next one hangs on', async () => {
    const wrapper = mountWith('comment', SECOND)
    await flushPromises()

    await wrapper.findAll('.abele-breadcrumbs__item')[0].trigger('click')
    expect(revealAnchor).toHaveBeenLastCalledWith('first1', FIRST)

    await wrapper.findAll('.abele-breadcrumbs__item')[1].trigger('click')
    expect(revealAnchor).toHaveBeenLastCalledWith('second', SECOND)
  })

  it('does nothing when the level in front is pressed', async () => {
    const wrapper = mountWith('comment', SECOND)
    await flushPromises()

    await wrapper.findAll('.abele-breadcrumbs__item')[2].trigger('click')
    expect(revealAnchor).not.toHaveBeenCalled()
  })

  it('draws no trail for a comment on a note, which has the way back already', async () => {
    const wrapper = mountWith('comment', { note: 'Notes/A.md', quote: 'x' })
    await flushPromises()

    expect(wrapper.find('.abele-breadcrumbs').exists()).toBe(false)
  })
})

describe('an ordinary chat', () => {
  it('has no trail', async () => {
    const wrapper = mountWith('chat', null)
    await flushPromises()

    expect(wrapper.find('.abele-breadcrumbs').exists()).toBe(false)
  })
})
