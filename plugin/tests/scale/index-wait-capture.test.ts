import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createIndexWaitCapture } = require('./index-wait-capture.cjs')

it('records every observed waiting interval and captures one visible frame', async () => {
  const receipt: Record<string, unknown> = {}
  const save = vi.fn()
  const screenshot = vi.fn().mockResolvedValue(true)
  const capture = createIndexWaitCapture(receipt, save, screenshot)
  capture.poll([{ indexWaiting: false }], 100)
  capture.poll([{ indexWaiting: true }], 200)
  capture.poll([{ indexWaiting: true }], 300)
  capture.poll([{ indexWaiting: false }], 450)
  capture.poll([{ indexWaiting: true }], 500)
  capture.finish(700)
  await capture.pending()
  expect(receipt.indexWaitIntervals).toEqual([
    { beginAt: 200, endAt: 450 },
    { beginAt: 500, endAt: 700 },
  ])
  expect(screenshot).toHaveBeenCalledTimes(1)
  expect(receipt.indexWaitScreenshot).toBe(true)
  expect(save).toHaveBeenCalled()
})
