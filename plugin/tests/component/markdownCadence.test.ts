import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { MarkdownRenderer } from 'obsidian'
import Markdown from '@/components/obsidian/Markdown.vue'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'

const advance = useFakeClock()
afterEach(() => vi.restoreAllMocks())
it('bounds slow streaming renders to one in flight and retains only the latest source', async () => {
  useVault([])
  let inFlight = 0,
    peak = 0,
    calls = 0,
    chars = 0
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    calls++
    chars += text.length
    peak = Math.max(peak, ++inFlight)
    await new Promise((resolve) => setTimeout(resolve, 80))
    el.textContent = text
    inFlight--
  })
  const wrapper = mount(Markdown, { props: { text: 'x', streaming: true } })
  try {
    for (let i = 1; i <= 100; i++) {
      await advance(10)
      await wrapper.setProps({ text: 'x'.repeat(i * 10) })
    }
    await wrapper.setProps({ streaming: false })
    await advance(300)
    console.info(`stream: renders=${calls}, peak=${peak}, characters=${chars}`)
    expect(wrapper.text()).toBe('x'.repeat(1000))
    expect(peak).toBe(1)
    expect(calls).toBeLessThanOrEqual(22)
    expect(chars).toBeLessThan(15_000)
  } finally {
    wrapper.unmount()
  }
})

it('flushes final text without waiting out the streaming cadence', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    el.textContent = text
  })
  const wrapper = mount(Markdown, { props: { text: 'one', streaming: true } })
  try {
    await advance(1)
    await wrapper.setProps({ text: 'one two' })
    await advance(1)
    await wrapper.setProps({ text: 'one two three', streaming: false })
    await advance(1)
    expect(wrapper.text()).toBe('one two three')
  } finally {
    wrapper.unmount()
  }
})
