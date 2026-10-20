import { expect, it, vi } from 'vitest'
import { createServerFolder } from '../e2e/helpers/syncServerFolder'

vi.mock('../e2e/helpers/syncVault', () => ({
  waitFor: async (_label: string, ready: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 3; attempt++) if (await ready()) return
    throw new Error('Folder inventory did not arrive')
  },
}))

it('creates an explicit directory and waits for its manifest identity instead of assuming nested files create it', async () => {
  const events: string[] = []
  const directory = {
    kind: 'directory' as const,
    path: 'Garden/Flowers',
    file_id: 'folder-a',
    version_id: 'version-a',
    mtime: 1,
  }
  const items = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([directory])
  const fixture = {
    commit: vi.fn(async () => {
      events.push('mkdir')
    }),
    items: async () => {
      events.push('manifest')
      return items()
    },
  }
  expect(await createServerFolder(fixture, directory.path)).toEqual(directory)
  expect(fixture.commit).toHaveBeenCalledWith([{ op: 'mkdir', path: directory.path }])
  expect(events).toEqual(['mkdir', 'manifest', 'manifest'])
})
