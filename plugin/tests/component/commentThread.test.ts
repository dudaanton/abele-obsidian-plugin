/**
 * The conversation as it reads in a margin 180–300 px wide.
 *
 * Everything the sidebar spends room on is gone: no avatars, no timestamps, no per-message
 * actions. What is left has to carry the whole meaning — which side a message sits on, one
 * line for a tool call, and a notice small enough not to look like the answer. These assert
 * the markup those rules are written against, and the wiring behind the four things a person
 * can press here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import CommentThread from '@/components/CommentThread.vue'
import Button from '@/components/obsidian/Button.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import type { ChatMessage } from '@/ai/types'
import type { ChatSession } from '@/ai/ChatSession'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([{ path: 'Notes/Anchor.md', content: 'The selected passage.' }])
})

function message(over: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  return { id: 'm1', content: '', timestamp: 1, ...over } as ChatMessage
}

function render(overrides: Record<string, unknown> = {}, messages: ChatMessage[] = []) {
  const session = fakeChatSession({ messages: ref(messages), overrides })
  const view = mount(CommentThread, {
    props: { session: session as unknown as ChatSession },
  })
  return { view, session }
}

describe('who said what', () => {
  it('puts the reader on one side and the agent on the other', () => {
    const { view } = render({}, [
      message({ id: 'u1', role: 'user', content: 'What does this mean?' }),
      message({ id: 'a1', role: 'assistant', content: 'It means this.' }),
    ])

    const rows = view.findAll('.abele-comment-thread__msg')
    expect(rows[0].classes()).toContain('abele-comment-thread__msg_user')
    expect(rows[1].classes()).toContain('abele-comment-thread__msg_assistant')
  })

  it('renders prose as markdown rather than as text', () => {
    const { view } = render({}, [message({ role: 'assistant', content: '**bold**' })])

    expect(view.findComponent(Markdown).props('text')).toBe('**bold**')
  })

  it('folds thinking away', () => {
    const { view } = render({}, [
      message({ role: 'assistant', content: 'Answer', thinking: 'Working it out' }),
    ])

    const details = view.find('.abele-comment-thread__thinking')
    expect(details.element.tagName).toBe('DETAILS')
    expect(details.attributes('open')).toBeUndefined()
  })

  it('says nothing at all before the first question', () => {
    const { view } = render()

    expect(view.find('.abele-empty-state').exists()).toBe(true)
  })
})

describe('a reply arriving', () => {
  it('shows the text as it streams', () => {
    const { view } = render({ isStreaming: ref(true), streamingContent: ref('It me') })

    expect(view.findComponent(Markdown).props('text')).toBe('It me')
  })

  it('says it is working while nothing has arrived yet', () => {
    const { view } = render({ isStreaming: ref(true) })

    expect(view.find('.abele-comment-thread__waiting').exists()).toBe(true)
  })
})

describe('a tool call', () => {
  const call = message({
    id: 't1',
    role: 'tool-call',
    toolCallId: 'call-1',
    toolName: 'read',
    toolParams: { path: 'Notes/Anchor.md' },
    toolStatus: 'pending',
  })

  it('is one line: what it is and what it is about', () => {
    const { view } = render({}, [call])

    const line = view.find('.abele-comment-thread__tool')
    expect(line.text()).toContain('read')
    expect(line.text()).toContain('Notes/Anchor.md')
  })

  it('offers approve and deny while it is standing', async () => {
    const approveToolCall = vi.fn()
    const rejectToolCall = vi.fn()
    const { view } = render(
      {
        approveToolCall,
        rejectToolCall,
        pendingToolCalls: ref([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }]),
      },
      [call]
    )

    const buttons = view.findAllComponents(Button)
    expect(buttons.map((b) => b.props('text'))).toEqual(['Approve', 'Deny'])

    await buttons[0].vm.$emit('click')
    expect(approveToolCall).toHaveBeenCalled()

    await buttons[1].vm.$emit('click')
    expect(rejectToolCall).toHaveBeenCalled()
  })

  it('asks nothing once the call has been answered', () => {
    const { view } = render({}, [message({ ...call, toolStatus: 'approved' })])

    expect(view.findAllComponents(Button)).toHaveLength(0)
  })
})

describe('a question from the agent', () => {
  it('renders each option as something to press', async () => {
    const answerCurrentQuestion = vi.fn()
    const { view } = render({
      answerCurrentQuestion,
      pendingQuestions: ref({
        questions: [{ question: 'Which section?', options: ['The first', 'The second'] }],
        currentIndex: 0,
        answers: [],
        resolve: () => {},
      }),
    })

    expect(view.find('.abele-comment-thread__question-text').text()).toBe('Which section?')

    const options = view.findAllComponents(Button)
    expect(options.map((b) => b.props('text'))).toEqual(['The first', 'The second'])

    await options[1].vm.$emit('click')
    expect(answerCurrentQuestion).toHaveBeenCalledWith('The second')
  })
})

describe('a turn that failed', () => {
  it('says so in one line and offers another go', async () => {
    const retryRequest = vi.fn()
    const { view } = render({ error: ref('Rate limited'), retryRequest })

    expect(view.find('.abele-comment-thread__error').text()).toContain('Rate limited')

    const retry = view.findAllComponents(Button).find((b) => b.props('text') === 'Retry')
    await retry!.vm.$emit('click')

    expect(retryRequest).toHaveBeenCalled()
  })
})

/**
 * The thread is a scroller with a ceiling, so a reply arriving lands below the fold unless the
 * card follows it. happy-dom lays nothing out, so the two measurements the rule turns on are
 * stubbed and the assertion is on `scrollTop` — the arithmetic, not the appearance.
 */
describe('following a reply that is still arriving', () => {
  function sized(el: HTMLElement, scrollHeight: number, clientHeight = 100) {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  }

  function growing() {
    const messages = ref<ChatMessage[]>([message({ id: 'u1', role: 'user', content: 'Why?' })])
    const session = fakeChatSession({ messages })
    const view = mount(CommentThread, {
      props: { session: session as unknown as ChatSession },
      attachTo: document.body,
    })
    return { view, messages, root: view.element as HTMLElement }
  }

  it('keeps the end in view for a reader who was already there', async () => {
    const { view, messages, root } = growing()
    sized(root, 400)
    root.scrollTop = 300

    messages.value = [...messages.value, message({ id: 'a1', role: 'assistant', content: 'So.' })]
    sized(root, 700)
    await nextTick()

    expect(root.scrollTop).toBe(700)
    view.unmount()
  })

  it('leaves a reader who scrolled back where they were', async () => {
    const { view, messages, root } = growing()
    sized(root, 400)
    root.scrollTop = 0
    await view.trigger('scroll')

    messages.value = [...messages.value, message({ id: 'a1', role: 'assistant', content: 'So.' })]
    sized(root, 700)
    await nextTick()

    expect(root.scrollTop).toBe(0)
    view.unmount()
  })

  it('follows the text of a reply as it streams', async () => {
    const streamingContent = ref('')
    const session = fakeChatSession({ overrides: { isStreaming: ref(true), streamingContent } })
    const view = mount(CommentThread, {
      props: { session: session as unknown as ChatSession },
      attachTo: document.body,
    })
    const root = view.element as HTMLElement
    sized(root, 200)
    root.scrollTop = 100

    streamingContent.value = 'It begins'
    sized(root, 500)
    await nextTick()

    expect(root.scrollTop).toBe(500)
    view.unmount()
  })

  it('keeps the end in view when the thinking block is opened', async () => {
    // A `<details>` opening changes no node and no text: only its own `open` attribute. An
    // observer watching `childList` alone sees nothing, so the block unfolds, the thread grows
    // by however long the reasoning was, and the answer under it goes below the fold.
    const messages = ref<ChatMessage[]>([
      message({ id: 'a1', role: 'assistant', content: 'So.', thinking: 'Working it out' }),
    ])
    const session = fakeChatSession({ messages })
    const view = mount(CommentThread, {
      props: { session: session as unknown as ChatSession },
      attachTo: document.body,
    })
    const root = view.element as HTMLElement
    // The markdown lands first: its own arrival is a mutation, and this test is about the one
    // that follows it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    sized(root, 400)
    root.scrollTop = 300

    root.querySelector('.abele-comment-thread__thinking')?.setAttribute('open', '')
    sized(root, 700)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.scrollTop).toBe(700)
    view.unmount()
  })

  it('keeps the end in view while the markdown of a reply is still landing', async () => {
    // `Markdown` renders through Obsidian, which answers whenever it answers: the thread is
    // nearly empty when it mounts and grows several times afterwards with nothing in the
    // session changing. Watching the session alone leaves the card sitting at the top.
    const { view, root } = growing()
    sized(root, 400)
    root.scrollTop = 300

    root
      .querySelector('.abele-comment-thread__msg')
      ?.appendChild(root.ownerDocument.createElement('p'))
    sized(root, 700)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.scrollTop).toBe(700)
    view.unmount()
  })
})
