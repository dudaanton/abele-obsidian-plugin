// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { columnsFixtureCleanup, COLUMNS_FIXTURE_PREFIX } from '../e2e/helpers/columnsFixture'

describe('columns fixture cleanup', () => {
  it('removes interrupted run folders and their leaves, preserving unrelated files', async () => {
    const root = {}
    const paths = [
      COLUMNS_FIXTURE_PREFIX + 'old',
      COLUMNS_FIXTURE_PREFIX + 'current',
      'Sample columns probe',
      'Other sample',
    ]
    const folders = paths.map((path) => ({ path, parent: root, children: [] }))
    const file = { path: COLUMNS_FIXTURE_PREFIX + 'unrelated.md', parent: root }
    const detach = paths.map(() => vi.fn())
    const deleted: string[] = []
    const app = {
      vault: {
        getRoot: () => root,
        getAllLoadedFiles: () => [...folders, file],
        getAbstractFileByPath: (path: string) => folders.find((f) => f.path === path),
        delete: async (folder: { path: string }) => {
          deleted.push(folder.path)
        },
      },
      workspace: {
        getLeavesOfType: () =>
          paths.map((path, i) => ({
            view: { file: { path: path + '/Columns.md' } },
            detach: detach[i],
          })),
      },
    }
    const execute = (stale: boolean) =>
      new Function(
        'app',
        'return (async () => {' + columnsFixtureCleanup(paths[1], stale) + '})()'
      )(app)
    await execute(false)
    expect(deleted).toEqual([paths[1]])
    deleted.length = 0
    await execute(true)
    expect(deleted).toEqual(paths.slice(0, 3))
    expect(detach[3]).not.toHaveBeenCalled()
  })
})
