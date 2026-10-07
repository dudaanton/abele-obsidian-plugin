import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import ChatNavigation from '@/components/ChatNavigation.vue'
import AiChat from '@/components/AiChat.vue'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'

const messages: ChatMessage[] = [
  { id: 'q1', role: 'user', content: 'Plan a sample garden', timestamp: 1000 },
  { id: 'a1', role: 'assistant', content: 'Put a pond near the shed.', timestamp: 2000 },
  {
    id: 't1',
    role: 'tool-call',
    content: '',
    toolName: 'read',
    toolResult: 'A pond liner',
    toolStatus: 'pending',
    timestamp: 3000,
  },
  { id: 'q2', role: 'user', content: 'Add some shade', timestamp: 86401000 },
]
let wrapper: VueWrapper | undefined
const root = () => document.querySelector<HTMLElement>('.abele-chat-navigation')!
const click = async (text: string) => {
  const button = [...root().querySelectorAll<HTMLElement>('button, summary')].find((el) =>
    el.textContent?.includes(text)
  )!
  button.click()
  await flushPromises()
}

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

const open = async (extra = {}) => {
  wrapper = mount(ChatNavigation, {
    props: { messages, comments: [], state: { expanded: [], scrollTop: 0 }, ...extra },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('the navigation modal', () => {
  it('shows dated questions, leaves the search unfocused, and expands only navigation rows', async () => {
    await open({ activeMessageId: 'a1' })
    expect([...root().querySelectorAll('[data-question]')].map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Plan a sample garden'),
        expect.stringContaining('Add some shade'),
      ])
    )
    expect(root().querySelectorAll('.abele-date-divider')).toHaveLength(2)
    expect(document.activeElement).not.toBe(root().querySelector('input'))
    expect(root().querySelector('[data-current="true"]')).not.toBeNull()
    expect(root().textContent).not.toContain('Put a pond near')
    await click('Answers · 1')
    expect(root().textContent).toContain('Put a pond near')
    expect(wrapper!.emitted('jump')).toBeUndefined()
    await click('Put a pond near')
    expect(wrapper!.emitted('jump')![0]).toEqual(['a1'])
  })

  it('offers start, latest, back, and search results in folded tool details without switching branches', async () => {
    await open({ canGoBack: true })
    await click('To start')
    await click('To latest')
    await click('Back to place')
    expect(wrapper!.emitted('start')).toHaveLength(1)
    expect(wrapper!.emitted('latest')).toHaveLength(1)
    expect(wrapper!.emitted('back')).toHaveLength(1)
    const input = root().querySelector('input')!
    input.value = 'liner'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(root().textContent).toContain('A pond liner')
    await click('A pond liner')
    expect(wrapper!.emitted('jump')![0]).toEqual(['t1', 'result', 'liner'])
    expect(root().textContent).not.toContain('All branches')
  })

  it('uses arrows to move focus and Enter to jump, and closes with Escape', async () => {
    await open()
    const input = root().querySelector('input')!
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    )
    expect(document.activeElement?.getAttribute('data-question')).toBe('q1')
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
    expect(wrapper!.emitted('jump')![0]).toEqual(['q1'])
    root().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })

  it('keeps expansions and list position on reopen', async () => {
    const state = { expanded: [] as string[], scrollTop: 0 }
    await open({ state })
    await click('Answers · 1')
    const list = root().querySelector<HTMLElement>('.abele-chat-navigation__list')!
    list.scrollTop = 120
    list.dispatchEvent(new Event('scroll'))
    await flushPromises()
    wrapper!.unmount()
    await open({ state })
    expect(root().textContent).toContain('Put a pond near')
    expect(root().querySelector('.abele-chat-navigation__list')!.scrollTop).toBe(120)
  })

  it('shows direct discussion questions and jumps through the existing comment path, reading children only on expansion', async () => {
    const comments = CommentService.getInstance()
    const child = fakeChatSession({
      messages: ref([{ id: 'dq', role: 'user', content: 'Which pond liner?', timestamp: 1 }]),
      overrides: { messageComments: ref([{ id: 'nested', message: 'dq', quote: 'liner' }]) },
    })
    const load = vi.spyOn(comments, 'load').mockResolvedValue(child as never)
    await open({ comments: [{ id: 'direct', message: 'a1', quote: 'pond' }] })
    expect(root().textContent).toContain('Discussions · 1')
    expect(root().textContent).toContain('Which pond liner?')
    expect(load.mock.calls).toEqual([['direct']])
    await click('Which pond liner?')
    expect(wrapper!.emitted('discussion')![0]).toEqual(['direct'])
    await click('Nested discussions · 1')
    expect(load.mock.calls).toEqual([['direct'], ['nested']])
  })

  it('keeps a long quoted passage compact without changing its stored anchor', async () => {
    vi.spyOn(CommentService.getInstance(), 'load').mockResolvedValue(null)
    const quote = 'A sample passage with many words. '.repeat(100)
    const comment = { id: 'long-quote', message: 'a1', quote }
    await open({ comments: [comment] })
    expect(
      root().querySelector('.abele-chat-navigation__discussion button')!.textContent!.length
    ).toBeLessThan(200)
    expect(comment.quote).toBe(quote)
  })

  it('labels missing discussions instead of losing their anchors', async () => {
    vi.spyOn(CommentService.getInstance(), 'load').mockResolvedValue(null)
    await open({ comments: [{ id: 'missing', message: 'a1', quote: 'sample passage' }] })
    expect(root().textContent).toContain('sample passage')
    expect(root().textContent).toContain('Discussion unavailable')
  })
})

describe('navigation in the chat header', () => {
  const pause = useFakeClock()
  it('opens beside find and mounts an old question without switching the current branch', async () => {
    const rows = ref<ChatMessage[]>(
      Array.from({ length: 100 }, (_, i) => ({
        id: `q${i}`,
        role: 'user',
        content: `Sample question ${i}`,
        timestamp: i + 1,
      }))
    )
    const switchBranch = vi.fn()
    const session = fakeChatSession({ messages: rows, kind: 'chat', overrides: { switchBranch } })
    const service = ChatService.getInstance()
    vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-message-id="q0"]').exists()).toBe(false)
    await wrapper.find('.abele-ai-chat__navigation').trigger('click')
    await flushPromises()
    await click('Sample question 0')
    await pause(80)
    expect(root()).toBeNull()
    expect(wrapper.find('[data-message-id="q0"]').exists()).toBe(true)
    expect(switchBranch).not.toHaveBeenCalled()
  })
})
