import { expect, it } from 'vitest'
import { ServerFolderPaths } from '@/sync/serverFolderPaths'

it.each(['path', 'prev_path', 'to_path', 'conflict_path'])(
  'projects %s without admitting either unrelated local or obsolete server paths',
  (key) => {
    const paths = new ServerFolderPaths('Shared', 'Renamed')
    expect(paths.map({ items: [{ [key]: 'Renamed/note.md' }] }, true)).toEqual({
      items: [{ [key]: 'Shared/note.md' }],
    })
    expect(paths.map({ ops: [{ [key]: 'Shared/note.md' }] }, false)).toEqual({
      ops: [{ [key]: 'Renamed/note.md' }],
    })
    expect(() => paths.map({ [key]: 'Private/secret.md' }, true)).toThrow()
    expect(() => paths.map({ [key]: 'Shared/secret.md' }, true)).toThrow()
    expect(() => paths.map({ [key]: 'Private/secret.md' }, false)).toThrow()
  }
)

it('maps a large received page in short slices, with the same result and refusals', async () => {
  const paths = new ServerFolderPaths('Shared', 'Renamed')
  const page = {
    items: Array.from({ length: 4000 }, (_, i) => ({
      type: 'content',
      path: `Renamed/Section ${i % 40}/sample-${i}.md`,
      item: { path: `Renamed/Section ${i % 40}/sample-${i}.md`, size: i },
    })),
  }
  let ticks = 0
  const timer = setInterval(() => ticks++, 0)
  try {
    const mapped = await paths.mapAsync(page, true)
    expect(mapped).toEqual(paths.map(page, true))
    // Other work runs while a page is mapped.
    expect(ticks).toBeGreaterThan(0)
  } finally {
    clearInterval(timer)
  }
  await expect(paths.mapAsync({ items: [{ path: 'Private/secret.md' }] }, true)).rejects.toThrow()
})
