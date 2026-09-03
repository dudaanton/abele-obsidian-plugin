/**
 * A pinned message as a card at the top of the margin.
 *
 * It is a reminder, not a conversation: one message, the speaker, and two ways out — press it
 * to go back to the passage it is about, or take it out of the margin. Everything it shows it
 * reads from the session; there is no copy of `pinned` here and no id of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import CommentPin from '@/components/CommentPin.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import { CommentPin as CommentPinEntity } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { ChatMessage } from '@/ai/types'
import { reliableScrollTo } from '@/helpers/scrollUtils'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/scrollUtils', () => ({ reliableScrollTo: vi.fn() }))

const NOTE = 'Notes/Anchor.md'
const MARKER_FROM = 20

type FakeSession = ReturnType<typeof fakeChatSession>

const open: Ref<string | null> = ref(null)
let sessions: Record<string, FakeSession>

beforeEach(() => {
  useVault([{ path: NOTE, content: 'The selected passage%%c:k7d2ph%% and more.' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  open.value = null
  sessions = {}
  vi.mocked(reliableScrollTo).mockReset()

  vi.spyOn(CommentService, 'getInstance').mockReturnValue({
    open,
    sessionFor: (id: string) => sessions[id] ?? null,
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function message(over: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  return { id: 'm1', content: '', timestamp: 1, ...over } as ChatMessage
}

function seed(messages: ChatMessage[], overrides: Record<string, unknown> = {}) {
  const session = fakeChatSession({ messages: ref(messages), overrides })
  sessions['k7d2ph'] = session
  return session
}

const entity = () =>
  new CommentPinEntity({
    id: 'vue-pin-1',
    commentId: 'k7d2ph',
    messageId: 'm1',
    notePath: NOTE,
    markerFrom: MARKER_FROM,
  })

async function mountPin() {
  const view = mount(CommentPin, { props: { pin: entity() }, attachTo: document.body })
  await nextTick()
  return view
}

const action = (view: Awaited<ReturnType<typeof mountPin>>, icon: string) => {
  const found = view.findAllComponents(Icon).find((i) => i.props('icon') === icon)
  if (!found) throw new Error(`no action carrying the icon "${icon}"`)
  return found
}

describe('a pinned message in the margin', () => {
  it('renders the message through Markdown, against the note it is anchored to', async () => {
    seed([message({ role: 'assistant', content: 'Pins park at the top.' })])

    const view = await mountPin()

    const markdown = view.findComponent(Markdown)
    expect(markdown.props('text')).toBe('Pins park at the top.')
    expect(markdown.props('filePath')).toBe(NOTE)
  })

  it('names the agent for an answer and the reader for a question', async () => {
    seed([message({ role: 'assistant', content: 'An answer.' })])
    expect((await mountPin()).find('.abele-card__name').text()).toBe('Comment')

    seed([message({ role: 'user', content: 'A question.' })])
    expect((await mountPin()).find('.abele-card__name').text()).toBe('You')
  })

  it('takes the message out of the margin through the session that holds it', async () => {
    const unpin = vi.fn()
    seed([message({ role: 'assistant', content: 'An answer.' })], { unpin })

    await action(await mountPin(), 'pin-off').trigger('click')

    expect(unpin).toHaveBeenCalledWith('m1')
  })

  it('goes back to the passage and opens the comment when it is pressed', async () => {
    seed([message({ role: 'assistant', content: 'An answer.' })])

    const view = await mountPin()
    await view.find('.abele-comment-pin').trigger('click')

    expect(open.value).toBe('k7d2ph')
    expect(reliableScrollTo).toHaveBeenCalledWith(MARKER_FROM)
  })

  it('offers no way to unfold a message that already fits', async () => {
    // happy-dom lays nothing out, so every body measures as fitting — which is the case this
    // asserts: a control that would do nothing when pressed is not drawn.
    seed([message({ role: 'assistant', content: 'Short.' })])

    const view = await mountPin()

    expect(view.findAllComponents(Icon).map((i) => i.props('icon'))).toEqual(['pin', 'pin-off'])
  })

  it('renders nothing at all when the message has left the conversation', async () => {
    // A retry or a branch takes a message away; a card for one nobody can render is a hole.
    seed([message({ id: 'm9', role: 'assistant', content: 'Another turn entirely.' })])

    const view = await mountPin()

    expect(view.find('.abele-comment-pin').exists()).toBe(false)
  })

  it('renders nothing while the comment is still being read', async () => {
    const view = await mountPin()

    expect(view.find('.abele-comment-pin').exists()).toBe(false)
  })
})
