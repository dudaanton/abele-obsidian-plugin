import { afterEach, expect, it, vi } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'

const resolver = new ScopeResolver()
afterEach(() => {
  resolver.destroy()
  vi.useRealTimers()
})

it('keeps recursive counts, cycles and previews equal to permission resolution, caching only until invalidation', async () => {
  const app = useVault([
    { path: 'Groups/First.md', frontmatter: { groups: ['[[Groups/Second]]'] } },
    { path: 'Groups/Second.md', frontmatter: { groups: ['[[Groups/First]]'] } },
    { path: 'Notes/Member.md', frontmatter: { groups: ['[[Groups/Second]]'] } },
    { path: 'Notes/Outside.md' },
  ])
  const signal = new AbortController().signal
  const paths = ['Groups/First.md', 'Groups/Second.md', 'Missing.md']
  const counts = await resolver.groupCountsAsync(paths, signal)
  for (const path of paths) {
    expect(counts.get(path)).toBe(resolver.resolveGroupPaths(path).length)
    expect(await resolver.resolveGroupPathsAsync(path, signal)).toEqual(
      resolver.resolveGroupPaths(path)
    )
  }
  app.resetStats()
  expect(await resolver.groupCountsAsync(paths, signal)).toEqual(counts)
  expect(app.stats.getFileCache).toBe(0)
  expect(app.stats.getAbstractFileByPath).toBe(0)
  resolver.invalidate()
  expect(await resolver.groupCountsAsync(paths, signal)).toEqual(counts)
  expect(app.stats.getFileCache).toBe(4)
})

it('bounds work between task boundaries and cancels a cold index without publishing it', async () => {
  const app = useVault(Array.from({ length: 20000 }, (_, i) => ({ path: `Notes/Sample ${i}.md` })))
  vi.useFakeTimers()
  const controller = new AbortController()
  const pending = resolver.groupCountsAsync(['Notes/Sample 0.md'], controller.signal)
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(app.stats.getFileCache).toBe(0)
  vi.advanceTimersToNextTimer()
  await Promise.resolve()
  expect(app.stats.getFileCache).toBeGreaterThan(0)
  expect(app.stats.getFileCache).toBeLessThanOrEqual(5000)
  const reads = app.stats.getFileCache
  controller.abort()
  await vi.runAllTimersAsync()
  await cancelled
  expect(app.stats.getFileCache).toBe(reads)
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects an invalidated in-flight index and rebuilds from current metadata', async () => {
  useVault([{ path: 'Groups/Hub.md' }])
  const pending = resolver.groupCountsAsync(['Groups/Hub.md'], new AbortController().signal)
  resolver.invalidate()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(await resolver.groupCountsAsync(['Groups/Hub.md'], new AbortController().signal)).toEqual(
    new Map([['Groups/Hub.md', 1]])
  )
})
