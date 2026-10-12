/**
 * The codes at the end of a question's row in a chat's outline — its branches, discussions and
 * tool calls — open that row where it is. The row itself jumps to the question and closes the
 * outline; its codes are for seeing what is under it without going anywhere.
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

it.each([
  ['a click', (el: HTMLElement) => el.click()],
  [
    'Enter',
    (el: HTMLElement) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  ],
])("opens a question's row in place from its codes on %s, without jumping", async (_, press) => {
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
  const code = () => row().querySelector<HTMLElement>('.abele-chat-outline__code_work')!
  expect(code().getAttribute('role')).toBe('button')

  press(code())
  await flushPromises()
  expect(row().getAttribute('aria-expanded')).toBe('true')
  expect(wrapper.emitted('jump')).toBeUndefined()
  expect(wrapper.emitted('close')).toBeUndefined()

  // Pressed again it leaves the row open: folding it is the arrow's.
  press(code())
  await flushPromises()
  expect(row().getAttribute('aria-expanded')).toBe('true')
  expect(wrapper.emitted('jump')).toBeUndefined()

  // The row's own text still goes to the question.
  row().querySelector<HTMLElement>('.abele-tree-item__text')!.click()
  await flushPromises()
  expect(wrapper.emitted('jump')?.[0]?.[0]).toBe('q1')
})
