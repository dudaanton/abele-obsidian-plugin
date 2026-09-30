/**
 * Markdown that is still being written: a reply streaming into a chat.
 *
 * - A block that draws something — a chart, a diagram — waits behind a placeholder until it is
 *   complete, rather than being drawn from half its source and failing with every token.
 * - A block that comes back the same from the next render stays on the page as it is. Built
 *   afresh every time, a diagram fell back to its placeholder height and grew again with each
 *   token, and the text below it shook under the person reading it.
 * - When the reply ends, the message that replaces it takes over what was drawn rather than
 *   starting empty. Empty, the reply had no height for a moment, the chat's scroll range
 *   collapsed and the reader was thrown to its end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { Component, MarkdownRenderChild, MarkdownRenderer } from 'obsidian'
import Markdown from '@/components/obsidian/Markdown.vue'
import { recordSignatures } from '@/components/obsidian/markdownParts'
import { useVault } from '../helpers/testEnv'

import { useFakeClock } from '../helpers/fakeClock'
const settle = useFakeClock()
const RENDER_MS = 10

let rendered: string[]
/** Renders started and not yet finished. */
let inFlight = 0

/**
 * Until every render asked for has landed. Waited for rather than timed: under a loaded machine
 * — the whole suite in a commit hook beside other runs — a fixed pause ran out before a render.
 */
const idle = async () => {
  // A render is asked for from a timer, or a microtask after mounting.
  await settle(1)
  await vi.waitFor(() => expect(inFlight).toBe(0), { timeout: 5000 })
  await settle(1)
}
/** The drawings every render made, and whether each has been let go. */
let drawings: Array<{ source: string; gone: boolean }>

/**
 * Obsidian's renderer in miniature: a paragraph per block, a fenced block as a `pre`, the
 * signatures read before anything draws, then a chart drawn into each ```abele-chart.
 */
const fakeRender = async (
  _app: unknown,
  markdown: string,
  el: HTMLElement,
  _path: string,
  owner: Component
) => {
  rendered.push(markdown)
  inFlight++
  // The fake renderer is delayed on the controlled clock, not advancing that clock itself.
  await new Promise((resolve) => setTimeout(resolve, RENDER_MS))
  inFlight--
  for (const block of markdown.split(/\n\n+/).filter(Boolean)) {
    const fence = /^```([\w-]*)\n([\s\S]*?)(?:\n```)?$/.exec(block)
    if (fence) {
      const pre = el.createEl('pre')
      pre.createEl('code', { cls: `language-${fence[1]}`, text: fence[2] })
    } else {
      el.createEl('p', { text: block })
    }
  }
  recordSignatures(el)
  for (const code of Array.from(el.querySelectorAll('code.language-abele-chart'))) {
    const host = createDiv({ cls: 'chart', text: `chart of ${code.textContent}` })
    code.parentElement!.replaceWith(host)
    const record = { source: code.textContent ?? '', gone: false }
    drawings.push(record)
    const child = new MarkdownRenderChild(host)
    child.onunload = () => {
      record.gone = true
    }
    owner.addChild(child)
  }
}

beforeEach(() => {
  useVault([])
  rendered = []
  drawings = []
  inFlight = 0
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(fakeRender as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const CHART = '```abele-chart\nseries: [1, 2]\n```'

describe('a chart whose block is still being written', () => {
  it('shows a placeholder in its place, not the chart', async () => {
    const wrapper = mount(Markdown, {
      props: { text: 'Numbers first.\n\n```abele-chart\nseries: [1', streaming: true },
    })
    await idle()

    expect(wrapper.find('.abele-md-pending').exists()).toBe(true)
    expect(wrapper.find('.chart').exists()).toBe(false)
    expect(rendered).toEqual(['Numbers first.'])
  })

  it('is drawn once the block is closed', async () => {
    const wrapper = mount(Markdown, {
      props: { text: 'Numbers first.\n\n```abele-chart\nseries: [1', streaming: true },
    })
    await idle()
    await wrapper.setProps({ text: 'Numbers first.\n\n' + CHART })
    await idle()

    expect(wrapper.find('.abele-md-pending').exists()).toBe(false)
    expect(wrapper.find('.chart').text()).toBe('chart of series: [1, 2]')
  })

  it('is drawn at once where the text is not being written', async () => {
    const wrapper = mount(Markdown, { props: { text: 'Numbers.\n\n```abele-chart\nseries: [1' } })
    await idle()

    expect(wrapper.find('.abele-md-pending').exists()).toBe(false)
    expect(wrapper.find('.chart').exists()).toBe(true)
  })
})

describe('the next render of a reply being written', () => {
  const START = 'The first paragraph.\n\n' + CHART + '\n\nThe second'

  it('keeps the blocks that came back the same, the very same elements', async () => {
    const wrapper = mount(Markdown, { props: { text: START, streaming: true } })
    await idle()
    const [first, chart] = Array.from(wrapper.element.children)

    await wrapper.setProps({ text: START + ' paragraph, finished.' })
    await idle()

    const now = Array.from(wrapper.element.children)
    expect(now[0]).toBe(first)
    expect(now[1]).toBe(chart)
    expect(now[2].textContent).toBe('The second paragraph, finished.')
    expect(now).toHaveLength(3)
  })

  it('lets go of the drawings the new render made for the blocks it did not use', async () => {
    const wrapper = mount(Markdown, { props: { text: START, streaming: true } })
    await idle()
    await wrapper.setProps({ text: START + ' one' })
    await idle()
    await wrapper.setProps({ text: START + ' one two' })
    await idle()

    // Three renders drew the chart; only the one on the page is still alive.
    expect(drawings).toHaveLength(3)
    expect(drawings.filter((d) => !d.gone)).toHaveLength(1)
    expect(drawings[0].gone).toBe(false)
  })

  it('replaces a block that changed, and lets its drawing go', async () => {
    const wrapper = mount(Markdown, { props: { text: 'Intro.\n\n' + CHART, streaming: true } })
    await idle()
    const other = CHART.replace('[1, 2]', '[3, 4]')
    await wrapper.setProps({ text: 'Intro.\n\n' + other })
    await idle()

    expect(wrapper.find('.chart').text()).toBe('chart of series: [3, 4]')
    expect(drawings.map((d) => d.gone)).toEqual([true, false])
  })

  it('lets everything go when it is taken off the page', async () => {
    const wrapper = mount(Markdown, { props: { text: START } })
    await idle()
    await wrapper.setProps({ text: START + ' more' })
    await idle()
    wrapper.unmount()
    await settle(5)

    expect(drawings.filter((d) => !d.gone)).toEqual([])
  })
})

describe('a reply that ends and becomes a message', () => {
  /** The chat in miniature: the streaming reply, then the message in its place, in one pass. */
  const Chat = defineComponent({
    props: { done: Boolean, text: { type: String, required: true } },
    setup(props) {
      return () =>
        props.done
          ? h('div', { key: 'message', class: 'message' }, [h(Markdown, { text: props.text })])
          : h('div', { key: 'streaming', class: 'streaming' }, [
              h(Markdown, { text: props.text, streaming: true }),
            ])
    },
  })

  const TEXT = 'The first paragraph.\n\n' + CHART + '\n\nThe last paragraph.'

  it('takes over what was drawn, without drawing it again', async () => {
    const wrapper = mount(Chat, { props: { text: TEXT, done: false } })
    await idle()
    const before = Array.from(wrapper.find('.abele-markdown').element.children)
    rendered = []

    await wrapper.setProps({ done: true })
    await nextTick()
    await settle(0)

    const after = Array.from(wrapper.find('.message .abele-markdown').element.children)
    expect(after).toEqual(before)
    expect(after[1]).toBe(before[1])
    await idle()
    expect(rendered).toEqual([])
    expect(drawings.filter((d) => !d.gone)).toHaveLength(1)
  })

  it('is never empty in between', async () => {
    const wrapper = mount(Chat, { props: { text: TEXT, done: false } })
    await idle()

    await wrapper.setProps({ done: true })
    await nextTick()
    await Promise.resolve()

    expect(wrapper.find('.message .abele-markdown').element.children.length).toBe(3)
  })

  it('draws what had been held back, keeping the rest', async () => {
    const half = 'The first paragraph.\n\n```abele-chart\nseries: [1'
    const wrapper = mount(Chat, { props: { text: half, done: false } })
    await idle()
    const first = wrapper.find('.abele-markdown p').element

    await wrapper.setProps({ done: true, text: 'The first paragraph.\n\n' + CHART })
    await idle()

    const md = wrapper.find('.message .abele-markdown')
    expect(md.element.firstElementChild).toBe(first)
    expect(md.find('.abele-md-pending').exists()).toBe(false)
    expect(md.find('.chart').exists()).toBe(true)
  })

  it('lets what was drawn go when nothing takes it over: the reply was stopped', async () => {
    const show = ref(true)
    const Host = defineComponent({
      setup: () => () => (show.value ? h(Markdown, { text: TEXT, streaming: true }) : null),
    })
    mount(Host)
    await idle()
    show.value = false
    await nextTick()
    await settle(5)

    expect(drawings.filter((d) => !d.gone)).toEqual([])
  })
})
