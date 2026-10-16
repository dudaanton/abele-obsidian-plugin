// @vitest-environment node
import { expect, it } from 'vitest'
import { rendererMemory } from '../e2e/helpers/rendererMemory'

it('samples the renderer isolate as scalars after serialization into an eval', () => {
  const sample = new Function('load', `return (${rendererMemory.toString()})(load)`)
  expect(
    sample((id: string) => {
      if (id === 'node:v8')
        return {
          getHeapStatistics: () => ({
            used_heap_size: 11,
            total_heap_size: 22,
            external_memory: 33,
            number_of_native_contexts: 4,
            number_of_detached_contexts: 5,
          }),
        }
      if (id === 'node:process') return { memoryUsage: () => ({ rss: 66, arrayBuffers: 77 }) }
      throw new Error('Unexpected module')
    })
  ).toEqual({
    rss: 66,
    heapUsed: 11,
    heapTotal: 22,
    external: 33,
    arrayBuffers: 77,
    contexts: 4,
    detachedContexts: 5,
  })
})
