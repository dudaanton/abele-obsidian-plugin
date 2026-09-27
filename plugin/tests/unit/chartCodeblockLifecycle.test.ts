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

const dispose = vi.fn()
const resize = vi.fn()
vi.mock('@/bases/echarts', () => ({
  echartsInit: vi.fn(() => ({ setOption: vi.fn(), dispose, resize })),
}))

import { registerChartCodeblock } from '@/editor/ChartCodeblock'
import { echartsInit } from '@/bases/echarts'

/** A resize observer the test fires by hand, with the width the container reached. */
const observers: Array<{ cb: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = []
class FakeResizeObserver {
  disconnect = vi.fn()
  constructor(private readonly cb: ResizeObserverCallback) {
    observers.push({ cb, disconnect: this.disconnect })
  }
  observe() {}
  unobserve() {}
}
const fireResize = (width: number) => {
  for (const o of observers)
    o.cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
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
  observers.length = 0
  children = []
  dispose.mockClear()
  vi.mocked(echartsInit).mockClear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  registerChartCodeblock((_lang, h) => {
    handler = h
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a chart block', () => {
  it('belongs to the render that drew it', () => {
    const parent = document.createElement('div')
    const el = parent.createDiv()
    handler(SOURCE, el, ctx())

    expect(children).toHaveLength(1)
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
})
