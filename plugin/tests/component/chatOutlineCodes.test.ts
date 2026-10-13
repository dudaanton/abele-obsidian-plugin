/**
 * A question's row in a chat's outline: the arrow folds what followed it in place, the row jumps
 * to the question and closes the outline. The codes at its end — branches, discussions, tool
 * calls — only say what is under it; the words are in their tooltips.
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ChatOutlinePane from '@/components/chatOutline/ChatOutlinePane.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const messages: ChatMessage[] = [
  { id: 'q1', role: 'user', content: 'Plan a sample garden', timestamp: 1000 },
  {
    id: 't1',
    role: 'tool-call',
    content: '',
    toolName: 'read',
    toolParams: { path: 'Sample/garden.md' },
    toolStatus: 'approved',
    timestamp: 2000,
  },
  { id: 'a1', role: 'assistant', content: 'Put a pond near the shed.', timestamp: 3000 },
  { id: 'q2', role: 'user', content: 'Add some shade', timestamp: 4000 },
]

let wrapper: VueWrapper | undefined
beforeEach(() => {
  useVault([])
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.replaceChildren()
})

const row = () => document.querySelector<HTMLElement>('[data-question="q1"] > .tree-item-self')!

it.each(['pointer', 'keyboard'] as const)(
  'folds a question with %s without jumping, and codes remain plain marks',
  async (how) => {
    wrapper = mount(ChatOutlinePane, {
      props: {
        messages,
        comments: [],
        state: { expanded: [], scrollTop: 0 },
        preview: async () => null,
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(row().getAttribute('aria-expanded')).toBe('false')
    const code = row().querySelector<HTMLElement>('.abele-chat-outline__code_work')!
    expect(code.getAttribute('role')).toBeNull()
    expect(code.getAttribute('tabindex')).toBeNull()

    const arrow = () => row().querySelector<HTMLElement>('.collapse-icon')!
    const fold = (key: string) => {
      if (how === 'pointer') arrow().click()
      else
        row().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    fold('ArrowRight')
    await flushPromises()
    expect(row().getAttribute('aria-expanded')).toBe('true')
    expect(wrapper.emitted('jump')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()

    // The opposite move folds it back without selecting another message.
    fold('ArrowLeft')
    await flushPromises()
    expect(row().getAttribute('aria-expanded')).toBe('false')
    expect(wrapper.emitted('jump')).toBeUndefined()

    // The row itself, codes included, goes to the question.
    code.click()
    await flushPromises()
    expect(wrapper.emitted('jump')?.[0]?.[0]).toBe('q1')
  }
)
