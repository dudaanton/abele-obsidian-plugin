import { expect, it, vi } from 'vitest'
import { MarkdownRenderer } from 'obsidian'
import { hostCanvasViewer } from '@/canvas/adapter'
import * as painter from '@/canvas/core/painter'
import { configureAbele, useVault } from '../helpers/testEnv'
import { nextTick } from 'vue'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

it('changes panel level on camera moves without rendering Markdown again', async () => {
  const config = configureAbele()
  config.ai = { ...DEFAULT_AI_SETTINGS, chatHistory: [] }
  config.headerButtons = []
  const app = useVault([{ path: 'sample.md', content: 'Sample words' }])
  const workspace = Object.assign(app.workspace, {
    openLinkText: vi.fn(async () => {}),
    trigger: vi.fn(),
  })
  const el = document.createElement('div')
  document.body.append(el)
  const render = vi.spyOn(MarkdownRenderer, 'render')
  const viewer = hostCanvasViewer(app as never, el, () => 'sample.canvas')
  viewer.load({
    nodes: [{ id: 'sample', type: 'file', file: 'sample.md', x: 0, y: 0, width: 400, height: 500 }],
    edges: [],
    abele: { notePanels: true },
  })
  Object.defineProperties(viewer.stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 600 },
  })
  const context = vi
    .spyOn(viewer.canvas, 'getContext')
    .mockReturnValue({ setTransform: vi.fn() } as never)
  const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
  const draw = async (zoom: number) => {
    viewer.camera = { x: 0, y: 0, zoom }
    ;(viewer as unknown as { paint(): void }).paint()
    await nextTick()
  }
  try {
    await draw(1)
    const body = el.querySelector('.abele-canvas-card')
    expect(body?.classList.contains('abele-canvas-card_panels')).toBe(true)
    const top = body?.querySelector('.abele-header-widget-container')
    const textBody = render.mock.calls[0][2]
    expect(textBody.parentElement).toBe(body)
    const link = document.createElement('a')
    link.className = 'internal-link'
    link.setAttribute('data-href', 'target#Part')
    const label = document.createElement('span')
    link.append(label)
    textBody.append(link)
    const down = vi.fn(() => true)
    viewer.input = { down, up: vi.fn(), move: vi.fn(), cancel: vi.fn(), paint: vi.fn() }
    viewer.el.dataset.canvasTool = 'select'
    label.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', ctrlKey: true })
    )
    expect(down).not.toHaveBeenCalled()
    label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    expect(workspace.openLinkText).toHaveBeenCalledWith('target#Part', 'sample.canvas', 'tab')
    label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(workspace.trigger).toHaveBeenCalledWith(
      'hover-link',
      expect.objectContaining({
        targetEl: link,
        linktext: 'target#Part',
        sourcePath: 'sample.canvas',
      })
    )
    await draw(0.9)
    expect(body?.querySelector('.abele-header-widget-container')).toBe(top)
    await draw(0.5)
    expect(body?.classList.contains('abele-canvas-card_codes')).toBe(true)
    expect(body?.querySelector('.abele-header-widget-container')).toBe(top)
    await draw(0.1)
    expect(body?.querySelector('.abele-header-widget-container')).toBeNull()
    expect(render).toHaveBeenCalledTimes(1)
  } finally {
    viewer.destroy()
    el.remove()
    render.mockRestore()
    paint.mockRestore()
    context.mockRestore()
  }
})

it('rerenders text-card links against the new source when a canvas moves', async () => {
  const app = useVault([]),
    el = document.createElement('div')
  document.body.append(el)
  let source = 'sample-first/sample.canvas'
  const render = vi.spyOn(MarkdownRenderer, 'render')
  const viewer = hostCanvasViewer(app as never, el, () => source)
  viewer.load({
    nodes: [
      { id: 'sample', type: 'text', text: '[[sample-note]]', x: 0, y: 0, width: 200, height: 100 },
    ],
    edges: [],
  })
  Object.defineProperties(viewer.stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 400 },
  })
  const context = vi
    .spyOn(viewer.canvas, 'getContext')
    .mockReturnValue({ setTransform: vi.fn() } as never)
  const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
  try {
    ;(viewer as unknown as { paint(): void }).paint()
    await Promise.resolve()
    source = 'sample-second/sample.canvas'
    viewer.load(viewer.graph)
    ;(viewer as unknown as { paint(): void }).paint()
    await Promise.resolve()
    expect(render.mock.calls.map((call) => call[3])).toEqual([
      'sample-first/sample.canvas',
      'sample-second/sample.canvas',
    ])
  } finally {
    viewer.destroy()
    el.remove()
    render.mockRestore()
    paint.mockRestore()
    context.mockRestore()
  }
})

it('composites each card background and markdown together so an upper empty card occludes lower text', async () => {
  const app = useVault([]),
    el = document.createElement('div')
  document.body.append(el)
  const viewer = hostCanvasViewer(app as never, el, () => 'sample.canvas')
  viewer.load({
    nodes: [
      { id: 'alpha', type: 'text', text: 'Lower sample text', x: 0, y: 0, width: 240, height: 120 },
      { id: 'beta', type: 'text', text: '', x: 0, y: 0, width: 240, height: 120 },
      { id: 'image', type: 'file', file: 'sample-image.png', x: 0, y: 0, width: 240, height: 120 },
    ],
    edges: [],
  })
  Object.defineProperties(viewer.stage, {
    clientWidth: { value: 600 },
    clientHeight: { value: 400 },
  })
  const context = vi
    .spyOn(viewer.canvas, 'getContext')
    .mockReturnValue({ setTransform: vi.fn() } as never)
  const paint = vi.spyOn(painter, 'paintCanvas').mockReturnValue({ visible: [], warnings: [] })
  try {
    ;(viewer as unknown as { paint(): void }).paint()
    await Promise.resolve()
    const frames = [...el.querySelectorAll<HTMLElement>('.abele-canvas-card-frame')]
    expect(frames.map((frame) => frame.dataset.cardId)).toEqual(['alpha', 'beta', 'image'])
    expect(frames[0].querySelector('[data-node-id="alpha"]')?.textContent).toBe('Lower sample text')
    for (const frame of frames) expect(frame.firstElementChild?.tagName).toBe('CANVAS')
    expect(frames[1].querySelector('[data-node-id="beta"]')?.parentElement).toBe(frames[1])
    expect(paint.mock.calls[0][4]?.skipCards).toBe(true)
    const changed = { ...viewer.graph, nodes: [...viewer.graph.nodes].reverse() }
    viewer.load(changed)
    ;(viewer as unknown as { paint(): void }).paint()
    expect(
      [...el.querySelectorAll<HTMLElement>('.abele-canvas-card-frame')].map(
        (frame) => frame.dataset.cardId
      )
    ).toEqual(['image', 'beta', 'alpha'])
  } finally {
    viewer.destroy()
    el.remove()
    paint.mockRestore()
    context.mockRestore()
  }
})
