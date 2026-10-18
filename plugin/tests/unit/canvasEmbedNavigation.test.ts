import { afterEach, expect, it, vi } from 'vitest'
import { CanvasEmbed } from '@/canvas/embed'
import { useVault } from '../helpers/testEnv'
import * as opening from '@/canvas/opening'
import { CanvasImageView } from '@/canvas/CanvasImageView'
import { mountKit } from '@/components/obsidian/mount'

vi.mock('@/components/GalleryViewer.vue', () => ({ default: {} }))
vi.mock('@/components/obsidian/mount', () => ({
  mountKit: vi.fn(() => ({ unmount: vi.fn() })),
}))

vi.mock('@/canvas/pictureAdapter', () => ({
  canvasPicture: vi.fn(async () => ({
    canvas: { toDataURL: () => 'data:image/png;base64,c2FtcGxl' },
    warnings: [],
    visible: [],
  })),
}))
afterEach(() => vi.useRealTimers())
async function setup() {
  const app = useVault([{ path: 'sample.canvas', content: '{"nodes":[],"edges":[]}' }])
  const leaf = { view: {}, setViewState: vi.fn(async () => {}) }
  Object.assign(app, {
    workspace: {
      on: vi.fn(),
      getLeaf: vi.fn(() => leaf),
      getLeavesOfType: () => [],
      getMostRecentLeaf: () => leaf,
      revealLeaf: vi.fn(),
    },
  })
  const embed = document.createElement('span')
  embed.setAttribute('src', 'sample.canvas')
  const widget = new CanvasEmbed(app as never, embed, () => 'sample-note.md')
  widget.load()
  await vi.waitFor(() => expect(embed.querySelector('img')?.getAttribute('src')).toBeTruthy())
  vi.useFakeTimers()
  return { app, leaf, widget, embed, image: embed.querySelector('img')! }
}
it('opens a picture after one click and the canvas immediately on double-click, without buttons', async () => {
  const { widget, embed, leaf, image } = await setup()
  try {
    expect(embed.querySelector('button')).toBeNull()
    image.click()
    expect(leaf.setViewState).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(leaf.setViewState).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'abele-canvas-image' })
    )
    leaf.setViewState.mockClear()
    image.click()
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(300)
    expect(leaf.setViewState).toHaveBeenCalledOnce()
    expect(leaf.setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'abele-canvas',
        state: { file: 'sample.canvas', play: false },
      })
    )
  } finally {
    widget.unload()
  }
})
it('distinguishes touch gestures from scrolling, suppresses synthetic clicks, and cleans up', async () => {
  const { widget, leaf, image } = await setup()
  const pointer = (type: string, y = 20) =>
    image.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 30,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    )
  const tap = () => {
    pointer('pointerdown')
    pointer('pointerup')
  }
  try {
    tap()
    image.dispatchEvent(new MouseEvent('click', { detail: 1 }))
    await vi.advanceTimersByTimeAsync(300)
    expect(leaf.setViewState).toHaveBeenCalledOnce()
    leaf.setViewState.mockClear()
    tap()
    await vi.advanceTimersByTimeAsync(100)
    tap()
    image.dispatchEvent(new MouseEvent('dblclick'))
    await vi.advanceTimersByTimeAsync(300)
    expect(leaf.setViewState).toHaveBeenCalledOnce()
    expect(leaf.setViewState).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'abele-canvas' })
    )
    leaf.setViewState.mockClear()
    pointer('pointerdown')
    expect(pointer('pointermove', 120)).toBe(true)
    pointer('pointerup')
    await vi.advanceTimersByTimeAsync(300)
    expect(leaf.setViewState).not.toHaveBeenCalled()
    tap()
    widget.unload()
    await vi.advanceTimersByTimeAsync(300)
    expect(leaf.setViewState).not.toHaveBeenCalled()
  } finally {
    widget.unload()
  }
})
it('opens a canvas in the current leaf rather than an unrelated tab', async () => {
  const { app, leaf, widget } = await setup()
  widget.unload()
  await opening.openCanvas(app as never, app.vault.getAbstractFileByPath('sample.canvas') as never)
  expect(app.workspace.getLeaf).toHaveBeenCalledWith(false)
  expect(leaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({ type: 'abele-canvas' }))
})

it('records image navigation and restores its source and crop, with Edit opening the same leaf', async () => {
  const { app, leaf, widget } = await setup()
  widget.unload()
  vi.useRealTimers()
  const view = new CanvasImageView(leaf as never)
  expect(view.navigation).toBe(true)
  Object.assign(view, { app, contentEl: document.createElement('div') })
  await view.onOpen()
  const result = { history: false }
  const state = { file: 'sample.canvas', node: 'alpha' }
  await view.setState(state, result)
  expect(result.history).toBe(true)
  expect(view.getState()).toEqual(state)
  expect(mountKit).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      embedded: true,
      snapshot: true,
      images: [
        expect.objectContaining({ url: 'data:image/png;base64,c2FtcGxl', path: 'sample.canvas' }),
      ],
    })
  )
  const unchanged = { history: false }
  await view.setState(view.getState(), unchanged)
  expect(unchanged.history).toBe(false)
  view.containerEl.querySelector<HTMLElement>('[aria-label="Edit"]')!.click()
  expect(leaf.setViewState).toHaveBeenCalledWith({
    type: 'abele-canvas',
    state: { ...state, play: false },
    active: true,
  })
  await view.onClose()
  // Back recreates this view from its recorded state, without a callback or image URL in history.
  const restored = new CanvasImageView(leaf as never)
  Object.assign(restored, { app, contentEl: document.createElement('div') })
  await restored.setState(state, { history: false })
  expect(restored.getState()).toEqual(state)
  await restored.onClose()
})
