import { afterEach, expect, it, vi } from 'vitest'
import { canvasChrome, type CanvasChromeDriver } from '../e2e/helpers/canvasChrome'

function fixture(blocked = false) {
  const stage = document.createElement('div')
  document.body.append(stage)
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 390, bottom: 600, width: 390, height: 600 }) as DOMRect
  const viewer = {
    stage,
    camera: { x: 0, y: 0, zoom: 1 },
    graph: { nodes: [{ x: -100, y: -100, width: 1000, height: 1000 }] },
    setCamera(camera: { x: number; y: number; zoom: number }) {
      this.camera = camera
    },
  }
  vi.stubGlobal('innerWidth', 390)
  vi.stubGlobal('innerHeight', 600)
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => (blocked ? null : stage))
  const at = vi.fn(async (_point: number[]) => {})
  const driver: CanvasChromeDriver = {
    run: <T>(body: string): T =>
      new Function('view', body)(() => ({
        viewer,
        editor: { controls: { tool: () => 'card' } },
      })),
    press: async () => {},
    at,
    until: async () => {},
    phone: true,
  }
  return { chrome: canvasChrome(driver), viewer, at }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
it('moves beyond a populated phone canvas and verifies room for the whole card', async () => {
  const { chrome, viewer, at } = fixture()
  await chrome.put('Add text card')
  expect(viewer.camera.x).toBeGreaterThan(900)
  expect(at).toHaveBeenCalledOnce()
  expect(at.mock.calls[0]).toEqual([chrome.roomFor(260, 120)])
})
it('fails clearly without sending a tap when the visible stage is covered', async () => {
  const { chrome, at } = fixture(true)
  await expect(chrome.put('Add text card')).rejects.toThrow('No verified free area')
  expect(at).not.toHaveBeenCalled()
})
