import { expect, it, vi } from 'vitest'
import { captureSlideViewport } from '../e2e/helpers/slidesCapture'

it('requests a fresh compositor screenshot limited to the visible viewport', async () => {
  const sendCommand = vi.fn().mockResolvedValue({ data: 'sample-png' })
  expect(await captureSlideViewport({ sendCommand })).toBe('sample-png')
  expect(sendCommand).toHaveBeenCalledExactlyOnceWith('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
})
