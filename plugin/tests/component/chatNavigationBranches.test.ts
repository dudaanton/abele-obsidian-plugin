import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import ChatNavigation from '@/components/ChatNavigation.vue'
import { CommentService } from '@/ai/CommentService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'
const pause = useFakeClock()
const rows: ChatMessage[] = [
  { id: 'q', role: 'user', content: 'A shared sample question', timestamp: 1 },
  { id: 'a', parentId: 'q', role: 'assistant', content: 'First pond answer', timestamp: 2 },
  { id: 'b', parentId: 'q', role: 'assistant', content: 'Alternate pond answer', timestamp: 3 },
  { id: 'bq', parentId: 'b', role: 'user', content: 'A nested sample question', timestamp: 4 },
  { id: 'b1', parentId: 'bq', role: 'assistant', content: 'Nested first answer', timestamp: 5 },
  { id: 'b2', parentId: 'bq', role: 'assistant', content: 'Nested second answer', timestamp: 6 },
  { id: 'second-root', role: 'user', content: 'Another conversation start', timestamp: 7 },
]
let wrapper: VueWrapper | undefined
const root = () => document.querySelector<HTMLElement>('.abele-chat-navigation')!
const click = async (text: string) => {
  const el = [...root().querySelectorAll<HTMLElement>('button,summary')].find((e) =>
    e.textContent?.includes(text)
  )!
  el.click()
  await flushPromises()
}
const open = async (extra = {}) => {
  wrapper = mount(ChatNavigation, {
    attachTo: document.body,
    props: {
      messages: rows.slice(0, 2),
      allMessages: rows,
      comments: [],
      state: { expanded: [], scrollTop: 0 },
      ...extra,
    },
  })
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

describe('forks in the contents list', () => {
  it('leaves native scope-selector arrow keys with Obsidian rather than moving to a message', async () => {
    await open()
    const select = root().querySelector<HTMLSelectElement>('select')!
    select.focus()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    select.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(select)
  })

  it('shows root forks and continuations with times and a selected marker; expansion does not jump', async () => {
    await open()
    expect(root().textContent).toContain('Conversation starts · 2')
    expect(root().textContent).toContain('Continuations · 2')
    await click('Continuations · 2')
    expect(root().textContent).toContain('Alternate pond answer')
    expect(root().textContent).toContain('Selected')
    expect(root().querySelector('[data-continuation="b"] time')).not.toBeNull()
    expect(root().textContent).not.toContain('A nested sample question')
    expect(wrapper!.emitted('jump')).toBeUndefined()
    root().querySelector<HTMLElement>('[data-continuation="b"] summary')!.click()
    await flushPromises()
    expect(root().textContent).toContain('A nested sample question')
    expect(root().textContent).not.toContain('Nested second answer')
    const nested = root().querySelector<HTMLElement>('[data-fork-id="bq"] summary')!
    nested.click()
    await flushPromises()
    await click('Nested second answer')
    expect(wrapper!.emitted('jump')!.at(-1)).toEqual(['b2'])
  })

  it('keeps a fork on a hidden successful tool result visible while agent work is folded', async () => {
    const allMessages: ChatMessage[] = [
      rows[0],
      { id: 'call', parentId: 'q', role: 'tool-call', content: '', toolName: 'read', timestamp: 2 },
      {
        id: 'result',
        parentId: 'call',
        role: 'tool-result',
        content: 'Done',
        toolStatus: 'approved',
        timestamp: 3,
      },
      {
        id: 'answer-one',
        parentId: 'result',
        role: 'assistant',
        content: 'First result answer',
        timestamp: 4,
      },
      {
        id: 'answer-two',
        parentId: 'result',
        role: 'assistant',
        content: 'Alternate result answer',
        timestamp: 5,
      },
    ]
    await open({ messages: allMessages.slice(0, 4), allMessages })
    expect(root().querySelector('[data-fork-id="result"]')).not.toBeNull()
    expect(root().querySelector<HTMLDetailsElement>('details')!.open).toBe(false)
    await click('Continuations · 2')
    expect(root().textContent).toContain('Alternate result answer')
  })

  it('offers all-branch search explicitly, counts shared messages once, and names other continuations', async () => {
    await open()
    const input = root().querySelector<HTMLInputElement>('input')!
    input.value = 'pond'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(220)
    expect(root().querySelectorAll('[data-nav-item]')).toHaveLength(1)
    const select = root().querySelector<HTMLSelectElement>('select')!
    expect(select.value).toBe('current')
    select.value = 'all'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await pause(220)
    expect(root().querySelectorAll('[data-nav-item]')).toHaveLength(2)
    expect(root().textContent).toContain('Continuation 2 of 2')
    input.value = 'shared'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(220)
    expect(root().querySelectorAll('[data-nav-item]')).toHaveLength(1)
  })
})

describe('discussion search controls', () => {
  it('does not search nested files until enabled, then shows progress, matches and unavailable anchors', async () => {
    const first = {
      messages: ref([{ id: 'dq', role: 'user', content: 'Parent discussion', timestamp: 1 }]),
      messageComments: ref([
        { id: 'nested', message: 'dq' },
        { id: 'missing', message: 'dq', quote: 'missing sample passage' },
      ]),
      isDestroyed: false,
    }
    const nested = {
      messages: ref([{ id: 'nq', role: 'user', content: 'A pond discussion match', timestamp: 2 }]),
      messageComments: ref([]),
      isDestroyed: false,
    }
    const read = vi
      .spyOn(CommentService.getInstance(), 'navigationPreview')
      .mockImplementation(async (id) =>
        id === 'first' ? (first as never) : id === 'nested' ? (nested as never) : null
      )
    await open({ comments: [{ id: 'first', message: 'q' }] })
    expect(read.mock.calls.map((c) => c[0])).toEqual(['first'])
    const input = root().querySelector<HTMLInputElement>('input')!
    input.value = 'pond'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(220)
    expect(read.mock.calls.map((c) => c[0])).toEqual(['first'])
    root().querySelector<HTMLElement>('[role="checkbox"]')!.click()
    await pause(250)
    expect(root().textContent).toContain('A pond discussion match')
    expect(root().textContent).toContain('3 of 3 discussions')
    expect(root().textContent).toContain('Unavailable discussion')
    expect(root().textContent).toContain('missing sample passage')
    await click('A pond discussion match')
    expect(wrapper!.emitted('discussion')!.at(-1)).toEqual(['nested', 'nq', 'content', 'pond'])
  })

  it('cancels a slow search and ignores a late reply after the query changes', async () => {
    let finish!: (data: never) => void
    const waiting = new Promise<never>((resolve) => {
      finish = resolve
    })
    const first = {
      messages: ref([{ id: 'dq', role: 'user', content: 'Parent discussion', timestamp: 1 }]),
      messageComments: ref([]),
      isDestroyed: false,
    }
    const read = vi
      .spyOn(CommentService.getInstance(), 'navigationPreview')
      .mockResolvedValueOnce(first as never)
      .mockImplementation(() => waiting)
    await open({ comments: [{ id: 'first', message: 'q' }] })
    const input = root().querySelector<HTMLInputElement>('input')!
    input.value = 'pond'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    root().querySelector<HTMLElement>('[role="checkbox"]')!.click()
    await pause(220)
    await click('Cancel search')
    expect(root().textContent).toContain('Search canceled')
    input.value = 'shade'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    finish({
      ...first,
      messages: ref([{ id: 'late', role: 'user', content: 'late pond answer', timestamp: 1 }]),
    } as never)
    await flushPromises()
    expect(root().textContent).not.toContain('late pond answer')
    expect(read.mock.calls).toHaveLength(2)
  })
})
