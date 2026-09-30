import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { useTimelineScroll } from '@/composables/useTimelineScroll'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})

async function pane(rowTop: number) {
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
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, top - (owner.scrollTop - 100), 300, 40)
  )
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  owner.scrollTop = 100
  const items = ref<HTMLElement | null>(null)
  const history = ref<HTMLElement | null>(null)
  const anchorSpace = ref<HTMLElement | null>(null)
  const source = ref(0)
  const scope = effectScope()
  scope.run(() => useTimelineScroll(items, history, anchorSpace, () => source.value))
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
  return {
    owner,
    root,
    row,
    space,
    history,
    source,
    patch,
    shift: (amount: number) => (top += amount),
  }
}

describe('timeline scroll ownership', () => {
  const lateResize = () => {
    const callbacks: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      }
    )
    cleanups.push(() => vi.unstubAllGlobals())
    return () => callbacks.forEach((callback) => callback([], {} as ResizeObserver))
  }

  it.each(['touchmove', 'wheel', 'keydown', 'pointerdown', 'scroll'])(
    'releases a hold acquired after touchstart on continuing %s input before late layout',
    async (type) => {
      const resize = lateResize()
      const p = await pane(50)
      p.root.dispatchEvent(new Event('touchstart', { bubbles: true }))
      // Paging can start a new hold in the middle of a pan, after touchstart already ran.
      await p.patch(() => {})
      const event = new Event(type, { bubbles: true, cancelable: true })
      if (type === 'scroll') p.owner.dispatchEvent(event)
      else p.root.dispatchEvent(event)
      p.shift(60)
      resize()
      expect(event.defaultPrevented).toBe(false)
      expect(p.owner.scrollTop).toBe(100)
    }
  )

  it('releases before a deferred align when native scroll moved but its event has not arrived', async () => {
    const resize = lateResize()
    const p = await pane(50)
    await p.patch(() => {})
    p.owner.scrollTop = 140
    p.shift(-40)
    resize()
    expect(p.owner.scrollTop).toBe(140)
  })

  it('does not let a queued nextTick alignment undo a user scroll', async () => {
    const p = await pane(50)
    const stop = watch(
      p.source,
      () => {
        p.owner.scrollTop = 140
        p.shift(-40)
        p.owner.dispatchEvent(new Event('scroll'))
      },
      { flush: 'post' }
    )
    try {
      p.source.value++
      await nextTick()
      await nextTick()
      expect(p.owner.scrollTop).toBe(140)
    } finally {
      stop()
    }
  })

  it('keeps holding through its own scroll event, but releases on a later external scroll', async () => {
    const resize = lateResize()
    const p = await pane(50)
    await p.patch(() => p.shift(50))
    expect(p.owner.scrollTop).toBe(150)
    p.owner.dispatchEvent(new Event('scroll'))
    p.shift(20)
    resize()
    expect(p.owner.scrollTop).toBe(170)
    p.owner.scrollTop = 200
    p.owner.dispatchEvent(new Event('scroll'))
    p.shift(20)
    resize()
    expect(p.owner.scrollTop).toBe(200)
  })

  it('leaves the whole upward touch gesture native without inserting history', async () => {
    const p = await pane(50)
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
    expect(touch('touchstart', 100).defaultPrevented).toBe(false)
    expect(touch('touchmove', 113).defaultPrevented).toBe(false)
    await nextTick()
    await nextTick()
    expect(p.row.getBoundingClientRect().top).toBe(50)
    expect(touch('touchmove', 140).defaultPrevented).toBe(false)
    expect(touch('touchmove', 180).defaultPrevented).toBe(false)
    await nextTick()
    expect([...p.root.children]).toEqual([p.row])
    expect(p.row.getBoundingClientRect().top).toBe(50)
    expect(p.space.style.height).toBe('')
    for (const event of [
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -80 }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'PageUp' }),
    ]) {
      p.root.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      await nextTick()
      expect([...p.root.children]).toEqual([p.row])
    }
    p.owner.scrollTop = 0
    p.owner.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect([...p.root.children]).toEqual([p.row])
  })

  it('repositions the sticky banner when phone navigation finishes transitioning', async () => {
    document.body.classList.add('is-phone')
    cleanups.push(() => document.body.classList.remove('is-phone'))
    const p = await pane(100)
    p.owner.classList.add('workspace-leaf')
    const header = document.createElement('div')
    header.classList.add('view-header')
    const strip = document.createElement('div')
    p.owner.append(header, strip)
    let headerTop = 0
    vi.spyOn(header, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, headerTop, 300, 40)
    )
    p.history.value = strip
    await nextTick()
    expect(strip.style.getPropertyValue('--abele-timeline-sticky-top')).toBe('40px')
    headerTop = -40
    header.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(strip.style.getPropertyValue('--abele-timeline-sticky-top')).toBe('0px')
  })

  it('keeps enough scroll range through a shrinking patch without confusing a layout clamp with input', async () => {
    const p = await pane(50)
    Object.defineProperty(p.owner, 'clientHeight', { value: 400 })
    await p.patch(() => {
      p.shift(-50)
      // A browser clamps scrollTop during the DOM patch if the shorter list loses range.
      if (parseFloat(p.space.style.height || '0') < 500) p.owner.scrollTop = 80
    })
    expect(p.owner.scrollTop).toBe(50)
    expect(p.space.style.height).toBe('')
  })

  it('temporarily disables competing browser scroll anchoring and restores the owner on release', async () => {
    const p = await pane(50)
    p.root.dispatchEvent(new Event('touchmove', { bubbles: true }))
    p.owner.style.setProperty('overflow-anchor', 'auto', 'important')
    await p.patch(() => {})
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('none')
    p.root.dispatchEvent(new Event('touchmove', { bubbles: true }))
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('auto')
    expect(p.owner.style.getPropertyPriority('overflow-anchor')).toBe('important')
    p.owner.style.removeProperty('overflow-anchor')
    await p.patch(() => {})
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('none')
    p.owner.scrollTop += 20
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('')
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
