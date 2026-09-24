/**
 * The mermaid viewer: a diagram fitted to the note, which zooms and moves inside its frame.
 *
 * happy-dom lays nothing out, so the frame's width is given here the way the browser would
 * report it, and what is asserted is the transform the viewer puts on the drawing — the one
 * thing that decides what the person sees.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { mermaidStub, Notice } from 'obsidian'
import MermaidDiagram from '@/components/mermaid/MermaidDiagram.vue'
import { clearDiagramCache } from '@/mermaid/renderMermaid'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

const defaultRender = mermaidStub.render
/** The width the note gives the diagram. */
let noteWidth = 400
const openLinkText = vi.fn()

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  const app = useVault([]) as unknown as Record<string, unknown>
  app.workspace = { openLinkText }
  openLinkText.mockReset()
  clearDiagramCache()
  mermaidStub.calls.length = 0
  mermaidStub.render = defaultRender
  installFakeIntersectionObserver()
  resetFakeIntersectionObservers()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  noteWidth = 400
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('abele-mermaid') ? noteWidth : 0
    },
  })
  document.body.className = ''
  document.body.replaceChildren()
  Notice.shown.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
})

/** A flowchart of the given natural size, as the stub renderer reads it. */
const chart = (width: number, height: number) => `graph TD\n%% size ${width}x${height}`

const open = async (source: string, props: Record<string, unknown> = {}) => {
  const wrapper = mount(MermaidDiagram, {
    attachTo: document.body,
    props: { source, sourcePath: 'Notes/Flow.md', ...props },
  })
  scrollIntoView(wrapper.element)
  await flushPromises()
  return wrapper
}

const transform = (wrapper: VueWrapper) =>
  (wrapper.find('.abele-mermaid__canvas').element as HTMLElement).style.transform

const scaleOf = (wrapper: VueWrapper) => Number(/scale\(([\d.]+)\)/.exec(transform(wrapper))?.[1])

describe('drawing', () => {
  it('waits until the diagram comes near the screen', async () => {
    const wrapper = mount(MermaidDiagram, {
      attachTo: document.body,
      props: { source: chart(300, 100), sourcePath: 'a.md' },
    })
    await flushPromises()
    expect(mermaidStub.calls).toHaveLength(0)
    expect(wrapper.find('svg').exists()).toBe(false)

    scrollIntoView(wrapper.element)
    await flushPromises()
    expect(mermaidStub.calls).toHaveLength(1)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('shows what Mermaid said was wrong instead of a diagram', async () => {
    mermaidStub.render = async () => {
      throw Object.assign(new Error('x'), { str: 'Parse error on line 2: unexpected A' })
    }
    const wrapper = await open('graph TD\nA-->')
    expect(wrapper.find('.abele-mermaid__error-text').text()).toBe(
      'Parse error on line 2: unexpected A'
    )
    expect(wrapper.find('.abele-mermaid__frame').exists()).toBe(false)
  })

  it('draws again in the dark theme when the theme switches', async () => {
    const wrapper = await open(chart(300, 100))
    expect(mermaidStub.calls.at(-1)).toContain('"theme": "default"')

    document.body.classList.add('theme-dark')
    GlobalStore.getInstance().themeVersion.value++
    await flushPromises()

    expect(mermaidStub.calls.at(-1)).toContain('"theme": "dark"')
    expect(wrapper.findAll('svg')).toHaveLength(1)
  })
})

describe('fitting the note', () => {
  it('narrows a wide diagram to the note and takes the height that leaves it', async () => {
    const wrapper = await open(chart(800, 400))
    expect(scaleOf(wrapper)).toBe(0.5)
    expect((wrapper.find('.abele-mermaid__frame').element as HTMLElement).style.height).toBe(
      '200px'
    )
  })

  it('shows a small diagram at its own size, in the middle', async () => {
    const wrapper = await open(chart(200, 200))
    expect(transform(wrapper)).toBe('translate(100px, 0px) scale(1)')
  })

  it('caps a tall diagram and shrinks it to fit under the cap', async () => {
    const wrapper = await open(chart(400, 4000))
    const height = parseInt(
      (wrapper.find('.abele-mermaid__frame').element as HTMLElement).style.height
    )
    expect(height).toBeLessThanOrEqual(640)
    expect(scaleOf(wrapper)).toBeCloseTo(height / 4000)
  })
})

describe('the controls', () => {
  it('zooms in and out, and fits the diagram again', async () => {
    const wrapper = await open(chart(800, 300))
    await wrapper.find('.abele-mermaid__zoom-in').trigger('click')
    expect(scaleOf(wrapper)).toBeCloseTo(0.625)
    await wrapper.find('.abele-mermaid__zoom-out').trigger('click')
    await wrapper.find('.abele-mermaid__zoom-out').trigger('click')
    expect(scaleOf(wrapper)).toBeCloseTo(0.4)
    await wrapper.find('.abele-mermaid__reset').trigger('click')
    expect(scaleOf(wrapper)).toBe(0.5)
  })

  it('pans with the arrow buttons and the arrow keys', async () => {
    const wrapper = await open(chart(200, 200))
    await wrapper.find('[aria-label="Pan up"]').trigger('click')
    expect(transform(wrapper)).toBe('translate(100px, 80px) scale(1)')
    await wrapper.find('.abele-mermaid__frame').trigger('keydown', { key: 'ArrowLeft' })
    expect(transform(wrapper)).toBe('translate(180px, 80px) scale(1)')
  })

  it('zooms with the wheel only while Mod is held, and leaves the page scroll alone', async () => {
    const wrapper = await open(chart(800, 300))
    const frame = wrapper.find('.abele-mermaid__frame').element

    const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true })
    frame.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    expect(scaleOf(wrapper)).toBe(0.5)

    const withMod = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })
    // happy-dom's WheelEvent drops the modifier keys it is given.
    Object.defineProperty(withMod, 'ctrlKey', { value: true })
    frame.dispatchEvent(withMod)
    expect(withMod.defaultPrevented).toBe(true)
    expect(scaleOf(wrapper)).toBeGreaterThan(0.5)
  })

  it('moves the diagram by dragging it', async () => {
    const wrapper = await open(chart(200, 200))
    const frame = wrapper.find('.abele-mermaid__frame')
    await frame.trigger('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10,
    })
    await frame.trigger('pointermove', { pointerId: 1, clientX: 40, clientY: 30 })
    await frame.trigger('pointerup', { pointerId: 1, clientX: 40, clientY: 30 })
    expect(transform(wrapper)).toBe('translate(130px, 20px) scale(1)')
  })

  it('opens a note a node links to, but not at the end of a drag', async () => {
    mermaidStub.render = async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 10 10"><g class="node internal-link"><g class="label"><foreignObject><div>Target</div></foreignObject></g></g></svg>`,
    })
    const wrapper = await open('graph TD\nA\nclass A internal-link')
    const link = wrapper.find('a.internal-link')
    await link.trigger('click')
    expect(openLinkText).toHaveBeenCalledWith('Target', 'Notes/Flow.md', false)

    const frame = wrapper.find('.abele-mermaid__frame')
    await frame.trigger('pointerdown', {
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    await frame.trigger('pointermove', { pointerId: 2, clientX: 50, clientY: 0 })
    await frame.trigger('pointerup', { pointerId: 2, clientX: 50, clientY: 0 })
    await link.trigger('click')
    expect(openLinkText).toHaveBeenCalledTimes(1)
  })

  it('copies the source', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const wrapper = await open(chart(300, 100))
    const menu = { items: [] as { title: string; handler: (() => void) | null }[] }
    const { Menu } = await import('obsidian')
    vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function (this: typeof menu) {
      menu.items = this.items
      return this as never
    })
    await wrapper
      .find('[aria-label="Copy the diagram: its source, a picture, or SVG"]')
      .trigger('click')
    expect(menu.items.map((item) => item.title)).toEqual([
      'Copy source',
      'Copy as picture',
      'Copy as SVG',
    ])
    menu.items[0].handler?.()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(chart(300, 100))
    expect(Notice.shown).toContain('Diagram source copied')
  })
})

describe('full screen', () => {
  it('opens the diagram in a dialog of its own and closes it again', async () => {
    const wrapper = await open(chart(800, 300))
    await wrapper.find('.abele-mermaid__fullscreen').trigger('click')
    await flushPromises()

    const dialog = document.querySelector('.modal.abele-modal_full')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('.abele-mermaid_full svg')).not.toBeNull()
    // Drawn once for both: the dialog took the note's drawing.
    expect(mermaidStub.calls).toHaveLength(1)

    wrapper.unmount()
    expect(document.querySelector('.modal.abele-modal_full')).toBeNull()
  })
})
