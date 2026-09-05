/**
 * The strip of chat tabs above the sidebar chat.
 *
 * Its chips scroll sideways when there are more than fit, and the one for the current chat has
 * to be where it can be seen: a new chat opens as the last chip, and on a full strip that is
 * past the right edge, where it stayed until scrolled to by hand. happy-dom computes no layout,
 * so the geometry is stubbed; what is asserted is where the strip is scrolled to.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AiChatTabs, { type TabInfo } from '@/components/AiChatTabs.vue'

const tab = (id: string, isActive = false): TabInfo => ({
  id,
  label: `Chat ${id}`,
  isStreaming: false,
  isActive,
})

const rect = (left: number, right: number): DOMRect =>
  ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0 }) as DOMRect

/** A 300px strip, with 100px chips, the third and fourth of them past its right edge. */
function stripOf(view: ReturnType<typeof mount>) {
  const strip = view.find('.abele-chat-tabs__list').element as HTMLElement
  strip.getBoundingClientRect = () => rect(0, 300)
  const chips = view.findAll('.abele-chat-tabs__chip').map((c) => c.element as HTMLElement)
  chips.forEach((chip, i) => {
    chip.getBoundingClientRect = () =>
      rect(i * 100 - strip.scrollLeft, (i + 1) * 100 - strip.scrollLeft)
  })
  return strip
}

describe('the strip of chat tabs', () => {
  it('scrolls a tab into view when it becomes the active one', async () => {
    const tabs = [tab('a', true), tab('b'), tab('c'), tab('d')]
    const view = mount(AiChatTabs, { props: { tabs, canCreate: true } })
    const strip = stripOf(view)
    expect(strip.scrollLeft).toBe(0)

    await view.setProps({ tabs: [tab('a'), tab('b'), tab('c'), tab('d', true)] })
    await nextTick()

    // The chip ends at 400; the visible end of the strip is 300 less the fade the add button
    // paints over it, so the strip moves by the difference and the chip is clear of the fade.
    expect(strip.scrollLeft).toBe(112)
  })

  it('scrolls back when the active tab is off the left edge', async () => {
    const tabs = [tab('a'), tab('b'), tab('c'), tab('d', true)]
    const view = mount(AiChatTabs, { props: { tabs, canCreate: true } })
    const strip = stripOf(view)
    strip.scrollLeft = 112

    await view.setProps({ tabs: [tab('a', true), tab('b'), tab('c'), tab('d')] })
    await nextTick()

    expect(strip.scrollLeft).toBe(0)
  })

  it('leaves the strip alone when the active tab is already in view', async () => {
    const tabs = [tab('a', true), tab('b'), tab('c'), tab('d')]
    const view = mount(AiChatTabs, { props: { tabs, canCreate: true } })
    const strip = stripOf(view)

    await view.setProps({ tabs: [tab('a'), tab('b', true), tab('c'), tab('d')] })
    await nextTick()

    expect(strip.scrollLeft).toBe(0)
  })
})
