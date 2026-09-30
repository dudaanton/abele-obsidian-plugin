/**
 * Find in a chat: a bar over the messages, the count of matches and which one is shown, and the
 * way down and up through them — reaching the messages not mounted yet at the start of a long
 * conversation, and the parts folded away under a message: its reasoning, a tool's result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import AiChat from '@/components/AiChat.vue'
import ChatFindBar from '@/components/ChatFindBar.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { DEFAULT_TAIL_PAGE_SIZE } from '@/composables/useTailPagedList'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'
import { fakeChatSession } from '../helpers/fakeChatSession'

describe('the find bar', () => {
  const bar = (props: Partial<{ query: string; count: number; position: number }> = {}) =>
    mount(ChatFindBar, {
      props: { query: '', count: 0, position: 0, ...props },
      attachTo: document.body,
    })

  afterEach(() => document.body.replaceChildren())

  it('says where the match shown stands, and when there is none', () => {
    expect(
      bar({ query: 'pond', count: 7, position: 3 }).find('.abele-chat-find__count').text()
    ).toBe('3 of 7')
    expect(bar({ query: 'pond' }).find('.abele-chat-find__count').text()).toBe('No results')
    expect(bar().find('.abele-chat-find__count').text()).toBe('')
  })

  it('takes the cursor as it opens', () => {
    const view = bar()
    expect(document.activeElement).toBe(view.find('input').element)
  })

  it('leaves the cursor where it was when told to, as a result landed on a phone is', () => {
    const view = mount(ChatFindBar, {
      props: { query: 'pond', count: 1, position: 1, autofocus: false },
      attachTo: document.body,
    })
    expect(document.activeElement).not.toBe(view.find('input').element)
  })

  it('goes down with Enter, up with Shift+Enter, and closes with Esc', async () => {
    const view = bar({ query: 'pond', count: 2, position: 1 })
    const input = view.find('input')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outside = vi.fn()
    document.body.addEventListener('keydown', outside)
    input.element.dispatchEvent(esc)
    document.body.removeEventListener('keydown', outside)

    expect(view.emitted('next')).toHaveLength(1)
    expect(view.emitted('previous')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
    // Obsidian does not also act on it.
    expect(outside).not.toHaveBeenCalled()
  })

  it('passes what is typed up', async () => {
    const view = bar()
    await view.find('input').setValue('garden')
    expect(view.emitted('update:query')![0]).toEqual(['garden'])
  })

  it('offers no next or previous with nothing found', () => {
    const icons = bar({ query: 'pond' }).findAllComponents(Icon)
    const arrows = icons.filter((i) => ['arrow-up', 'arrow-down'].includes(i.props('icon')!))
    expect(arrows.map((a) => a.props('disabled'))).toEqual([true, true])
  })
})

describe('finding in a long chat', () => {
  const COUNT = DEFAULT_TAIL_PAGE_SIZE * 3
  const messages = ref<ChatMessage[]>([])
  let wrapper: VueWrapper | null = null

  const build = (): ChatMessage[] =>
    Array.from({ length: COUNT }, (_, i) => {
      const id = `m${i + 1}`
      const base = { id, timestamp: i + 1 }
      // The first message, far above what is mounted, mentions the pond.
      if (i === 0) return { ...base, role: 'user', content: 'Where should the pond go?' }
      // One answer thinks about it, folded away under the answer.
      if (i === 5)
        return {
          ...base,
          role: 'assistant',
          content: 'Near the shed.',
          thinking: 'a pond needs shade',
        }
      // A tool's result mentions it, shown only under the call's details.
      if (i === COUNT - 4)
        return {
          ...base,
          role: 'tool-call',
          content: '',
          toolName: 'read',
          toolParams: { path: 'Notes/sample-garden.md' },
          toolResult: 'The pond liner is in the shed.',
          toolStatus: 'approved',
        }
      return { ...base, role: i % 2 ? 'assistant' : 'user', content: `Message ${i + 1}` }
    }) as ChatMessage[]

  const pause = useFakeClock()

  beforeEach(() => {
    useVault([])
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    messages.value = build()
    const service = ChatService.getInstance()
    vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
      value: fakeChatSession({ messages, kind: 'chat' }),
    } as never)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  const open = async () => {
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    const button = wrapper
      .findAllComponents(Icon)
      .find((i) => i.props('icon') === 'search' && i.classes('abele-ai-chat__find'))!
    await button.trigger('click')
    await flushPromises()
    return wrapper
  }

  const search = async (view: VueWrapper, words: string) => {
    await view.find('.abele-chat-find input').setValue(words)
    await pause(160)
    await flushPromises()
  }

  const count = (view: VueWrapper) => view.find('.abele-chat-find__count').text()
  const mounted = (view: VueWrapper, id: string) => view.find(`[data-message-id="${id}"]`)

  it('opens from the button over the chat, with the cursor in it', async () => {
    const view = await open()
    expect(view.find('.abele-chat-find').exists()).toBe(true)
    expect(document.activeElement).toBe(view.find('.abele-chat-find input').element)
  })

  it('counts the matches in the whole conversation, mounted or not, folded or not', async () => {
    const view = await open()
    expect(mounted(view, 'm1').exists()).toBe(false)
    await search(view, 'pond')
    // The question, the reasoning, and the tool's result.
    expect(count(view)).toMatch(/ of 3$/)
  })

  it('walks down and up through them, wrapping round', async () => {
    const view = await open()
    await search(view, 'pond')
    // It starts at the reader: the tool result is the one near the end, which is on screen.
    expect(count(view)).toBe('3 of 3')
    await view.find('.abele-chat-find input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(count(view)).toBe('1 of 3')
    await view.find('.abele-chat-find input').trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushPromises()
    expect(count(view)).toBe('3 of 3')
  })

  it('mounts the message a match is in when it is above what is shown', async () => {
    const view = await open()
    await search(view, 'where should')
    await pause(50)
    expect(count(view)).toBe('1 of 1')
    expect(mounted(view, 'm1').exists()).toBe(true)
  })

  it('unfolds the reasoning a match is in', async () => {
    const view = await open()
    await search(view, 'needs shade')
    await pause(50)
    const details = mounted(view, 'm6').find('details').element as HTMLDetailsElement
    expect(details.open).toBe(true)
  })

  it("opens a tool call's details for a match in its result", async () => {
    const view = await open()
    await search(view, 'liner')
    await pause(50)
    const call = mounted(view, `m${COUNT - 3}`)
    expect(call.find('[data-find-part="result"]').text()).toContain('pond liner')
  })

  it('closes with Esc', async () => {
    const view = await open()
    await search(view, 'pond')
    await view.find('.abele-chat-find input').trigger('keydown', { key: 'Escape' })
    expect(view.find('.abele-chat-find').exists()).toBe(false)
  })

  it('counts a message that arrives while it is open', async () => {
    const view = await open()
    await search(view, 'pond')
    const last = messages.value[messages.value.length - 1]
    messages.value = [
      ...messages.value,
      {
        id: 'late',
        parentId: last.id,
        role: 'assistant',
        content: 'A pond pump too.',
        timestamp: 999,
      },
    ]
    await flushPromises()
    expect(count(view)).toMatch(/ of 4$/)
  })

  it('opens with Cmd/Ctrl+F pressed inside the chat, and leaves the key alone elsewhere', async () => {
    wrapper = mount(AiChat, { attachTo: document.body })
    await flushPromises()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    // Both modifiers would not be read as Cmd+F on either platform, so one is sent per platform.
    const press = (target: Element) => {
      for (const mod of ['metaKey', 'ctrlKey'] as const) {
        const e = new KeyboardEvent('keydown', {
          key: 'f',
          code: 'KeyF',
          [mod]: true,
          bubbles: true,
          cancelable: true,
        })
        target.dispatchEvent(e)
      }
    }
    press(outside)
    await flushPromises()
    expect(wrapper.find('.abele-chat-find').exists()).toBe(false)

    const inside = wrapper.find('.abele-ai-chat__messages').element
    inside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    outside.blur()
    press(inside)
    await flushPromises()
    expect(wrapper.find('.abele-chat-find').exists()).toBe(true)
  })
})
