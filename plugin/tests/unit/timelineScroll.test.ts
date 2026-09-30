import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { useTimelineScroll } from '@/composables/useTimelineScroll'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})

async function pane(rowTop: number, reveal: () => void = () => {}) {
  const owner = document.createElement('div')
  owner.style.overflowY = 'auto'
  const root = document.createElement('div')
  const row = document.createElement('div')
  row.dataset.timelineItem = 'sample-task'
  const space = document.createElement('div')
  root.append(row)
  owner.append(root, space)
  document.body.append(owner)
  let top = rowTop
  vi.spyOn(owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 400))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, top, 300, 40))
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  owner.scrollTop = 100
  const items = ref<HTMLElement | null>(null)
  const history = ref<HTMLElement | null>(null)
  const anchorSpace = ref<HTMLElement | null>(null)
  const source = ref(0)
  const scope = effectScope()
  scope.run(() => useTimelineScroll(items, history, anchorSpace, () => source.value, reveal))
  items.value = root
  anchorSpace.value = space
  await nextTick()
  cleanups.push(() => {
    scope.stop()
    owner.remove()
  })
  const patch = async (change: () => void) => {
    const stop = watch(source, change, { flush: 'post' })
    source.value++
    await nextTick()
    await nextTick()
    stop()
  }
  return { owner, root, row, space, history, patch, shift: (amount: number) => (top += amount) }
}

describe('timeline scroll ownership', () => {
  it('keeps a revealed row under the finger through the entire upward touch gesture', async () => {
    let inserted = 0
    const earlier = document.createElement('div')
    vi.spyOn(earlier, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -100, 300, 100))
    const reveal = vi.fn(() => {
      inserted = 200
      p.root.prepend(earlier)
    })
    const p = await pane(50, reveal)
    vi.mocked(p.row.getBoundingClientRect).mockImplementation(
      () => new DOMRect(0, 50 + inserted - (p.owner.scrollTop - 100), 300, 40)
    )
    const strip = document.createElement('div')
    p.owner.prepend(strip)
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 40))
    p.history.value = strip
    await nextTick()
    const touch = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', { value: [{ clientY: y }] })
      p.root.dispatchEvent(event)
      return event
    }
    touch('touchstart', 100)
    touch('touchmove', 113)
    await nextTick()
    await nextTick()
    expect(p.row.getBoundingClientRect().top).toBe(63)
    expect(touch('touchmove', 140).defaultPrevented).toBe(true)
    touch('touchmove', 180)
    await nextTick()
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(p.row.getBoundingClientRect().top).toBe(130)
  })

  it('does not scroll note text when every timeline row is below the viewport', async () => {
    const p = await pane(700)
    await p.patch(() => p.shift(50))
    expect(p.owner.scrollTop).toBe(100)
  })

  it('still holds a partly visible row when no fully visible unfinished row exists', async () => {
    const p = await pane(-10)
    await p.patch(() => p.shift(50))
    expect(p.owner.scrollTop).toBe(150)
  })

  it('releases virtual space when filtering removes the held row', async () => {
    const p = await pane(50)
    p.space.style.height = '400px'
    await p.patch(() => p.row.remove())
    expect(p.space.style.height).toBe('')
  })

  it('releases unnecessary virtual space when the reader scrolls back to the top', async () => {
    const p = await pane(50)
    p.space.style.height = '400px'
    p.owner.scrollTop = 0
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.space.style.height).toBe('')
  })
})
