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
