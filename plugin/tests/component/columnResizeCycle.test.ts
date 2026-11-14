import { afterEach, expect, it, vi } from 'vitest'
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian'
import { initializeAsides } from '@/columns/aside'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  let deliver!: () => void
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        deliver = callback
      }
      observe() {}
      disconnect = disconnect
    }
  )
  const parent = document.createElement('div')
  parent.style.width = '393px'
  parent.innerHTML =
    '<div data-abele-column-role="aside"><div class="callout-title"><div class="callout-title-inner">Reference</div></div><div class="callout-content">Sample text</div></div>'
  const aside = parent.firstElementChild as HTMLElement
  let width = 393
  vi.spyOn(parent, 'clientWidth', 'get').mockImplementation(() => width)
  let child!: MarkdownRenderChild
  initializeAsides(parent, [aside], 'aside-collapse', {
    addChild(value: MarkdownRenderChild) {
      child = value
      child.load()
    },
  } as MarkdownPostProcessorContext)
  const mutations = new MutationObserver(() => {})
  mutations.observe(parent, { subtree: true, attributes: true, childList: true })
  return {
    aside,
    deliver: () => deliver(),
    disconnect,
    mutations,
    width: (value: number) => {
      width = value
    },
    destroy: () => {
      child.unload()
      mutations.disconnect()
    },
  }
}

it('settles resize delivery without rewriting an unchanged narrow aside', () => {
  const f = fixture()
  try {
    // A height change from rendered content delivers another measurement at the same width.
    f.deliver()
    expect(f.mutations.takeRecords()).toHaveLength(0)
    f.width(380)
    f.deliver()
    expect(f.mutations.takeRecords()).toHaveLength(0)
    f.width(800)
    f.deliver()
    expect(f.aside.dataset.abeleAsideCollapsed).toBe('false')
    expect(f.mutations.takeRecords().length).toBeGreaterThan(0)
    f.deliver()
    expect(f.mutations.takeRecords()).toHaveLength(0)
  } finally {
    f.destroy()
  }
})

it('cuts off resize feedback that alternates across the layout breakpoint', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  const f = fixture()
  try {
    // Model a host layout whose available width changes after each folding write.
    for (let delivery = 0; delivery < 100; delivery++) {
      f.width(delivery % 2 ? 499 : 501)
      f.deliver()
    }
    expect(f.disconnect).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledOnce()
    f.mutations.takeRecords()
    f.width(393)
    f.deliver()
    expect(f.mutations.takeRecords()).toHaveLength(0)
    // A queued observer delivery must not rearm the circuit after a quiet period.
    vi.mocked(Date.now).mockReturnValue(10000)
    f.deliver()
    expect(f.mutations.takeRecords()).toHaveLength(0)
    expect(warning).toHaveBeenCalledOnce()
  } finally {
    f.destroy()
  }
})

it('allows ordinary resizes separated by a quiet interval and ignores delivery after unload', () => {
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const f = fixture()
  try {
    for (let delivery = 0; delivery < 40; delivery++) {
      now += 2000
      f.width(delivery % 2 ? 393 : 800)
      f.deliver()
      expect(f.aside.dataset.abeleAsideCollapsed).toBe(String(delivery % 2 === 1))
    }
    expect(f.disconnect).not.toHaveBeenCalled()
    f.destroy()
    f.width(800)
    f.deliver()
    expect(f.aside.dataset.abeleAsideCollapsed).toBe('true')
  } finally {
    f.destroy()
  }
})
