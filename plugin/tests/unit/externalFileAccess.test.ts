import { expect, it, vi } from 'vitest'
import {
  prepareExternalFile,
  externalLinkPath,
  recordExternalOpening,
} from '@/sync/external/fileAccess'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import type { App } from 'obsidian'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { readOpeningHistory } from '@/sync/external/openingHistory'

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

it('reads empty and persisted opening history through the unknown storage boundary', () => {
  for (const value of [null, undefined, {}, { 'Media/sample.pdf': 123 }]) {
    expect(readOpeningHistory({ loadLocalStorage: () => value })).toEqual(value ?? {})
  }
})

it.each([[], 'invalid', { sample: 'invalid' }, { sample: Infinity }, { sample: NaN }])(
  'rejects malformed opening history %j',
  (value) => {
    expect(() => readOpeningHistory({ loadLocalStorage: () => value })).toThrow()
  }
)

it('does not let unavailable opening-history storage interrupt file access', () => {
  const app = { vault: {} } as unknown as App
  expect(() => recordExternalOpening(app, 'Media/sample.png')).not.toThrow()
})

it.each(['malformed', 'read failure', 'write failure', 'shutdown'])(
  'does not let %s opening-history bookkeeping interrupt file access',
  async (phase) => {
    const app = {
      vault: {},
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    } as unknown as App
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-opening', app)
    try {
      if (phase === 'malformed') {
        host.saveLocalStorage('abele-external-last-opened-v1', { sample: 'invalid' })
        await host.flush()
      } else if (phase === 'read failure') {
        vi.spyOn(host, 'loadLocalStorage').mockImplementation(() => {
          throw new Error('sample read failure')
        })
      } else if (phase === 'write failure') {
        vi.spyOn(host, 'saveLocalStorage').mockImplementation(() => {
          throw new Error('sample write failure')
        })
      } else await host.flushForShutdown()
      expect(() => recordExternalOpening(app, 'Media/sample.png')).not.toThrow()
    } finally {
      vi.restoreAllMocks()
      host.close()
    }
  }
)
