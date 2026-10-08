import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { useTimelineScroll } from '@/composables/useTimelineScroll'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})

async function pane(
  rowTop: number,
  survives?: (key: string, day: string | null) => boolean,
  dragging = false,
  requestedTop?: number
) {
  const owner = document.createElement('div')
  owner.style.overflowY = 'auto'
  const root = document.createElement('div')
  root.classList.add('abele-timeline__date-block')
  root.dataset.abeleAnchor = 'date:2030-06-15'
  const row = document.createElement('div')
  row.dataset.timelineItem = 'sample-task'
  const space = document.createElement('div')
  root.append(row)
  owner.append(root, space)
  document.body.append(owner)
  let top = rowTop
  vi.spyOn(owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 400))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(
    () =>
      new DOMRect(
        0,
        top + (parseFloat(root.style.paddingTop) || 0) - (owner.scrollTop - 100),
        300,
        40
      )
  )
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  owner.scrollTop = 100
  const items = ref<HTMLElement | null>(null)
  const history = ref<HTMLElement | null>(null)
  const anchorSpace = ref<HTMLElement | null>(null)
  const source = ref(0)
  const scope = effectScope()
  let scroll: ReturnType<typeof useTimelineScroll>
  scope.run(() => {
    scroll = useTimelineScroll(
      items,
      history,
      anchorSpace,
      () => source.value,
      survives,
      () =>
        requestedTop === undefined
          ? null
          : { key: 'sample-task', day: '2030-06-15', top: requestedTop },
      () => dragging
    )
  })
  items.value = root
  anchorSpace.value = space
  await nextTick()
  cleanups.push(() => {
    scope.stop()
    owner.remove()
  })
  const patch = async (change: () => void) => {
    const stop = watch(source, change, { flush: 'post' })
    try {
      source.value++
      await nextTick()
      await nextTick()
    } finally {
      stop()
    }
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
    captureDragLayout: () => scroll.captureDragLayout(),
    items,
    anchorSpace,
    dispose: () => scope.stop(),
  }
}

describe('timeline scroll ownership', () => {
  it('does not let queued drag rollback restore retired styles or overwrite a released editor owner', async () => {
    const p = await pane(100)
    p.root.style.paddingTop = '36px'
    p.space.style.height = '80px'
    const restore = p.captureDragLayout()
    const pending = restore()
    p.dispose()
    p.root.remove()
    p.space.remove()
    p.owner.scrollTop = 250
    await pending
    expect(p.owner.scrollTop).toBe(250)
    expect(p.root.style.paddingTop).toBe('')
    expect(p.space.style.height).toBe('')
  })

  it.each(['root', 'spacer'] as const)(
    'invalidates queued rollback when the current %s is replaced',
    async (part) => {
      const p = await pane(100)
      p.root.style.paddingTop = '36px'
      p.space.style.height = '80px'
      const pending = p.captureDragLayout()()
      p.root.style.paddingTop = '7px'
      p.space.style.height = '9px'
      const replacement = document.createElement('div')
      p.owner.append(replacement)
      if (part === 'root') {
        p.root.remove()
        p.items.value = replacement
      } else {
        p.space.remove()
        p.anchorSpace.value = replacement
      }
      p.owner.scrollTop = 250
      await pending
      await nextTick()
      expect(p.owner.scrollTop).toBe(250)
      expect(p.root.style.paddingTop).toBe('7px')
      expect(p.space.style.height).toBe('9px')
    }
  )

  it.each(['disconnect', 'reparent'] as const)(
    'leaves a newer scroll position alone after owner %s without changing the root refs',
    async (change) => {
      const p = await pane(100)
      p.root.style.paddingTop = '36px'
      const pending = p.captureDragLayout()()
      p.root.style.paddingTop = '7px'
      const nextOwner = document.createElement('div')
      nextOwner.style.overflowY = 'auto'
      document.body.append(nextOwner)
      cleanups.push(() => nextOwner.remove())
      if (change === 'disconnect') p.owner.remove()
      else nextOwner.append(p.root, p.space)
      p.owner.scrollTop = 250
      nextOwner.scrollTop = 350
      await pending
      expect(p.owner.scrollTop).toBe(250)
      expect(nextOwner.scrollTop).toBe(350)
      expect(p.root.style.paddingTop).toBe('7px')
    }
  )

  it('does not let an older callback write or clear a newer restoration before its layout patch', async () => {
    const p = await pane(100)
    const writes = vi.spyOn(p.owner, 'scrollTop', 'set')
    const stale = p.captureDragLayout()()
    p.owner.scrollTop = 250
    p.root.style.paddingTop = '12px'
    p.space.style.height = '55px'
    const restore = p.captureDragLayout()
    // The old await resumes before this flush; the new await resumes after it. An old
    // finally must not clear the new hold and allow the window watcher to anchor it.
    p.source.value++
    const current = restore()
    await stale
    await current
    expect(writes).not.toHaveBeenCalledWith(100)
    expect(p.owner.scrollTop).toBe(250)
    expect(p.root.style.paddingTop).toBe('12px')
    expect(p.space.style.height).toBe('55px')
    expect(p.owner.classList.contains('abele-timeline__scroll-hold')).toBe(false)
  })

  it('rolls temporary drag compensation and scroll back without retaining a cancellation anchor', async () => {
    const p = await pane(100, undefined, true, 100)
    const restore = p.captureDragLayout()
    await p.patch(() => p.shift(-250))
    expect(p.root.style.paddingTop).toBe('150px')
    p.space.style.height = '400px'
    p.owner.scrollTop = 60
    const collapse = p.patch(() => p.shift(250))
    await restore()
    await collapse
    expect(p.root.style.paddingTop).toBe('')
    expect(p.space.style.height).toBe('')
    expect(p.owner.scrollTop).toBe(100)
    expect(p.owner.classList.contains('abele-timeline__scroll-hold')).toBe(false)
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.owner.scrollTop).toBe(100)
    // A subsequent drag still acquires and aligns its own anchor.
    await p.patch(() => p.shift(30))
    expect(p.owner.scrollTop).toBe(130)
  })

  it('preserves compensation that already belonged to an earlier successful drop', async () => {
    const p = await pane(100, undefined, true, 100)
    await p.patch(() => p.shift(-250))
    expect(p.root.style.paddingTop).toBe('150px')
    p.space.style.height = '80px'
    const restore = p.captureDragLayout()
    await p.patch(() => p.shift(-90))
    p.space.style.height = '300px'
    const collapse = p.patch(() => p.shift(90))
    await restore()
    await collapse
    expect(p.root.style.paddingTop).toBe('150px')
    expect(p.space.style.height).toBe('80px')
    expect(p.owner.scrollTop).toBe(0)
  })

  it('corrects deferred native viewport restoration after a drop, but gives way to fresh reader input', async () => {
    const p = await pane(100, undefined, false, 100)
    await p.patch(() => {})
    p.owner.scrollTop = 140
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.owner.scrollTop).toBe(100)
    p.root.dispatchEvent(new Event('wheel', { bubbles: true }))
    p.owner.scrollTop = 140
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.owner.scrollTop).toBe(140)
  })
  it('keeps leading drop room across deferred native scroll events until fresh reader input', async () => {
    const p = await pane(100, undefined, false, 100)
    await p.patch(() => p.shift(-250))
    expect(p.root.style.paddingTop).toBe('150px')
    p.owner.scrollTop = 160
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.root.style.paddingTop).toBe('150px')
    expect(p.owner.scrollTop).toBe(0)
    p.root.dispatchEvent(new Event('wheel', { bubbles: true }))
    p.owner.scrollTop = 160
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.root.style.paddingTop).toBe('')
    expect(p.owner.scrollTop).toBe(10)
  })
  it('holds an explicit drag anchor in screen coordinates when native navigation moves the pane', async () => {
    const p = await pane(100, undefined, true, 100)
    await p.patch(() => {
      vi.spyOn(p.owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 48, 300, 400))
      p.shift(48)
    })
    expect(p.owner.scrollTop).toBe(148)
  })
  it('keeps a drag expansion anchor across owned touchmove events before late layout', async () => {
    const p = await pane(100, undefined, true)
    const stop = watch(
      p.source,
      () => {
        p.root.dispatchEvent(new Event('touchmove', { bubbles: true }))
        p.shift(60)
      },
      { flush: 'post' }
    )
    try {
      await p.patch(() => {})
      expect(p.owner.scrollTop).toBe(160)
    } finally {
      stop()
    }
  })
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

  it.each([-0.5, 0.5])(
    'keeps holding through a %s pixel scroll rounding adjustment before late title layout',
    async (rounding) => {
      const resize = lateResize()
      const p = await pane(50)
      p.owner.classList.add('cm-scroller')
      await p.patch(() => p.shift(50))
      expect(p.owner.scrollTop).toBe(150)
      // An editor can quantize our alignment before delivering its scroll event.
      // This is within the deferred align guard's tolerance, not new reader input.
      p.owner.scrollTop += rounding
      p.owner.dispatchEvent(new Event('scroll'))
      p.shift(48)
      resize()
      expect(p.row.getBoundingClientRect().top).toBe(50)
      expect(p.owner.scrollTop).toBe(198)
    }
  )

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

  it('reserves the native phone header hit area even while its visual header is collapsed', async () => {
    document.body.classList.add('is-phone')
    document.body.style.setProperty('--safe-area-inset-top', '20px')
    document.body.style.setProperty('--view-header-height', '40px')
    cleanups.push(() => {
      document.body.classList.remove('is-phone')
      document.body.style.removeProperty('--safe-area-inset-top')
      document.body.style.removeProperty('--view-header-height')
    })
    const p = await pane(100)
    const strip = document.createElement('div')
    p.owner.append(strip)
    p.history.value = strip
    await nextTick()
    expect(strip.style.getPropertyValue('--abele-timeline-sticky-top')).toBe('60px')
  })

  it('corrects a sticky banner when the scroll owner padding is not its sticky origin', async () => {
    document.body.classList.add('is-phone')
    cleanups.push(() => document.body.classList.remove('is-phone'))
    const p = await pane(100)
    p.owner.style.paddingTop = '40px'
    p.owner.classList.add('workspace-leaf')
    const header = document.createElement('div')
    header.classList.add('view-header')
    const strip = document.createElement('div')
    p.owner.append(header, strip)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 40))
    vi.spyOn(p.root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 1000))
    // The pane pins at its border, not its padding edge.
    vi.spyOn(strip, 'getBoundingClientRect').mockImplementation(
      () =>
        new DOMRect(
          0,
          parseFloat(strip.style.getPropertyValue('--abele-timeline-sticky-top') || '0'),
          300,
          40
        )
    )
    p.history.value = strip
    await nextTick()
    expect(strip.getBoundingClientRect().top).toBe(40)
  })

  it('pins below floating phone navigation outside the scroll leaf', async () => {
    document.body.classList.add('is-phone')
    const p = await pane(100)
    p.owner.classList.add('workspace-leaf')
    const header = document.createElement('div')
    header.classList.add('view-header')
    document.body.append(header)
    cleanups.push(() => {
      header.remove()
      document.body.classList.remove('is-phone')
    })
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 40))
    const strip = document.createElement('div')
    p.owner.append(strip)
    p.history.value = strip
    await nextTick()
    expect(strip.style.getPropertyValue('--abele-timeline-sticky-top')).toBe('40px')
  })

  it('pins below visible navigation controls even when their header wrapper has zero height', async () => {
    document.body.classList.add('is-phone')
    cleanups.push(() => document.body.classList.remove('is-phone'))
    const p = await pane(100)
    p.owner.classList.add('workspace-leaf')
    const header = document.createElement('div')
    header.classList.add('view-header')
    const control = document.createElement('div')
    header.append(control)
    const strip = document.createElement('div')
    p.owner.append(header, strip)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 0))
    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 40))
    p.history.value = strip
    await nextTick()
    expect(strip.style.getPropertyValue('--abele-timeline-sticky-top')).toBe('40px')
  })

  it('follows navigation moving after the first scroll frame without resize or transition events', async () => {
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
    const frames: FrameRequestCallback[] = []
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    p.owner.dispatchEvent(new Event('scroll'))
    frames.shift()!(performance.now())
    headerTop = -40
    const following = frames.shift()
    expect(following).toBeDefined()
    following!(performance.now())
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

  it('does not reserve patch range in an editor even when overflow-anchor is unsupported', async () => {
    const p = await pane(50)
    p.root.dispatchEvent(new Event('touchmove', { bubbles: true }))
    p.owner.classList.add('cm-scroller')
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      overflowY: 'auto',
      overflowAnchor: undefined,
      paddingTop: '0',
    } as unknown as CSSStyleDeclaration)
    let patchSpace = ''
    await p.patch(() => {
      patchSpace = p.space.style.height
    })
    expect(patchSpace).toBe('')
    expect(p.owner.scrollTop).toBe(100)
  })

  it('temporarily disables competing browser scroll anchoring and restores the owner on release', async () => {
    const p = await pane(50)
    p.root.dispatchEvent(new Event('touchmove', { bubbles: true }))
    p.owner.style.setProperty('overflow-anchor', 'auto', 'important')
    await p.patch(() => {})
    expect(p.owner.classList.contains('abele-timeline__scroll-hold')).toBe(true)
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('')
    p.root.dispatchEvent(new Event('touchmove', { bubbles: true }))
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('auto')
    expect(p.owner.style.getPropertyPriority('overflow-anchor')).toBe('important')
    expect(p.owner.classList.contains('abele-timeline__scroll-hold')).toBe(false)
    p.owner.style.removeProperty('overflow-anchor')
    await p.patch(() => {})
    expect(p.owner.classList.contains('abele-timeline__scroll-hold')).toBe(true)
    p.owner.scrollTop += 20
    p.owner.dispatchEvent(new Event('scroll'))
    expect(p.owner.style.getPropertyValue('overflow-anchor')).toBe('')
    expect(p.owner.classList.contains('abele-timeline__scroll-hold')).toBe(false)
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

  it('holds the nearest remaining row at the read position when hidden history removes every visible row', async () => {
    const resize = lateResize()
    let hiding = false
    const p = await pane(50, (key) => !hiding || key !== 'sample-task')
    const next = document.createElement('div')
    next.dataset.timelineItem = 'sample-next'
    p.root.append(next)
    let nextTop = 700
    vi.spyOn(next, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, nextTop - (p.owner.scrollTop - 100), 300, 40)
    )
    hiding = true
    await p.patch(() => {
      p.row.remove()
      nextTop = 20
    })
    expect(next.getBoundingClientRect().top).toBe(50)
    nextTop += 20
    resize()
    expect(next.getBoundingClientRect().top).toBe(50)
  })

  it('keeps a visible surviving row at its own position when the first visible row is hidden', async () => {
    let hiding = false
    const p = await pane(50, (key) => !hiding || key !== 'sample-task')
    const next = document.createElement('div')
    next.dataset.timelineItem = 'sample-next'
    p.root.append(next)
    let nextTop = 120
    vi.spyOn(next, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, nextTop - (p.owner.scrollTop - 100), 300, 40)
    )
    hiding = true
    await p.patch(() => {
      p.row.remove()
      nextTop = 70
    })
    expect(next.getBoundingClientRect().top).toBe(120)
  })

  it('releases virtual space when hiding history leaves no remaining row', async () => {
    const p = await pane(50, () => false)
    p.space.style.height = '400px'
    await p.patch(() => p.row.remove())
    expect(p.space.style.height).toBe('')
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
