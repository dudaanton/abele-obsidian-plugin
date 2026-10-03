import { afterEach, expect, it, vi } from 'vitest'
import { TFile, type Plugin } from 'obsidian'
import { registerCanvas } from '@/canvas/register'
import { adoptCanvasLeaves } from '@/canvas/opening'

vi.mock('@/canvas/opening', () => ({
  CANVAS_VIEW_TYPE: 'abele-canvas',
  adoptCanvasLeaves: vi.fn(async () => {}),
  openCanvas: vi.fn(),
}))
vi.mock('@/canvas/CanvasView', () => ({ CanvasView: class {} }))
vi.mock('@/canvas/embed', () => ({
  canvasEmbedProcessor: vi.fn(),
  canvasEmbedsInEditor: vi.fn(),
}))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: { getInstance: () => ({ canvasViewer: true }) },
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
it('retries adoption after a delayed native initial save without depending on another layout event', async () => {
  vi.useFakeTimers()
  const callbacks = new Map<string, (file: TFile) => void>()
  const cleanups: (() => void)[] = []
  const plugin = {
    app: {
      workspace: { onLayoutReady: vi.fn(), on: vi.fn() },
      vault: {
        on: (event: string, callback: (file: TFile) => void) => callbacks.set(event, callback),
      },
    },
    registerView: vi.fn(),
    registerEvent: vi.fn(),
    register: (cleanup: () => void) => cleanups.push(cleanup),
    registerMarkdownPostProcessor: vi.fn(),
    registerEditorExtension: vi.fn(),
    addCommand: vi.fn(),
  }
  registerCanvas(plugin as unknown as Plugin)
  const file = new TFile()
  file.extension = 'canvas'
  expect(callbacks.has('modify')).toBe(true)
  callbacks.get('modify')!(file)
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledOnce()
  file.extension = 'md'
  callbacks.get('modify')!(file)
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledOnce()
  const canvas = Object.assign(new TFile(), { extension: 'canvas' })
  let finishRead!: () => void
  vi.mocked(adoptCanvasLeaves).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRead = resolve
      })
  )
  callbacks.get('modify')!(canvas)
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(2)
  callbacks.get('modify')!(canvas) // A save arrives while an adoption read is still pending.
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(2)
  finishRead()
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(3)
  callbacks.get('modify')!(canvas)
  cleanups.forEach((cleanup) => cleanup())
  await vi.advanceTimersByTimeAsync(40)
  expect(adoptCanvasLeaves).toHaveBeenCalledTimes(3)
})
