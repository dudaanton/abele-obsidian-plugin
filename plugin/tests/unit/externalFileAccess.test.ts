import { expect, it, vi } from 'vitest'
import { prepareExternalFile, externalLinkPath } from '@/sync/external/fileAccess'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import type { App } from 'obsidian'

it('resolves absent links and waits for real content, preserving ordinary paths', async () => {
  const app = { vault: {}, metadataCache: { getFirstLinkpathDest: () => null } } as unknown as App
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember(
    'sample',
    [{ path: 'Books/sample.epub', size: 120, mtime: 1 }],
    ['Books/sample.epub.abele-ref']
  )
  const hydrate = vi.fn(async () => {})
  manager.hydrator('sample', hydrate)
  expect(externalLinkPath(app, 'sample.epub', 'Books/note.md')).toBe('Books/sample.epub')
  expect(await prepareExternalFile(app, 'Books/sample.epub.abele-ref')).toBe('Books/sample.epub')
  expect(hydrate).toHaveBeenCalledWith('Books/sample.epub')
})

it('never selects an ambiguous absent basename', () => {
  const app = { vault: {}, metadataCache: { getFirstLinkpathDest: () => null } } as unknown as App
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember(
    'sample',
    ['One', 'Two'].map((dir) => ({ path: `${dir}/sample.png`, size: 2, mtime: 1 })),
    []
  )
  expect(externalLinkPath(app, 'sample.png', 'Other/note.md')).toBeNull()
})

it('retains explicit and relative absent paths ahead of a local namesake', () => {
  const app = {
    vault: {},
    metadataCache: { getFirstLinkpathDest: () => ({ path: 'Other/sample.png' }) },
  } as unknown as App
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember('sample', [{ path: 'Media/sample.png', size: 2, mtime: 1 }], [])
  expect(externalLinkPath(app, 'Media/sample.png', 'Notes/note.md')).toBe('Media/sample.png')
  expect(externalLinkPath(app, '../Media/sample.png', 'Notes/note.md')).toBe('Media/sample.png')
})
