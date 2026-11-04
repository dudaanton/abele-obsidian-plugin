import { expect, it } from 'vitest'
import { syncPhaseMemory } from '../e2e/helpers/syncPhaseMemory'

it('reports unsupported heap measurement explicitly and keeps only scalar allocation proxies', async () => {
  const doc = {
    getElementsByTagName: (tag: string) =>
      tag === 'canvas' ? [{ width: 1024, height: 1024 }] : Array(12),
  }
  const result = await syncPhaseMemory({ performance: { timeOrigin: 123 } } as never, doc as never)
  expect(result).toMatchObject({
    timeOrigin: 123,
    heap: { available: false },
    domNodes: 12,
    canvasPixels: 1048576,
  })
})

it('reports available heap bytes without retaining the performance object', async () => {
  const memory = { usedJSHeapSize: 32, totalJSHeapSize: 64, privateData: 'not exported' }
  const result = await syncPhaseMemory(
    { performance: { memory } } as never,
    { getElementsByTagName: () => [] } as never,
    async () => 4096
  )
  expect(result.resident).toEqual({ available: true, bytes: 4096 })
  expect(result.heap).toEqual({ available: true, usedBytes: 32, totalBytes: 64 })
  memory.usedJSHeapSize = 128
  expect(result.heap).toEqual({ available: true, usedBytes: 32, totalBytes: 64 })
})

it('keeps phase diagnostics usable when the native sampler refuses', async () => {
  const result = await syncPhaseMemory(
    { performance: {} } as never,
    { getElementsByTagName: () => [] } as never,
    async () => {
      throw new Error('sample unavailable')
    }
  )
  expect(result.resident).toEqual({ available: false })
})
