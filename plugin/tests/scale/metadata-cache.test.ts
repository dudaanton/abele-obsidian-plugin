import { expect, it, vi } from 'vitest'

it('records layout readiness and the first clean poll without sampling after idle', () => {
  let at = 100
  let clean = false
  let layoutReady: () => void = () => {}
  const readClean = vi.fn(() => clean)
  const app = {
    metadataCache: { isCacheClean: readClean },
    workspace: {
      onLayoutReady: (callback: () => void) => {
        layoutReady = callback
      },
    },
  }
  const receipt: Record<string, unknown> = {}
  const save = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- The disposable host helper is CommonJS.
  const { createMetadataCacheCapture } = require('./metadata-cache.cjs')
  const capture = createMetadataCacheCapture(app, receipt, save, () => at)

  capture.poll()
  at = 125
  layoutReady()
  expect(receipt.metadataCacheAtLayoutReady).toEqual({ at: 125, clean: false })
  at = 200
  clean = true
  capture.poll()
  at = 300
  capture.poll()
  capture.finish()
  capture.poll()

  expect(receipt.metadataCacheFirstCleanAt).toBe(200)
  expect(receipt.metadataCacheAtIdle).toEqual({ at: 300, clean: true })
  expect(readClean).toHaveBeenCalledTimes(4)
  expect(save).toHaveBeenCalledTimes(3)
})

it('records when cache first becomes clean after a dirty layout-ready state', () => {
  let at = 100
  let clean = true
  let layoutReady: () => void = () => {}
  const app = {
    metadataCache: { isCacheClean: () => clean },
    workspace: {
      onLayoutReady: (callback: () => void) => {
        layoutReady = callback
      },
    },
  }
  const receipt: Record<string, unknown> = {}
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- The disposable host helper is CommonJS.
  const { createMetadataCacheCapture } = require('./metadata-cache.cjs')
  const capture = createMetadataCacheCapture(
    app,
    receipt,
    () => {},
    () => at
  )

  capture.poll()
  at = 125
  clean = false
  layoutReady()
  at = 200
  clean = true
  capture.poll()
  capture.finish()

  expect(receipt.metadataCacheFirstCleanAt).toBe(100)
  expect(receipt.metadataCacheAtLayoutReady).toEqual({ at: 125, clean: false })
  expect(receipt.metadataCacheFirstCleanAfterLayoutReadyAt).toBe(200)
})
