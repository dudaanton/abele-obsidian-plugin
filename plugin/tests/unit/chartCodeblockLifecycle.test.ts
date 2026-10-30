/**
 * An `abele-chart` block lets go of its chart when whatever rendered it goes.
 *
 * The block used to watch its parent for its own removal. That only ever notices the block
 * being taken out of its parent — not a chat message, a script view or a whole reading view
 * being closed around it, which removes an ancestor and leaves the parent's own children as
 * they were. ECharts keeps every live instance in a registry of its own, so each chart in a
 * closed chat stayed alive, observers and all. The block is now a child of the render, like
 * the map and the diagram beside it, and goes when the render is unloaded.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { nextTick } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'

const dispose = vi.fn()
const resize = vi.fn()
const setOption = vi.fn()
vi.mock('@/bases/echarts', () => ({
  echartsInit: vi.fn(() => ({ setOption, dispose, resize })),
}))

import { registerChartCodeblock } from '@/editor/ChartCodeblock'
import { echartsInit } from '@/bases/echarts'
import { markPrintRoot } from '@/markdown/printMode'

/** A resize observer the test fires by hand, with the width the container reached. */
const observers: Array<{ cb: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = []
let measuredWidth = 0
let frame: FrameRequestCallback | undefined
class FakeResizeObserver {
  disconnect = vi.fn()
  constructor(private readonly cb: ResizeObserverCallback) {
    observers.push({ cb, disconnect: this.disconnect })
  }
  observe() {}
  unobserve() {}
}
const fireResize = (width: number) => {
  measuredWidth = width
  for (const o of observers)
    o.cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
  const cb = frame
  frame = undefined
  cb?.(0)
}

let handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
let children: Array<{ unload(): void; onunload(): void }>

const ctx = () =>
  ({
    sourcePath: '',
    getSectionInfo: () => null,
    addChild: (child: { unload(): void; onunload(): void }) => {
      children.push(child)
    },
  }) as unknown as MarkdownPostProcessorContext

const SOURCE = 'type: bar\nxLabels: [a, b]\nseries:\n  - name: s\n    data: [1, 2]'

beforeEach(() => {
  measuredWidth = 0
  frame = undefined
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => measuredWidth)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined
  })
  observers.length = 0
  children = []
  dispose.mockClear()
  setOption.mockClear()
  vi.mocked(echartsInit).mockClear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  registerChartCodeblock((_lang, h) => {
    handler = h
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a chart block', () => {
  it('belongs to the render that drew it', () => {
    const parent = document.createElement('div')
    const el = parent.createDiv()
    handler(SOURCE, el, ctx())

    expect(children).toHaveLength(1)
    children[0].onunload()
  })

  it('disposes its chart and stops observing when that render is unloaded', () => {
    const outer = document.body.createDiv()
    const el = outer.createDiv().createDiv()
    handler(SOURCE, el, ctx())
    fireResize(300)
    expect(echartsInit).toHaveBeenCalledTimes(1)

    // A whole message closed: an ancestor goes, the block's own parent is untouched.
    outer.remove()
    children[0].onunload()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(observers.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true)
    outer.remove()
  })

  it('never starts a chart once unloaded before it had a width', () => {
    const el = document.createElement('div').createDiv()
    handler(SOURCE, el, ctx())
    children[0].onunload()
    fireResize(300)

    expect(echartsInit).not.toHaveBeenCalled()
  })

  it('keeps the container the slides and the chat look for, at the configured height', () => {
    const el = document.body.createDiv()
    handler('height: 220\n' + SOURCE, el, ctx())
    const container = el.querySelector<HTMLElement>('.abele-chart-container')
    expect(container).not.toBeNull()
    expect(container!.style.height).toBe('220px')
    children[0].onunload()
    el.remove()
  })

  it('draws the chart again in the new colours when the theme changes', async () => {
    const el = document.body.createDiv()
    handler(SOURCE, el, ctx())
    fireResize(300)
    expect(echartsInit).toHaveBeenCalledTimes(1)
    expect(setOption).toHaveBeenCalledTimes(1)

    GlobalStore.getInstance().themeVersion.value++
    await nextTick()
    await nextTick()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(echartsInit).toHaveBeenCalledTimes(2)
    expect(setOption).toHaveBeenCalledTimes(2)
    children[0].onunload()
    expect(dispose).toHaveBeenCalledTimes(2)
    el.remove()
  })

  it.each([
    ['a block that is not YAML', 'series: [', 'YAML parse error'],
    ['a block with no series', 'type: bar', 'No series defined'],
    ['a malformed series', 'series: [null]', 'Chart error'],
    ['a zero step', 'x: [0, 1, 0]\nseries:\n  - formula: x', 'Invalid x range'],
    ['a zero default step', 'x: [0, 0]\nseries:\n  - formula: x', 'Invalid x range'],
    ['a reversed step', 'x: [0, 1, -1]\nseries:\n  - formula: x', 'Invalid x range'],
    ['an infinite step', 'x: [0, 1, .inf]\nseries:\n  - formula: x', 'Invalid x range'],
    ['too many samples', 'x: [0, 1, 1e-20]\nseries:\n  - formula: x', 'sampling limit'],
  ])('says what is wrong with %s', (_name, source, text) => {
    const el = document.body.createDiv()
    handler(source, el, ctx())
    const error = el.querySelector('.abele-chart-error')
    expect(error?.textContent).toContain(text)
    expect(error?.getAttribute('role')).toBe('alert')
    expect(el.querySelector('.abele-chart-container')).toBeNull()
    children[0]?.onunload()
    el.remove()
  })

  it('shows sampling errors during print rendering too', () => {
    const el = document.createElement('div')
    markPrintRoot(el)
    handler('x: [0, 1, 1e-20]\nseries:\n  - formula: x', el, ctx())
    expect(el.textContent).toContain('sampling limit')
    expect(echartsInit).not.toHaveBeenCalled()
  })

  it('replaces the chart with the error when the chart cannot be drawn', async () => {
    setOption.mockImplementationOnce(() => {
      throw new Error('bad option')
    })
    const el = document.body.createDiv()
    handler(SOURCE, el, ctx())
    fireResize(300)
    await nextTick()
    const error = el.querySelector('.abele-chart-error')
    expect(error?.textContent).toContain('Chart error: bad option')
    expect(el.querySelector('.abele-chart-container')).toBeNull()
    expect(dispose).toHaveBeenCalledTimes(1)
    children[0].onunload()
    el.remove()
  })
})
