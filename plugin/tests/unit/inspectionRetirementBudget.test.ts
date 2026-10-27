// @vitest-environment node
import { expect, it } from 'vitest'
import { ExternalRepresentation } from '@/sync/external/representation'

it('delivers another host task while retiring a large inspection listing', async () => {
  const inspected = Array.from({ length: 1024 }, (_, i) => ({ path: `sample-${i}.md` }))
  const runtime = Reflect.construct(ExternalRepresentation, [
    {
      fs: { list: async function* () {} },
      inspection: {
        entries: inspected,
        ownsKey: () => {
          const until = performance.now() + 0.06
          while (performance.now() < until) {
            // Simulate a costly path scope check.
          }
          return true
        },
      },
    },
  ]) as ExternalRepresentation
  Reflect.set(runtime, 'flushInspection', async () => {})
  const cache = Reflect.get(runtime, 'inspected') as Map<string, { path: string; marker?: string }>
  let delivered = false
  const task = new Promise<void>((resolve) =>
    setTimeout(() => {
      cache.set('sample-900.md', { path: 'sample-900.md', marker: 'fresh' })
      delivered = true
      resolve()
    }, 0)
  )
  for await (const _ of runtime.fileSystem().list()) {
    // The empty listing retires cached entries in its completion path.
  }
  const deliveredBeforeCompletion = delivered
  await task
  expect(deliveredBeforeCompletion).toBe(true)
  expect(cache.get('sample-900.md')?.marker).toBe('fresh')
})
