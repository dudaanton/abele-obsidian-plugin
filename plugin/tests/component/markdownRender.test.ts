/**
 * Re-rendering markdown that is still arriving.
 *
 * A streamed reply re-renders on every token, and rendering goes through Obsidian, which is
 * asynchronous. The component used to empty the element first and render into it afterwards,
 * which left it with no height for as long as the render took — several times a second, in a
 * chat. What that does to the person reading is the bug this is about: the scroll container's
 * range collapses under them, the browser clamps the scroll position, and they are dragged
 * back down. They could not read what had already arrived until the reply finished.
 *
 * Every change also queued a render of its own, unclearable, so a burst of tokens left a queue
 * of renders racing each other into the same element.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { MarkdownRenderer } from 'obsidian'
import Markdown from '@/components/obsidian/Markdown.vue'
import { useVault } from '../helpers/testEnv'

/** How long Obsidian takes over a render here. Long enough to look inside one. */
const RENDER_MS = 30

let rendered: string[]

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  useVault([])
  rendered = []
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
    async (_app: unknown, markdown: string, el: HTMLElement) => {
      rendered.push(markdown)
      await settle(RENDER_MS)
      el.setText(markdown)
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const open = (text: string) => mount(Markdown, { props: { text } })

describe('a second render arriving while the first is on screen', () => {
  it('leaves what is there until the new one is ready to take its place', async () => {
    const wrapper = open('the first paragraph')
    await settle(RENDER_MS * 2)
    expect(wrapper.text()).toBe('the first paragraph')

    await wrapper.setProps({ text: 'the first paragraph and more' })
    await settle(RENDER_MS / 2)

    // Mid-render: the old text is still there, so the element still has its height.
    expect(wrapper.text()).toBe('the first paragraph')
  })

  it('has the new one in place once it is done', async () => {
    const wrapper = open('the first paragraph')
    await settle(RENDER_MS * 2)

    await wrapper.setProps({ text: 'the first paragraph and more' })
    await settle(RENDER_MS * 3)

    expect(wrapper.text()).toBe('the first paragraph and more')
  })

  /** Out of order is what a stream produces, and the newest text is the one that is right. */
  it('does not let a slower earlier render land on top of a later one', async () => {
    const wrapper = open('one')
    await settle(RENDER_MS * 2)

    await wrapper.setProps({ text: 'one two' })
    await settle(1)
    await wrapper.setProps({ text: 'one two three' })
    await settle(RENDER_MS * 4)

    expect(wrapper.text()).toBe('one two three')
  })
})

describe('a burst of changes, as a stream produces', () => {
  it('renders the last of them rather than every one', async () => {
    const wrapper = open('t')
    await settle(RENDER_MS * 2)
    rendered = []

    for (const text of ['to', 'tok', 'toke', 'token']) await wrapper.setProps({ text })
    await settle(RENDER_MS * 3)

    expect(rendered).toEqual(['token'])
  })
})

describe('the component going away mid-render', () => {
  it('leaves no timer behind to fire at an element that has gone', async () => {
    const wrapper = open('something')
    await settle(RENDER_MS * 2)

    await wrapper.setProps({ text: 'something else' })
    wrapper.unmount()

    // Nothing to assert beyond it not throwing: a timer firing after teardown is an unhandled
    // error, which is what once turned a green suite into a failed CI run.
    await expect(settle(RENDER_MS * 3)).resolves.toBeUndefined()
  })
})

describe('a link to a chat in rendered text', () => {
  // `openLinkText` opens it in the leaf the person is reading; the chat file is then taken out
  // of that leaf for the sidebar, and the note that was in it is gone with it.
  it('opens the chat in the sidebar and never in the note’s leaf', async () => {
    const app = useVault([{ path: 'AI/Chats/Trip.abchat', content: '{}' }])
    const openLinkText = vi.fn()
    ;(app as unknown as { workspace: unknown }).workspace = { openLinkText }
    const { ChatService } = await import('@/ai/ChatService')
    const { CommentService } = await import('@/ai/CommentService')
    const service = ChatService.getInstance()
    const opened = vi.spyOn(service, 'openChatFile').mockResolvedValue()
    vi.spyOn(service, 'revealSidebar').mockResolvedValue()
    vi.spyOn(CommentService.getInstance(), 'isCommentFile').mockReturnValue(false)
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app: unknown, _md: string, el: HTMLElement) => {
        el.innerHTML = '<a class="internal-link" data-href="AI/Chats/Trip.abchat">Trip</a>'
      }
    )

    const wrapper = open('[[AI/Chats/Trip.abchat|Trip]]')
    // Opening goes through dynamic imports, so a fixed number of ticks is not enough under load.
    await vi.waitFor(() => expect(wrapper.find('a.internal-link').exists()).toBe(true))
    await wrapper.find('a.internal-link').trigger('click')
    await vi.waitFor(() =>
      expect(opened).toHaveBeenCalledWith(app.vault.getAbstractFileByPath('AI/Chats/Trip.abchat'))
    )
    expect(openLinkText).not.toHaveBeenCalled()
  })

  it('a link to a note still goes through Obsidian', async () => {
    const app = useVault([{ path: 'Plans.md', content: '' }])
    const openLinkText = vi.fn()
    ;(app as unknown as { workspace: unknown }).workspace = { openLinkText }
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app: unknown, _md: string, el: HTMLElement) => {
        el.innerHTML = '<a class="internal-link" data-href="Plans">Plans</a>'
      }
    )

    const wrapper = open('[[Plans]]')
    await settle(5)
    await wrapper.find('a.internal-link').trigger('click')
    await settle(5)

    expect(openLinkText).toHaveBeenCalledWith('Plans', '')
  })
})
